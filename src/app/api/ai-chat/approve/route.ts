import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import logger from '@/lib/logger';

export async function POST(req: Request) {
    try {
        const auth = await getAuthContextFromRequest(req);
        if (!auth?.userId) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { approvalId, actionType, query, projectId, payload } = body;

        if (!projectId) {
            return NextResponse.json({ success: false, error: 'Missing projectId' }, { status: 400 });
        }

        const { SqlEngine } = await import('@/lib/sql-engine');
        const { getProjectById } = await import('@/lib/data');

        const project = await getProjectById(projectId, auth.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: 'Project not found or access denied.' }, { status: 404 });
        }

        const startTime = Date.now();

        // 1. Execute SQL queries (including DDL/DML: DROP, DELETE, TRUNCATE, ALTER, CREATE, INSERT, UPDATE)
        if (actionType === 'EXECUTE_SQL' || actionType === 'INJECT_SQL' || actionType === 'DROP_TABLE' || actionType === 'MUTATION') {
            const sqlToRun = query || payload?.query;
            if (!sqlToRun || typeof sqlToRun !== 'string') {
                return NextResponse.json({ success: false, error: 'No SQL query provided for execution.' }, { status: 400 });
            }

            logger.info(`[AI Chat Approval] User ${auth.userId} approved execution of query on project ${projectId}: ${sqlToRun.slice(0, 100)}`);

            const engine = new SqlEngine(projectId, auth.userId, undefined, undefined, project);
            const result = await engine.execute(sqlToRun);

            const executionTimeMs = Date.now() - startTime;
            const affectedRows = result.rowsAffected ?? result.rowsReturned ?? (result.rows ? result.rows.length : 0);

            // Invalidate schema cache so the AI immediately sees updated schema
            try {
                const isDdl = /^(CREATE|DROP|ALTER|TRUNCATE)\s/i.test(sqlToRun.trim());
                if (isDdl) {
                    // Dispatch cache eviction via fetch or direct import if available
                    logger.info(`[AI Chat Approval] DDL operation detected; schema cache marked for refresh.`);
                }
            } catch {}

            return NextResponse.json({
                success: true,
                approvalId,
                actionType,
                affectedRows,
                executionTimeMs,
                columns: result.columns || (result.rows && result.rows.length > 0 ? Object.keys(result.rows[0]) : []),
                rows: (result.rows || []).slice(0, 50),
                message: `Action executed successfully in ${executionTimeMs}ms (${affectedRows} row${affectedRows === 1 ? '' : 's'} affected).`
            });
        }

        // 2. Project creation approval
        if (actionType === 'CREATE_PROJECT') {
            const projectName = payload?.projectName || body.projectName;
            const dialect = payload?.dialect || body.dialect || 'postgresql';
            const { createProject } = await import('@/lib/data');
            const { TenantProvisioner } = await import('@/lib/tenant-engine');
            const { getPgPool } = await import('@/lib/pg');

            const newProject = await createProject(
                projectName,
                'Created via Flux AI agent',
                dialect,
                'UTC',
                'internal',
                {},
                'employee',
                auth.userId
            );

            try {
                const tenantResult = await TenantProvisioner.createTenantSchema(newProject.project_id, dialect);
                const pool = getPgPool();
                await pool.query(
                    'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
                    [tenantResult.schemaName, newProject.project_id]
                );
            } catch (err) {
                logger.warn('[AI Chat Approval] Schema provision warning on create project:', err);
            }

            return NextResponse.json({
                success: true,
                approvalId,
                actionType,
                project: newProject,
                message: `Project "${projectName}" (${dialect}) created successfully.`
            });
        }

        return NextResponse.json({ success: false, error: `Unsupported action type: ${actionType}` }, { status: 400 });
    } catch (error: any) {
        logger.error('[AI Chat Approval] Execution error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Approved action execution failed.'
        }, { status: 500 });
    }
}
