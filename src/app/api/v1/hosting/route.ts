import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope, requireReadScope } from '@/lib/require-scope';
import { getProjectById } from '@/lib/data';
import { getPgPool } from '@/lib/pg';
import {
    getOrCreateHostingSite,
    createDeployment,
    promoteDeploymentToProduction,
    extractZipArchive,
    ExtractedFile,
    detectMimeType,
    sanitizePath
} from '@/lib/hosting-engine';
import { encryptEnvValue } from '@/lib/hosting-env';

export const dynamic = 'force-dynamic';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    };
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
        return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400, headers: corsHeaders() });
    }

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
    }

    const project = await getProjectById(projectId, auth.userId);
    if (!project) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404, headers: corsHeaders() });
    }

    try {
        const pool = getPgPool();
        const siteRes = await pool.query(
            `SELECT s.*, 
                    d.version as live_version, d.file_count, d.total_size_bytes, d.deployed_at as live_deployed_at
             FROM fluxbase_global.hosting_sites s
             LEFT JOIN fluxbase_global.hosting_deployments d ON d.deploy_id = s.production_deploy_id
             WHERE s.project_id = $1`,
            [projectId]
        );

        const site = siteRes.rows[0] || null;
        let deployments: any[] = [];

        if (site) {
            const depRes = await pool.query(
                `SELECT deploy_id, version, environment, status, source, preview_url, branch_url, branch, framework_slug,
                        total_size_bytes, file_count, created_at, deployed_at
                 FROM fluxbase_global.hosting_deployments
                 WHERE site_id = $1
                 ORDER BY version DESC LIMIT 20`,
                [site.site_id]
            );
            deployments = depRes.rows;
        }

        return NextResponse.json({
            success: true,
            site: site ? {
                siteId: site.site_id,
                subdomain: site.subdomain,
                customDomain: site.custom_domain,
                url: `https://${site.subdomain}.fluxbasedb.me`,
                status: site.status,
                framework: site.framework,
                isSpa: site.is_spa,
                aiModelsEnabled: site.ai_models_enabled,
                liveDeployment: site.production_deploy_id ? {
                    deployId: site.production_deploy_id,
                    version: site.live_version,
                    fileCount: site.file_count,
                    totalSizeBytes: site.total_size_bytes,
                    deployedAt: site.live_deployed_at
                } : null
            } : null,
            deployments
        }, { headers: corsHeaders() });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders() });
    }
}

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
    }

    try {
        const body = await req.json();
        const { action = 'deploy', projectId } = body;

        if (!projectId) {
            return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400, headers: corsHeaders() });
        }

        const project = await getProjectById(projectId, auth.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404, headers: corsHeaders() });
        }

        const site = await getOrCreateHostingSite(projectId, auth.userId);

        if (action === 'promote') {
            const { deployId } = body;
            if (!deployId) return NextResponse.json({ success: false, error: 'deployId is required for promote' }, { status: 400, headers: corsHeaders() });
            const result = await promoteDeploymentToProduction(site.site_id, deployId);
            return NextResponse.json(result, { headers: corsHeaders() });
        }

        if (action === 'env') {
            const { envVars = {}, environment = 'production' } = body;
            const pool = getPgPool();
            const saved: string[] = [];
            for (const [key, value] of Object.entries(envVars)) {
                if (typeof value === 'string') {
                    const encrypted = encryptEnvValue(value);
                    const isSec = !(key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('PUBLIC_'));
                    await pool.query(
                        `INSERT INTO fluxbase_global.hosting_env_vars (
                            site_id, environment, key, value, is_secret
                        ) VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (site_id, environment, key)
                        DO UPDATE SET value = $4, is_secret = $5, updated_at = CURRENT_TIMESTAMP`,
                        [site.site_id, environment, key, encrypted, isSec]
                    );
                    saved.push(key);
                }
            }
            return NextResponse.json({ success: true, updatedKeys: saved }, { headers: corsHeaders() });
        }

        // Default action: deploy
        const environment = body.environment === 'production' ? 'production' : 'preview';
        let files: ExtractedFile[] = [];

        if (body.zipBase64) {
            const zipBuf = Buffer.from(body.zipBase64, 'base64');
            files = await extractZipArchive(zipBuf);
        } else if (body.files && typeof body.files === 'object') {
            for (const [filePath, content] of Object.entries(body.files)) {
                const safe = sanitizePath(filePath);
                const buf = Buffer.isBuffer(content)
                    ? content
                    : Buffer.from(content as string, typeof content === 'string' && content.startsWith('data:') ? 'base64' : 'utf8');
                files.push({
                    path: safe,
                    buffer: buf,
                    size: buf.length,
                    mimeType: detectMimeType(safe)
                });
            }
        }

        if (files.length === 0) {
            return NextResponse.json({ success: false, error: 'No files provided (expected files dictionary or zipBase64)' }, { status: 400, headers: corsHeaders() });
        }

        // Set env vars if provided in the deploy call
        if (body.envVars && typeof body.envVars === 'object') {
            const pool = getPgPool();
            for (const [key, value] of Object.entries(body.envVars)) {
                if (typeof value === 'string') {
                    const encrypted = encryptEnvValue(value);
                    const isSec = !(key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('PUBLIC_'));
                    await pool.query(
                        `INSERT INTO fluxbase_global.hosting_env_vars (
                            site_id, environment, key, value, is_secret
                        ) VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (site_id, environment, key)
                        DO UPDATE SET value = $4, is_secret = $5, updated_at = CURRENT_TIMESTAMP`,
                        [site.site_id, environment, key, encrypted, isSec]
                    );
                }
            }
        }

        const result = await createDeployment({
            siteId: site.site_id,
            projectId,
            userId: auth.userId,
            environment,
            source: 'api',
            files,
            autoPromote: environment === 'production'
        });

        return NextResponse.json({
            success: true,
            deployment: {
                deployId: result.deployment.deploy_id,
                version: result.deployment.version,
                environment: result.deployment.environment,
                status: result.deployment.status,
                fileCount: result.deployment.file_count,
                totalSizeBytes: result.deployment.total_size_bytes,
                url: result.liveUrl,
                previewUrl: result.previewUrl,
                createdAt: result.deployment.created_at,
                deployedAt: result.deployment.deployed_at
            }
        }, { headers: corsHeaders() });

    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders() });
    }
}
