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
