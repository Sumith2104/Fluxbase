import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { getProjectsForCurrentUser } from '@/lib/data';
import logger from '@/lib/logger';

import { requireWriteScope } from '@/lib/require-scope';

export async function GET(req: Request) {
    try {
        const auth = await getAuthContextFromRequest(req);
        if (!auth?.userId) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const allProjects = await getProjectsForCurrentUser(auth.userId);
        const projects = auth.allowedProjectId
            ? allProjects.filter(p => p.project_id === auth.allowedProjectId)
            : allProjects;
        return NextResponse.json({ success: true, projects });
    } catch (error: any) {
        logger.error('API /api/projects error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const auth = await getAuthContextFromRequest(req);
        if (!auth?.userId) {
            return NextResponse.json({ 
                success: false, 
                error: 'Unauthorized: Authentication required to create a project.' 
            }, { status: 401 });
        }

        const scopeErr = requireWriteScope(auth);
        if (scopeErr) return scopeErr;

        const body = await req.json().catch(() => ({}));
        const projectName = body.projectName || body.name || body.display_name;
        const dialect = (body.dialect === 'mysql' ? 'mysql' : 'postgresql');
        const timezone = body.timezone || 'UTC';
        const description = body.description || 'Created via Fluxbase API / MCP';
        const connectionType = body.connectionType || 'internal';
        const connectionConfig = body.connectionConfig || {};
        const userRole = body.userRole || body.role || 'employee';

        if (!projectName || typeof projectName !== 'string' || projectName.trim() === '') {
            return NextResponse.json({ 
                success: false, 
                error: 'Field "projectName" is required.' 
            }, { status: 400 });
        }

        const { createProject } = await import('@/lib/data');
        const { TenantProvisioner } = await import('@/lib/tenant-engine');
        const { getPgPool } = await import('@/lib/pg');

        // 1. Create project metadata record
        const project = await createProject(
            projectName.trim(),
            description,
            dialect,
            timezone,
            connectionType,
            connectionConfig,
            userRole
        );

        // 2. Provision instant serverless tenant schema
        if (connectionType === 'internal') {
            try {
                const tenantResult = await TenantProvisioner.createTenantSchema(
                    project.project_id,
                    dialect
                );
                const pool = getPgPool();
                await pool.query(
                    'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
                    [tenantResult.schemaName, project.project_id]
                );
                logger.info(`[MCP/API Engine] Instant Tenant Schema Created: ${tenantResult.schemaName}`);
            } catch (tenantErr: any) {
                logger.error(`[MCP/API Project Creation] Tenant provision error for ${project.project_id}:`, tenantErr);
            }
        }

        return NextResponse.json({
            success: true,
            project,
            message: `Project "${projectName.trim()}" created successfully (${dialect}).`
        }, { status: 201 });

    } catch (error: any) {
        logger.error('API POST /api/projects error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Failed to create project.' 
        }, { status: 500 });
    }
}
