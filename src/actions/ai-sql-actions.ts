'use server';

import { getTablesForProject, getColumnsForTable } from '@/lib/data';
import logger from '@/lib/logger';

export async function generateSQLAction(projectId: string, userInput: string) {
    try {
        const { getProjectById } = await import('@/lib/data');
        const { getCurrentUserId } = await import('@/lib/auth');
        const userId = await getCurrentUserId();
        
        let dialect = 'PostgreSQL';
        let aiAllowDestructive = false;
        let aiSchemaInference = true;

        if (userId) {
            const project = await getProjectById(projectId, userId);
            if (project) {
                aiAllowDestructive = project.ai_allow_destructive ?? false;
                aiSchemaInference = project.ai_schema_inference ?? true;
                
                if (project.dialect) {
                    const fetchedDialect = project.dialect.toLowerCase();
                    if (fetchedDialect === 'postgresql') dialect = 'PostgreSQL';
                    else if (fetchedDialect === 'mysql') dialect = 'MySQL';
                    else dialect = project.dialect;
                }
            }
        }

        let schemaDescription = '';

        if (aiSchemaInference) {
            try {
                const { redis } = await import('@/lib/redis');
                const cachedSchema = await redis.get(`schema_inference_${projectId}`) as any;

                if (cachedSchema && cachedSchema.tables) {
                    for (const [tableName, columns] of Object.entries(cachedSchema.tables)) {
                        const cols = columns as any[];
                        const columnsDesc = cols.map(col => `${col.name} (${col.type})`).join(', ');
                        schemaDescription += `Table: ${tableName}\nColumns: ${columnsDesc}\n\n`;
                    }
                }
            } catch (e) {
                logger.warn('[AI SQL Engine] Redis read error, falling back to DB', e);
            }

            // Fallback to DB if Redis is empty or errors
            if (!schemaDescription) {
                const tables = await getTablesForProject(projectId);

                for (const table of tables) {
                    const columns = await getColumnsForTable(projectId, table.table_id);
                    const columnsDesc = columns.map(col =>
                        `${col.column_name} (${col.data_type}${col.is_primary_key ? ' PK' : ''}${col.is_nullable ? '' : ' NOT NULL'})`
                    ).join(', ');

                    schemaDescription += `Table: ${table.table_name}\nColumns: ${columnsDesc}\nDescription: ${table.description || 'No description'}\n\n`;
                }
            }

            if (!schemaDescription) {
                schemaDescription = "No tables exist in the project yet. The user may want to create a new table. Please generate a CREATE TABLE statement if requested.";
            }
        } else {
             schemaDescription = "Realtime Schema Inference is disabled for this project. Write standard SQL assuming standard structures, or request the user to enable inference for accurate code generation.";
        }

        // 4. Call Autonomous Self-Healing SQL Agent
        const { SqlAgent } = await import('@/lib/agent-core/sql-agent');
        const project = userId ? await getProjectById(projectId, userId) : undefined;
        const result = await SqlAgent.generateAndValidateSQL({
            projectId,
            userId: userId || 'anonymous',
            userInput,
            tableSchema: schemaDescription,
            dialect,
            allowDestructive: aiAllowDestructive,
            project
        });

        if (!result.success) {
            return {
                success: false,
                error: result.error || 'Failed to generate SQL query.'
            };
        }

        // 5. Destructive Query Trap Intercept
        if (result.isDangerous && !aiAllowDestructive) {
            logger.warn("[AI SQL Engine] Destructive query blocked by Project Settings.");
            return {
                success: false,
                error: "The AI generated a destructive query (e.g. DROP, DELETE, TRUNCATE) which is blocked by your current project settings. Go to Settings -> AI Assistant to allow this behavior."
            };
        }

        return { 
            success: true, 
            query: result.query,
            isDangerous: result.isDangerous,
            warning: result.warning
        };

    } catch (error: any) {
        logger.error('Error generating SQL:', error);
        return { success: false, error: error.message || 'Failed to generate SQL' };
    }
}

