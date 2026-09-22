import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireReadScope } from '@/lib/require-scope';
import { SqlEngine } from '@/lib/sql-engine';
import { getProjectById } from '@/lib/data';
import { redis } from '@/lib/redis';
import { getProjectDbAndSchema } from '@/lib/tenant-pools';
import { trackApiRequest } from '@/lib/analytics';
import logger from '@/lib/logger';

// In-memory schema cache to prevent RDS query storming (60s TTL)
const inMemorySchemaCache = new Map<string, { data: any; expiry: number }>();
// In-flight request deduplication (SingleFlight pattern)
const inFlightRequests = new Map<string, Promise<any>>();

export async function GET(request: Request) {
    try {
        const auth = await getAuthContextFromRequest(request);
        const scopeErr = requireReadScope(auth);
        if (scopeErr) return scopeErr;
        if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        let projectId = searchParams.get('projectId');
        const refresh = searchParams.get('refresh') === 'true';

        if (auth.allowedProjectId && projectId && projectId !== auth.allowedProjectId) {
            return NextResponse.json({ success: false, error: 'This API key is not allowed to access the requested project.' }, { status: 403 });
        }
        if (!projectId && auth.allowedProjectId) {
            projectId = auth.allowedProjectId;
        }

        if (!projectId) {
            return NextResponse.json({ success: false, error: 'Missing projectId' }, { status: 400 });
        }

        const now = Date.now();

        // 1. In-memory cache hit
        const memCached = inMemorySchemaCache.get(projectId);
        if (!refresh && memCached && memCached.expiry > now) {
            return NextResponse.json(memCached.data);
        }

        // 2. Request deduplication (join existing in-flight database query)
        if (!refresh && inFlightRequests.has(projectId)) {
            const result = await inFlightRequests.get(projectId);
            return NextResponse.json(result);
        }

        const fetchPromise = (async () => {
            const project = await getProjectById(projectId!, auth.userId);
            if (!project) {
                return { success: false, error: 'Project not found' };
            }

            trackApiRequest(projectId!, 'api_call');

            if (project.ai_schema_inference === false) {
                const emptyPayload = {
                    success: true,
                    tables: {},
                    views: [],
                    indexes: [],
                    functions: [],
                    extensions: [],
                    message: "Schema inference is disabled for this project."
                };
                inMemorySchemaCache.set(projectId!, { data: emptyPayload, expiry: Date.now() + 60000 });
                return emptyPayload;
            }

            const cacheKey = `schema_inference_${projectId}`;
            if (!refresh) {
                try {
                    const cachedSchema = await redis.get(cacheKey) as any;
                    if (cachedSchema) {
                        inMemorySchemaCache.set(projectId!, { data: cachedSchema, expiry: Date.now() + 60000 });
                        return cachedSchema;
                    }
                } catch (e) {
                    logger.warn('Redis schema cache read error:', e);
                }
            }

            const { dbName, schemaName } = getProjectDbAndSchema(project);
            const engine = new SqlEngine(projectId!, auth.userId, undefined, undefined, project);

            let resultTables, resultViews, resultIndexes, resultFunctions, resultExtensions;
            const isExternal = project.connection_type && project.connection_type !== 'internal';

            if (project.dialect?.toLowerCase() === 'mysql') {
                [resultTables, resultViews, resultIndexes, resultFunctions] = await Promise.all([
                    engine.execute(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name NOT LIKE '_flux_internal_%';`, [dbName || '']),
                    engine.execute(`SELECT table_name FROM information_schema.views WHERE table_schema = ? AND table_name NOT LIKE '_flux_internal_%';`, [dbName || '']),
                    engine.execute(`SELECT index_name, table_name FROM information_schema.statistics WHERE table_schema = ?;`, [dbName || '']),
                    engine.execute(`SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION';`, [dbName || ''])
                ]);

                if (isExternal && (!resultTables?.rows || resultTables.rows.length === 0)) {
                    [resultTables, resultViews, resultIndexes, resultFunctions] = await Promise.all([
                        engine.execute(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') AND table_name NOT LIKE '_flux_internal_%' ORDER BY table_name, ordinal_position;`),
                        engine.execute(`SELECT table_name FROM information_schema.views WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') AND table_name NOT LIKE '_flux_internal_%';`),
                        engine.execute(`SELECT index_name, table_name FROM information_schema.statistics WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys');`),
                        engine.execute(`SELECT routine_name FROM information_schema.routines WHERE routine_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') AND routine_type = 'FUNCTION';`)
                    ]);
                }
                resultExtensions = { rows: [] };
            } else {
                [resultTables, resultViews, resultIndexes, resultFunctions, resultExtensions] = await Promise.all([
                    engine.execute(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name NOT LIKE '_flux_internal_%' AND table_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault') ORDER BY table_name, ordinal_position;`, [schemaName]),
                    engine.execute(`SELECT table_name FROM information_schema.views WHERE table_schema = $1 AND table_name NOT LIKE '_flux_internal_%' AND table_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault');`, [schemaName]),
                    engine.execute(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = $1 AND schemaname NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault');`, [schemaName]),
                    engine.execute(`SELECT routine_name FROM information_schema.routines WHERE routine_schema = $1 AND routine_type = 'FUNCTION' AND routine_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault');`, [schemaName]),
                    engine.execute(`SELECT extname FROM pg_extension;`)
                ]);

                if (isExternal && (!resultTables?.rows || resultTables.rows.length === 0) && schemaName !== 'public') {
                    [resultTables, resultViews, resultIndexes, resultFunctions] = await Promise.all([
                        engine.execute(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE '_flux_internal_%' AND table_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault') ORDER BY table_name, ordinal_position;`),
                        engine.execute(`SELECT table_name FROM information_schema.views WHERE table_schema = 'public' AND table_name NOT LIKE '_flux_internal_%' AND table_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault');`),
                        engine.execute(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public';`),
                        engine.execute(`SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';`)
                    ]);
                }
            }

            const schemaGraph: Record<string, any[]> = {};
            if (resultTables && resultTables.rows) {
                for (const row of resultTables.rows) {
                    const tName = row.table_name || row.TABLE_NAME;
                    const cName = row.column_name || row.COLUMN_NAME;
                    const dType = row.data_type || row.DATA_TYPE;

                    if (!schemaGraph[tName]) schemaGraph[tName] = [];
                    schemaGraph[tName].push({ name: cName, type: dType });
                }
            }

            const views = (resultViews?.rows || []).map((r: any) => r.table_name || r.TABLE_NAME);
            const indexes = (resultIndexes?.rows || []).map((r: any) => ({
                name: r.indexname || r.index_name || r.INDEX_NAME, 
                table: r.tablename || r.table_name || r.TABLE_NAME
            }));
            const functions = (resultFunctions?.rows || []).map((r: any) => r.routine_name || r.ROUTINE_NAME);
            const extensions = (resultExtensions?.rows || []).map((r: any) => r.extname || r.EXTNAME);

            const payload = {
                success: true,
                tables: schemaGraph,
                views,
                indexes,
                functions,
                extensions
            };

            inMemorySchemaCache.set(projectId!, { data: payload, expiry: Date.now() + 60000 });

            try {
                await redis.set(cacheKey, payload, { ex: 3600 });
            } catch (e) {
                logger.warn('Redis schema cache write error:', e);
            }

            return payload;
        })();

        inFlightRequests.set(projectId, fetchPromise);
        let payload;
        try {
            payload = await fetchPromise;
        } finally {
            inFlightRequests.delete(projectId);
        }

        return NextResponse.json(payload);

    } catch (error: any) {
        logger.error('[Schema API Error]', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Error' }, { status: 500 });
    }
}
