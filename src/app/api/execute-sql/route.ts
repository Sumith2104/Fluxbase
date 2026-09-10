import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { SqlEngine } from '@/lib/sql-engine';
import { getProjectById, ensureNotSuspended, getColumnsForTable } from '@/lib/data';
import { invalidateTableCache } from '@/lib/cache';
import { fireWebhooks } from '@/lib/webhooks';
import { ERROR_CODES, FluxbaseError } from '@/lib/error-codes';
import { redis } from '@/lib/redis';
import { getPgPool, handleDatabaseError } from '@/lib/pg';
import { type WebhookEvent } from '@/lib/webhooks';
import { Parser } from 'node-sql-parser';
import { assertProjectScope } from '@/lib/project-auth';
import logger from '@/lib/logger';

import { getCorsOrigin, buildCorsHeaders, corsPreflightResponse } from '@/lib/cors';

const CACHE_TTL_SECONDS = 30; // 30s burst cache for identical SELECTs

interface CacheEntry {
    result: any;
    explanation: string[];
    executionInfo: any;
    expiresAt: number;
}

export async function POST(req: NextRequest) {
    try {
        // Body size guard
        const { enforceBodySizeLimit } = await import('@/lib/body-size-limit');
        const sizeCheck = enforceBodySizeLimit(req);
        if (sizeCheck) return sizeCheck;

        // --- 1. Robust JSON Parsing ---
        let body;
        try {
            body = await req.json();
        } catch (e) {
            logger.error('[API JSON Error] Malformed body received:', e);
            throw new FluxbaseError(
                "Malformed JSON. Ensure your client is sending valid, completed JSON bodies.",
                ERROR_CODES.BAD_REQUEST,
                400
            );
        }

        if (!body || typeof body !== 'object') {
            throw new FluxbaseError("Invalid request body. Expected a JSON object.", ERROR_CODES.BAD_REQUEST, 400);
        }

        const { query, params, projectId: bodyProjectId, paginate, page, pageSize } = body;
        const { searchParams } = new URL(req.url);
        const projectId = bodyProjectId || searchParams.get('projectId');

        // --- 2. Strict Field Validation ---
        if (!query || typeof query !== 'string') {
            throw new FluxbaseError("The 'query' field is required and must be a string.", ERROR_CODES.MISSING_FIELD, 400);
        }
        if (!projectId || typeof projectId !== 'string') {
            throw new FluxbaseError("The 'projectId' field is required (either in body or as query param).", ERROR_CODES.MISSING_FIELD, 400);
        }
        if (params !== undefined && params !== null && !Array.isArray(params)) {
            throw new FluxbaseError("The 'params' field must be an array.", ERROR_CODES.BAD_REQUEST, 400);
        }

        // --- 3. Intelligent Bulk Insert Validation & Transformation ---
        let finalParams = params;
        if (query.toLowerCase().includes('jsonb_to_recordset')) {
            try {
                // Extract column names from the 'AS x(col1 type, col2 type)' clause
                const columnMatch = query.match(/AS\s+[a-zA-Z0-9_]+\s*\(([^)]+)\)/i);
                if (columnMatch && params && Array.isArray(params[0])) {
                    const columnsRaw = columnMatch[1];
                    const expectedKeys = columnsRaw.split(',').map(c => c.trim().split(/\s+/)[0].replace(/["`]/g, ''));
                    const rawData = params[0];

                    if (Array.isArray(rawData) && rawData.length > 0) {
                        // Case: Client sent Array of Arrays (Matrix), e.g. [[1, '..'], [2, '..']]
                        if (Array.isArray(rawData[0])) {
                            logger.info(`[SqlEngine] Auto-Transforming Matrix to Objects for ${expectedKeys.join(', ')}`);
                            finalParams = [
                                rawData.map((row: any[]) => {
                                    const obj: Record<string, any> = {};
                                    expectedKeys.forEach((key, idx) => {
                                        obj[key] = row[idx] !== undefined ? row[idx] : null;
                                    });
                                    return obj;
                                })
                            ];
                        }
                        // Case: Client sent Array of Objects (Correct, but validate keys)
                        else if (typeof rawData[0] === 'object' && rawData[0] !== null) {
                            const firstRow = rawData[0];
                            const missingKeys = expectedKeys.filter(k => !(k in firstRow));
                            if (missingKeys.length > 0) {
                                throw new FluxbaseError(
                                    `Invalid bulk insert payload. Expected objects with keys: ${expectedKeys.join(', ')}. Missing: ${missingKeys.join(', ')}`,
                                    ERROR_CODES.BAD_REQUEST,
                                    400
                                );
                            }
                        }
                    }
                }
            } catch (err: any) {
                if (err instanceof FluxbaseError) throw err;
                logger.warn('[Validation Error] Failed to parse bulk insert metadata:', err);
                // Continue to DB if it's an unknown parsing error, let DB handle it
            }
        }


        const auth = await getAuthContextFromRequest(req);
        if (!auth?.userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

        // Enforce API key scopes for mutating operations
        const firstWord = query.trim().split(/\s+/)[0]?.toUpperCase() || '';
        const isReadOnly = ['SELECT', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'WITH'].includes(firstWord);
        if (!isReadOnly && auth.scopes && auth.scopes.length > 0) {
            const { requireWriteScope } = await import('@/lib/require-scope');
            const scopeErr = requireWriteScope(auth);
            if (scopeErr) return scopeErr;
        }

        // Project-level suspension check is handled more granularly later after fetching the project.
        // But we keep the global check for immediate block.
        if (auth.status === 'suspended') {
            throw new FluxbaseError("Organization suspended. Please resume in Settings.", ERROR_CODES.FORBIDDEN, 403);
        }

        const userId = auth.userId;
        assertProjectScope(auth, projectId);

        // Optimization: Burst Cache (Reads only)
        const isSelect = /^\s*(?:--.*\r?\n|\/\*[\s\S]*?\*\/)*\s*SELECT/i.test(query);
        const cacheKey = isSelect ? `sql_cache:${projectId}:${Buffer.from(query + JSON.stringify(params || [])).toString('base64').substring(0, 100)}` : null;

        // Pre-Flight Optimization: Parallelize Auth, Burst Cache, and Traffic Limits
        const { checkProjectTrafficLimits } = await import('@/lib/limits');

        const [cachedResult, project, trafficLimitResult] = await Promise.all([
            isSelect ? redis.get<CacheEntry>(cacheKey!) : Promise.resolve(null),
            getProjectById(projectId, userId),
            checkProjectTrafficLimits(projectId)
                .then(() => ({ success: true as const }))
                .catch(error => ({ success: false as const, error }))
        ]);

        if (!trafficLimitResult.success) throw new FluxbaseError(`Infrastructure limit: ${trafficLimitResult.error.message}`, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429);
        if (!project) throw new FluxbaseError("Project not found", ERROR_CODES.PROJECT_NOT_FOUND, 404);

        // Granular Project Suspension Check
        await ensureNotSuspended(project);

        if (cachedResult && cachedResult.expiresAt > Date.now()) {
            // Fix: ensure cached SELECT results also return tableName and primaryKeyColumn for inline editing
            if (isSelect && cachedResult.result && !cachedResult.result.tableName) {
                try {
                    let selectTableName: string | null = null;
                    let primaryKeyColumn: string | null = null;

                    const tblMatch = query.match(/(?:FROM)\s+["'\`]?(?:[a-zA-Z0-9_]+\.)?["'\`]?([a-zA-Z0-9_]+)["'\`]?/i);
                    if (tblMatch) {
                        selectTableName = tblMatch[1];
                        const cols = await getColumnsForTable(projectId, selectTableName, userId);
                        const pk = cols.find(c => c.is_primary_key);
                        if (pk) {
                            primaryKeyColumn = pk.column_name;
                        }
                    }

                    cachedResult.result.tableName = selectTableName;
                    cachedResult.result.primaryKeyColumn = primaryKeyColumn;
                } catch (err) {
                    logger.warn('[Cache Table Match Error]', err);
                }
            }

            return NextResponse.json({
                success: true,
                result: cachedResult.result,
                explanation: [...cachedResult.explanation, 'Served via Upstash Global Edge Cache'],
                executionInfo: { ...cachedResult.executionInfo, cached: true }
            });
        }

        const startTime = Date.now();
        const engine = new SqlEngine(projectId, userId, auth.scopes, project.role, project);
        const result = await engine.execute(query, finalParams, {
            paginate: !!paginate,
            page: page !== undefined ? Number(page) : 0,
            pageSize: pageSize !== undefined ? Number(pageSize) : 50
        });
        const duration = Date.now() - startTime;

        const backgroundTasks: Promise<any>[] = [];
        let selectTableName: string | null = null;
        let primaryKeyColumn: string | null = null;

        // DML detection — hoisted so it's usable in audit log, background tasks, and response
        const upperQuery = query.trim().toUpperCase();
        const isDML = upperQuery.startsWith('INSERT') ||
                      upperQuery.startsWith('UPDATE') ||
                      upperQuery.startsWith('DELETE');
        // ON CONFLICT DO NOTHING / upsert with no change legitimately produces 0
        const hasConflictClause = /ON\s+CONFLICT/i.test(query);

        // For DML: use pg's rowCount (actual rows affected by INSERT/UPDATE/DELETE)
        // For SELECT: use result.rows.length (rows returned to the caller)
        // These must NEVER be mixed — SELECT.rowCount == rows.length in pg, but
        // reporting it as "rows_affected" for SELECT is semantically wrong.
        const rowsAffected = isDML ? (result.rowsAffected ?? 0) : 0;
        const rowsReturned = !isDML  ? (result.rowsReturned ?? result.rows?.length ?? 0) : 0;

        // 1. Post-Execution Pipeline Optimization: Do NOT await side-effects
        if (result) {

            // --- ABSOLUTE TABLE DETECTION (AST-BASED) ---
            let mutatedTable: string | null = null;
            let newDataParsed: Record<string, any> | undefined = undefined;

            try {
                const parser = new Parser();
                const ast: any = parser.astify(query);
                const sqlAst = Array.isArray(ast) ? ast[0] : ast;

                if (sqlAst) {
                    if (sqlAst.type === 'insert' || sqlAst.type === 'update' || sqlAst.type === 'delete') {
                        const tableObj = sqlAst.table ? sqlAst.table[0] : (sqlAst.from ? sqlAst.from[0] : null);
                        if (tableObj) {
                            mutatedTable = typeof tableObj === 'string' ? tableObj : (tableObj.table || tableObj.expr?.value);
                        }
                    } else if (sqlAst.type === 'select') {
                        if (Array.isArray(sqlAst.from) && sqlAst.from.length === 1) {
                            const tableObj = sqlAst.from[0];
                            if (tableObj && typeof tableObj.table === 'string') {
                                selectTableName = tableObj.table;
                            }
                        }
                    }

                    if (sqlAst.type === 'insert' && Array.isArray(sqlAst.columns)) {
                        const cols = sqlAst.columns;
                        const valsNode = Array.isArray(sqlAst.values) ? sqlAst.values : sqlAst.values?.values;
                        if (Array.isArray(valsNode) && valsNode.length > 0) {
                            const rowVals = valsNode[0].value;
                            newDataParsed = {};
                            for (let i = 0; i < cols.length; i++) {
                                newDataParsed[cols[i]] = rowVals[i]?.value ?? null;
                            }
                        }
                    }
                }
            } catch (err) {
                logger.warn('[AST Parser Fallback] Falling back to regex for detection:', err);
            }

            // Fallback: Use regex if AST extraction was unsuccessful
            if (isSelect && !selectTableName) {
                const tblMatch = query.match(/(?:FROM)\s+["'\`]?(?:[a-zA-Z0-9_]+\.)?["'\`]?([a-zA-Z0-9_]+)["'\`]?/i);
                if (tblMatch) {
                    selectTableName = tblMatch[1];
                }
            } else if (!isSelect && !mutatedTable) {
                const tblMatch = query.match(/(?:INTO|UPDATE)\s+["'\`]?(?:[a-zA-Z0-9_]+\.)?["'\`]?([a-zA-Z0-9_]+)["'\`]?/i);
                if (tblMatch) {
                    mutatedTable = tblMatch[1];
                }
            }

            if (mutatedTable) {
                const cleanMutatedTable = mutatedTable.toLowerCase();

                backgroundTasks.push((async () => {
                    await invalidateTableCache(projectId, cleanMutatedTable).catch(err => {
                        logger.warn(`[Upstash Invalidation Error] Failed to invalidate cache for ${cleanMutatedTable}:`, err);
                    });

                    const webhookEvent = upperQuery.startsWith('INSERT') ? 'row.inserted' : upperQuery.startsWith('UPDATE') ? 'row.updated' : 'row.deleted';

                    await fireWebhooks(
                        projectId,
                        userId,
                        cleanMutatedTable,
                        webhookEvent as WebhookEvent,
                        newDataParsed || (upperQuery.startsWith('INSERT') && Array.isArray(params) ? { raw_params: params } : undefined)
                    ).catch(err => logger.error(`[Webhook Dispatch Error]`, err));

                    const pool = getPgPool();
                    const payload = {
                        event_type: 'raw_sql_mutation',
                        table_id: cleanMutatedTable,
                        table_name: cleanMutatedTable,
                        operation: cleanMutatedTable ? (upperQuery.startsWith('INSERT') ? 'INSERT' : upperQuery.startsWith('UPDATE') ? 'UPDATE' : 'DELETE') : 'UNKNOWN',
                        timestamp: new Date().toISOString(),
                        project_id: projectId,
                        data: {
                            new: newDataParsed || (upperQuery.startsWith('INSERT') && Array.isArray(params) ? { raw_params: params } : undefined)
                        }
                    };
                    let payloadString = JSON.stringify(payload).replace(/'/g, "''");
                    if (Buffer.byteLength(payloadString, 'utf8') > 7500) {
                        const truncatedPayload = {
                            ...payload,
                            data: { truncated: true }
                        };
                        payloadString = JSON.stringify(truncatedPayload).replace(/'/g, "''");
                    }
                    await pool.query(`NOTIFY flux_realtime, '${payloadString}'`).catch(err => {
                        logger.warn(`[SSE Broadcast Error] Failed to fire NOTIFY:`, err);
                    });
                })());
            }

            const isSchemaChange = upperQuery.includes('CREATE ') || upperQuery.includes('DROP ') || upperQuery.includes('ALTER ') || upperQuery.includes('RENAME ');
            if (isSchemaChange) {
                backgroundTasks.push((async () => {
                    await redis.del(`schema_inference_${projectId}`).catch(err => logger.warn('Cache del error:', err));

                    const pool = getPgPool();
                    const payload = {
                        event_type: 'schema_update',
                        timestamp: new Date().toISOString(),
                        project_id: projectId
                    };
                    const payloadString = JSON.stringify(payload).replace(/'/g, "''");
                    await pool.query(`NOTIFY flux_realtime, '${payloadString}'`).catch(err => {
                        logger.warn(`[SSE Broadcast Error] Failed to fire schema_update NOTIFY:`, err);
                    });
                })());
            }
        }

        if (selectTableName) {
            try {
                const cols = await getColumnsForTable(projectId, selectTableName, userId);
                const pk = cols.find(c => c.is_primary_key);
                if (pk) {
                    primaryKeyColumn = pk.column_name;
                }
            } catch (err) {
                logger.warn(`[Primary Key Detection Failed] For table ${selectTableName}:`, err);
            }
        }

        const responseData = {
            success: true,
            result: {
                rows: result.rows || [],
                columns: result.columns || [],
                message: result.message,
                hasMore: result.hasMore,
                tableName: selectTableName,
                primaryKeyColumn: primaryKeyColumn
            },
            explanation: result.explanation || [],
            executionInfo: {
                time: `${duration}ms`,
                // Semantically correct label: SELECT → rows_returned, DML → rows_affected
                ...(isDML
                    ? { rows_affected: rowsAffected, rowCount: rowsAffected }
                    : { rows_returned: rowsReturned, rowCount: rowsReturned }),
            }
        };

        if (isSelect && cacheKey) {
            backgroundTasks.push(
                redis.set(cacheKey, {
                    result: responseData.result,
                    explanation: responseData.explanation,
                    executionInfo: responseData.executionInfo,
                    expiresAt: Date.now() + (CACHE_TTL_SECONDS * 1000)
                }, { ex: CACHE_TTL_SECONDS }).catch(redisErr => {
                    logger.warn('[Redis Error] Failed to write to global cache:', redisErr);
                })
            );
        }

        // Fire background tasks
        Promise.all(backgroundTasks).catch(e => logger.error('[Background Task Group Error]', e));

        const origin = getCorsOrigin(req.headers.get('origin'));
        const corsHeaders = buildCorsHeaders(origin);

        return NextResponse.json(responseData, {
            headers: corsHeaders
        });

    } catch (error: any) {
        logger.error('SQL Execution Failed:', error);
        const origin = getCorsOrigin(req.headers.get('origin'));
        const corsHeaders = buildCorsHeaders(origin);
        const response = error instanceof FluxbaseError
            ? NextResponse.json(error.toJSON(), { status: error.status })
            : handleDatabaseError(error);

        Object.entries(corsHeaders).forEach(([key, val]) => {
            response.headers.set(key, val);
        });
        return response;
    }
}

export async function OPTIONS(req: NextRequest) {
    return corsPreflightResponse(getCorsOrigin(req.headers.get('origin')));
}