export async function fixSQLErrorAction(projectId: string, failedQuery: string, errorMessage: string) {
    try {
        const { getProjectById, getTablesForProject, getColumnsForTable } = await import('@/lib/data');
        const { getCurrentUserId } = await import('@/lib/auth');
        const userId = await getCurrentUserId();
        
        let dialect = 'PostgreSQL';
        let aiAllowDestructive = false;

        if (userId) {
            const project = await getProjectById(projectId, userId);
            if (project) {
                aiAllowDestructive = project.ai_allow_destructive ?? false;
                if (project.dialect) {
                    const fetchedDialect = project.dialect.toLowerCase();
                    if (fetchedDialect === 'postgresql') dialect = 'PostgreSQL';
                    else if (fetchedDialect === 'mysql') dialect = 'MySQL';
                    else dialect = project.dialect;
                }
            }
        }

        // 1. Gather schema description for project tables
        let schemaDescription = '';
        try {
            const tables = await getTablesForProject(projectId);
            for (const table of tables.slice(0, 20)) {
                const columns = await getColumnsForTable(projectId, table.table_id);
                const columnsDesc = columns.map(col =>
                    `${col.column_name} (${col.data_type}${col.is_primary_key ? ' PK' : ''}${col.is_nullable ? '' : ' NOT NULL'})`
                ).join(', ');
                schemaDescription += `Table: ${table.table_name}\nColumns: ${columnsDesc}\n\n`;
            }
        } catch (e) {
            logger.warn('[AI SQL Fixer] Could not load full schema:', e);
        }

        // 2. Call ModelGateway with targeted repair prompt
        const { ModelGateway } = await import('@/lib/agent-core/gateway');
        const prompt = `You are a Principal Database Administrator and SQL Debugging Architect specializing in ${dialect}.
A user executed the following SQL query, but the database returned an error.
Analyze the error against the schema and provide a direct, fully working corrected SQL query.

FAILED SQL QUERY:
\`\`\`sql
${failedQuery}
\`\`\`

DATABASE ERROR:
${errorMessage}

LIVE DATABASE SCHEMA:
${schemaDescription || 'Refer to column names and tables mentioned in query and error.'}

DEBUGGING RULES:
1. FOREIGN KEY ERRORS (e.g. violates foreign key constraint like orders_coupon_id_fkey):
   - Check which column caused the constraint failure (e.g. coupon_id referencing coupons table).
   - If that column is nullable, set it to NULL (e.g. coupon_id = NULL) or omit it, or reference a valid existing ID.
2. MISSING COLUMN ERRORS (e.g. column "xyz" does not exist):
   - Replace with the correct column name from the schema, or omit if hallucinated.
3. DATA TYPE / CONVERSION ERRORS:
   - Add proper casts (e.g. '...'::uuid, '...'::numeric, '...'::timestamp).
4. SYNTAX / TRANSACTION ERRORS:
   - Remove invalid DO $$ ... WHILE loops or invalid COMMIT; inside procedures. Use generate_series() for bulk inserts.
5. ALWAYS output a strictly valid JSON object matching:
{
  "fixedQuery": "<the complete executable corrected SQL query without markdown fences>",
  "explanation": "<1-2 sentences clearly stating what caused the failure and how it was fixed>",
  "isDangerous": false
}
Do NOT output anything other than this JSON.`;

        const result = await ModelGateway.generate({
            model: 'flux-fast',
            messages: [
                { role: 'system', content: `You are an automated SQL repair assistant. You output ONLY valid JSON: { "fixedQuery": "...", "explanation": "...", "isDangerous": boolean }.` },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        let output = result.output;
        if (!output || typeof output !== 'object' || !output.fixedQuery) {
            try {
                const clean = result.text.replace(/```json/gi, '').replace(/```/g, '').trim();
                output = JSON.parse(clean);
            } catch {
                if (/^\s*(select|with|insert|update|delete|create|drop|alter)\b/i.test(result.text)) {
                    output = { fixedQuery: result.text, explanation: 'Corrected query based on database error feedback.' };
                }
            }
        }

        if (!output?.fixedQuery) {
            return {
                success: false,
                error: 'AI was unable to generate a fix for this error. Please review the error message details.'
            };
        }

        let cleanQuery = String(output.fixedQuery).trim();
        if (cleanQuery.startsWith('```sql')) cleanQuery = cleanQuery.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();
        if (cleanQuery.startsWith('```')) cleanQuery = cleanQuery.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

        return {
            success: true,
            fixedQuery: cleanQuery,
            explanation: output.explanation || 'Fixed query syntax and constraints to match database requirements.',
            isDangerous: output.isDangerous || false
        };
    } catch (error: any) {
        logger.error('[AI SQL Fixer] Error in fixSQLErrorAction:', error);
        return { success: false, error: error.message || 'Failed to auto-fix query.' };
    }
}

