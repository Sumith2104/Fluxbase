import { config } from 'dotenv';
config({ path: '.env.local' });
import { Pool } from 'pg';
import logger from '@/lib/logger';

async function retrofitTriggers() {
    if (!process.env.AWS_RDS_POSTGRES_URL) {
        throw new Error("Missing AWS_RDS_POSTGRES_URL");
    }

    const pool = new Pool({
        connectionString: process.env.AWS_RDS_POSTGRES_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();

        // 1. Get all relevant schemas (all project schemas + global AI schema)
        logger.info('Fetching target schemas...');
        const schemasRes = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'project_%' OR schema_name = 'fluxbase_global'
        `);

        for (const { schema_name } of schemasRes.rows) {
            logger.info(`\nProcessing schema: ${schema_name}`);
            
            // Extract project_id or default to 'global'
            const projectId = schema_name === 'fluxbase_global' ? 'global' : schema_name.replace('project_', '');

            // 2. Create the unified notify_realtime_event function in the schema
            const triggerFunctionSql = `
                CREATE OR REPLACE FUNCTION "${schema_name}".notify_realtime_event()
                RETURNS trigger AS $$
                DECLARE
                  payload JSON;
                  row_data RECORD;
                  v_count INT;
                BEGIN
                  -- Support skipping triggers for bulk operations
                  IF current_setting('fluxbase.skip_realtime_triggers', true) = 'true' THEN
                    RETURN COALESCE(NEW, OLD);
                  END IF;

                  -- Statement/batch safeguard: suppress per-row notify on bulk operations (> 100 rows)
                  v_count := COALESCE(NULLIF(current_setting('fluxbase.rt_count', true), '')::int, 0) + 1;
                  IF v_count > 100 THEN
                    RETURN COALESCE(NEW, OLD);
                  END IF;
                  PERFORM set_config('fluxbase.rt_count', v_count::text, true);

                  IF TG_OP = 'DELETE' THEN
                    row_data := OLD;
                  ELSE
                    row_data := NEW;
                  END IF;

                  payload := json_build_object(
                    'table', TG_TABLE_NAME,
                    'project_id', '${projectId}',
                    'action', TG_OP,
                    'record', row_to_json(row_data)
                  );

                  -- Postgres NOTIFY has a hard limit of 8000 bytes.
                  -- If exceeded, we send a truncated payload to avoid failing the transaction.
                  IF octet_length(payload::text) > 7500 THEN
                    payload := json_build_object(
                      'table', TG_TABLE_NAME,
                      'project_id', '${projectId}',
                      'action', TG_OP,
                      'record', json_build_object('id', row_to_json(row_data)->'id'),
                      'truncated', true
                    );
                  END IF;

                  -- Broadcast to the new Render WS channel
                  PERFORM pg_notify('flux_realtime', payload::text);
                  RETURN row_data;
                END;
                $$ LANGUAGE plpgsql;
            `;

            try {
                await client.query(triggerFunctionSql);
                logger.info(`  ✓ Created New RT function for ${schema_name}`);
            } catch (e) {
                logger.error(`  ✗ Failed to create RT function for ${schema_name}:`, e);
                continue;
            }

            // 3. Get all tables in this schema
            const tablesRes = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = $1 AND table_type = 'BASE TABLE'
            `, [schema_name]);

            // 4. Attach trigger to each table
            for (const { table_name } of tablesRes.rows) {
                const attachTriggerSql = `
                    DROP TRIGGER IF EXISTS "${table_name}_ws_trigger" ON "${schema_name}"."${table_name}";
                    CREATE TRIGGER "${table_name}_ws_trigger"
                    AFTER INSERT OR UPDATE OR DELETE
                    ON "${schema_name}"."${table_name}"
                    FOR EACH ROW
                    EXECUTE FUNCTION "${schema_name}".notify_realtime_event();
                `;

                try {
                    await client.query(attachTriggerSql);
                    logger.info(`    ✓ Attached trigger to ${table_name}`);
                } catch (e) {
                    logger.error(`    ✗ Failed to attach trigger to ${table_name}:`, e);
                }
            }
        }

        client.release();
        logger.info('\nRetrofit complete!');
    } catch (e) {
        logger.error('Migration failed', e);
    } finally {
        await pool.end();
    }
}

retrofitTriggers();
