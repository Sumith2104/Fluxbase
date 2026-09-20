import { ModelGateway, ModelMessage } from './gateway';
import logger from '@/lib/logger';
import { SqlEngine } from '@/lib/sql-engine';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || ''
});

export interface AnalyticsWidgetSpec {
  title: string;
  query: string;
  chart_type: 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'radar' | 'treemap' | 'number' | 'table';
  config: {
    xAxisKey: string;
    dataKeys: string[];
    nameKey?: string;
  };
}

export class AnalyticsAgent {
  /**
   * Generates optimized analytical dashboard widgets with live SQL validation.
   */
  public static async generateWidgets(params: {
    projectId: string;
    userId: string;
    prompt: string;
    schemaString: string;
    dialect?: string;
    model?: string;
    project?: any;
  }): Promise<{ success: boolean; widgets: AnalyticsWidgetSpec[]; error?: string }> {
    const dialect = (params.dialect || 'postgresql').toLowerCase() === 'mysql' ? 'MySQL' : 'PostgreSQL';

    const systemPrompt = `You are a Lead Data Architect and Business Intelligence Engineer specialized in ${dialect} and modern Recharts data visualizations.
Analyze the user's analytical goal and live database schema. Create 1 to 4 distinct analytical widgets.

RULES:
1. Every query MUST be a valid, entirely read-only SELECT statement in ${dialect}.
2. Always alias aggregation columns cleanly (e.g. \`COUNT(*) AS total_count\`, \`DATE_TRUNC('month', created_at) AS period\`).
3. Ensure the \`config.xAxisKey\` and \`config.dataKeys\` EXACTLY match the column alias names from the SELECT query.
4. For chart types:
   - 'line' or 'area' for continuous time-series trends
   - 'bar' for categorical rankings and comparisons
   - 'pie' for percentage shares (when categories <= 6)
   - 'number' for high-impact singular KPI counters
5. Return a strict JSON object:
{
  "widgets": [
    {
      "title": "<Concise descriptive title>",
      "query": "<Executable SELECT SQL query>",
      "chart_type": "bar" | "line" | "pie" | "area" | "number" | "table",
      "config": {
        "xAxisKey": "<column name for X axis>",
        "dataKeys": ["<column name(s) for Y axis>"]
      }
    }
  ]
}`;

    const userPrompt = `USER REQUEST:
"${params.prompt}"

LIVE DATABASE SCHEMA:
${params.schemaString}

Generate the widget configurations now in raw JSON.`;

    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const response = await ModelGateway.generate({
        model: params.model || 'flux-fast',
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      let widgets: AnalyticsWidgetSpec[] = [];
      if (response.output?.widgets && Array.isArray(response.output.widgets)) {
        widgets = response.output.widgets;
      } else if (Array.isArray(response.output)) {
        widgets = response.output;
      }

      if (widgets.length === 0) {
        throw new Error('AI failed to produce structured widget specifications');
      }

      // Pre-validate queries with dry-run EXPLAIN against the user's database
      const validatedWidgets: AnalyticsWidgetSpec[] = [];
      const engine = new SqlEngine(params.projectId, params.userId, undefined, undefined, params.project);

      for (const w of widgets) {
        let cleanQuery = (w.query || '').trim().replace(/^```sql/i, '').replace(/```$/, '').trim();
        try {
          const isMysql = dialect === 'MySQL';
          const explain = isMysql ? `EXPLAIN ${cleanQuery}` : `EXPLAIN (FORMAT TEXT) ${cleanQuery}`;
          await engine.execute(explain);
          validatedWidgets.push({ ...w, query: cleanQuery });
        } catch (queryErr: any) {
          logger.warn(`[AnalyticsAgent] Widget query validation warning for "${w.title}": ${queryErr?.message || queryErr}`);
          // Include the widget even if explain fails, but preserve cleaned query
          validatedWidgets.push({ ...w, query: cleanQuery });
        }
      }

      return { success: true, widgets: validatedWidgets };
    } catch (err: any) {
      logger.error('[AnalyticsAgent] generateWidgets failed:', err);
      return { success: false, widgets: [], error: err?.message || 'Failed to generate widgets' };
    }
  }

  /**
   * Generates 3 intelligent quick-prompts based on the live schema.
   */
  public static async generateSuggestions(params: {
    projectId: string;
    schemaString: string;
    model?: string;
  }): Promise<string[]> {
    const cacheKey = `ai_suggestions_${params.projectId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached as string[];
      }
    } catch (e) {
      logger.warn('[AnalyticsAgent] Redis read error:', e);
    }

    if (!params.schemaString.trim()) {
      return [
        'Explore tables and schema structure',
        'Count total rows across all tables',
        'Show recent activity and records'
      ];
    }

    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: `You are a Data Analyst. Analyze the database schema and generate exactly 3 concise, high-value analytical questions that can be answered with the tables and columns present.
Output ONLY a JSON object:
{ "suggestions": ["Question 1", "Question 2", "Question 3"] }`
      },
      {
        role: 'user',
        content: `Database Schema:\n${params.schemaString}`
      }
    ];

    try {
      const response = await ModelGateway.generate({
        model: params.model || 'flux-fast',
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      });

      const suggestions = response.output?.suggestions || [
        'Show distribution of records over time',
        'Identify most active entities in database',
        'Summary statistics for primary tables'
      ];

      try {
        await redis.set(cacheKey, JSON.stringify(suggestions), { ex: 300 });
      } catch (err) {
        logger.warn('[AnalyticsAgent] Redis cache write error:', err);
      }

      return suggestions;
    } catch (e: any) {
      logger.error('[AnalyticsAgent] generateSuggestions error:', e);
      return [
        'Show row counts and table breakdown',
        'Analyze growth trends over time',
        'Identify top foreign key relationships'
      ];
    }
  }
}
