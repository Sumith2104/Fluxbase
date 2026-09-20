import { ModelGateway, ModelMessage } from './gateway';
import logger from '@/lib/logger';
import { SqlEngine } from '@/lib/sql-engine';

export interface SqlAgentOptions {
  projectId: string;
  userId: string;
  userInput: string;
  tableSchema: string;
  dialect?: 'postgresql' | 'mysql' | string;
  allowDestructive?: boolean;
  project?: any;
  model?: string;
}

export interface SqlAgentResult {
  success: boolean;
  query: string;
  isDangerous: boolean;
  warning?: string;
  error?: string;
  validationIterations?: number;
  explanation?: string;
}

export class SqlAgent {
  /**
   * Generates SQL from natural language with an autonomous 3-retry self-healing feedback loop.
   */
  public static async generateAndValidateSQL(options: SqlAgentOptions): Promise<SqlAgentResult> {
    const dialect = (options.dialect || 'postgresql').toLowerCase() === 'mysql' ? 'MySQL' : 'PostgreSQL';
    const isMysql = dialect === 'MySQL';
    const maxRetries = 3;

    let currentPrompt = this.buildInitialPrompt(options.userInput, options.tableSchema, dialect);
    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: `You are an expert Staff Database Engineer & SQL Architect specialized in ${dialect}.
Your task is to generate high-performance, strictly valid ${dialect} queries based on the user's natural language request and live database schema.

CRITICAL RULES:
1. DIALECT COMPLIANCE:
   - For PostgreSQL: Wrap table/column names in double quotes if mixed case. Use native functions like \`gen_random_uuid()\`, \`NOW()\`, \`EXTRACT(EPOCH FROM ...)\`, \`LAG() OVER (...)\`.
   - For MySQL: Wrap table/column names in backticks \` if needed. Use \`NOW()\`, \`LIMIT\`.
2. ZERO HALLUCINATION:
   - ONLY query tables and columns that are explicitly declared in the provided schema.
   - If no tables exist, formulate a clean CREATE TABLE statement if requested.
3. DANGEROUS STATEMENT IDENTIFICATION:
   - Flag any DROP, TRUNCATE, DELETE, ALTER, UPDATE without WHERE as dangerous.
4. OUTPUT FORMAT:
   - You MUST output a valid JSON object matching:
   {
     "sql": "<executable SQL query>",
     "isDangerous": <boolean>,
     "warning": "<explanation if dangerous, else empty>",
     "explanation": "<brief 1-sentence description of the query>"
   }
   - Do NOT wrap your JSON in markdown code fences.`
      },
      {
        role: 'user',
        content: currentPrompt
      }
    ];

    let lastQuery = '';
    let lastDangerous = false;
    let lastWarning = '';
    let lastExplanation = '';
    let lastError = '';

    for (let iteration = 1; iteration <= maxRetries; iteration++) {
      try {
        logger.info(`[SqlAgent] SQL Generation iteration ${iteration}/${maxRetries} for project ${options.projectId}`);
        const result = await ModelGateway.generate({
          model: options.model || 'flux-fast',
          messages,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        });

        let parsed = result.output;
        if (!parsed || typeof parsed !== 'object' || !parsed.sql) {
          // Fallback regex extraction if raw text returned
          const cleanText = result.text.replace(/```json/gi, '').replace(/```sql/gi, '').replace(/```/g, '').trim();
          try {
            parsed = JSON.parse(cleanText);
          } catch {
            // Treat entire cleanText as the query if it looks like SQL
            if (/^\s*(select|with|insert|update|delete|create|drop|alter)\b/i.test(cleanText)) {
              parsed = { sql: cleanText, isDangerous: false };
            }
          }
        }

        if (!parsed || !parsed.sql) {
          throw new Error('AI returned an empty or malformed SQL response');
        }

        let rawSql = (parsed.sql || '').trim();
        // Strip any lingering markdown
        if (rawSql.startsWith('```sql')) rawSql = rawSql.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();
        if (rawSql.startsWith('```')) rawSql = rawSql.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

        lastQuery = rawSql;
        lastDangerous = Boolean(parsed.isDangerous || this.checkDestructive(rawSql));
        lastWarning = parsed.warning || (lastDangerous ? 'This query modifies or deletes database records.' : '');
        lastExplanation = parsed.explanation || '';

        // If the query is destructive, do NOT run dry-run validation (to prevent accidental modifications)
        if (lastDangerous) {
          if (!options.allowDestructive) {
            return {
              success: false,
              query: lastQuery,
              isDangerous: true,
              warning: lastWarning || 'Destructive query blocked by project settings.',
              error: 'Destructive query blocked by project safety policy.'
            };
          }
          return {
            success: true,
            query: lastQuery,
            isDangerous: true,
            warning: lastWarning,
            explanation: lastExplanation,
            validationIterations: iteration
          };
        }

        // --- Autonomous Validation Step: Dry-Run EXPLAIN against Live Engine ---
        const isExplainable = /^\s*(select|with)\b/i.test(lastQuery);
        if (isExplainable && options.projectId && options.userId) {
          try {
            const engine = new SqlEngine(options.projectId, options.userId, undefined, undefined, options.project);
            const explainSql = isMysql ? `EXPLAIN ${lastQuery}` : `EXPLAIN (FORMAT TEXT) ${lastQuery}`;
            
            logger.info(`[SqlAgent] Dry-running EXPLAIN validation on generated query...`);
            await engine.execute(explainSql);
            logger.info(`[SqlAgent] Dry-run EXPLAIN passed with 0 errors!`);

            return {
              success: true,
              query: lastQuery,
              isDangerous: false,
              warning: '',
              explanation: lastExplanation,
              validationIterations: iteration
            };
          } catch (execErr: any) {
            const errorMsg = execErr?.message || String(execErr);
            logger.warn(`[SqlAgent] Dry-run validation failed on iteration ${iteration}: ${errorMsg}`);
            lastError = errorMsg;

            if (iteration < maxRetries) {
              // Self-healing: Feed the exact database error back to the LLM
              messages.push({
                role: 'assistant',
                content: JSON.stringify({ sql: lastQuery, isDangerous: lastDangerous })
              });
              messages.push({
                role: 'user',
                content: `Your generated SQL failed execution in ${dialect} with error:
"${errorMsg}"

Current Database Schema:
${options.tableSchema}

Analyze the error. Fix column/table names or syntax errors. Return the corrected JSON.`
              });
              continue;
            }
          }
        } else {
          // Non-SELECT queries (e.g. CREATE TABLE) that cannot be safely EXPLAINed in read-only mode
          return {
            success: true,
            query: lastQuery,
            isDangerous: lastDangerous,
            warning: lastWarning,
            explanation: lastExplanation,
            validationIterations: iteration
          };
        }

      } catch (err: any) {
        logger.error(`[SqlAgent] Error during iteration ${iteration}:`, err);
        lastError = err?.message || String(err);
      }
    }

    // If retries exhausted but we have a query, return it with a caution note
    if (lastQuery) {
      return {
        success: true,
        query: lastQuery,
        isDangerous: lastDangerous,
        warning: lastWarning || (lastError ? `Autonomous validation noted: ${lastError}` : undefined),
        explanation: lastExplanation,
        validationIterations: maxRetries
      };
    }

    return {
      success: false,
      query: '',
      isDangerous: false,
      error: lastError || 'Failed to generate a valid SQL query.'
    };
  }

  private static buildInitialPrompt(userInput: string, schema: string, dialect: string): string {
    return `USER QUESTION:
"${userInput}"

TARGET DATABASE DIALECT:
${dialect}

LIVE DATABASE SCHEMA:
${schema || 'No tables exist in this database yet.'}

Generate the exact executable SQL query that satisfies the user question.`;
  }

  private static checkDestructive(sql: string): boolean {
    const s = sql.toLowerCase();
    return /\b(drop\s+table|drop\s+database|truncate|delete\s+from|alter\s+table)\b/i.test(s) ||
           (/\bupdate\b/i.test(s) && !/\bwhere\b/i.test(s));
  }
}
