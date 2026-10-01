import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireReadScope, requireWriteScope } from '@/lib/require-scope';
import { getProjectById } from '@/lib/data';
import { getPgPool } from '@/lib/pg';
import { ERROR_CODES } from '@/lib/error-codes';
import { validateSubdomain, getOrCreateHostingSite } from '@/lib/hosting-engine';
import { checkHostingSiteLimit, getProjectOwnerPlan, PLAN_HOSTING_LIMITS } from '@/lib/limits';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
        return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const project = await getProjectById(projectId, auth.userId);
    if (!project) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    try {
        const pool = getPgPool();
        const siteRes = await pool.query(
            `SELECT s.*,
                    p_dep.version as prod_version, p_dep.deployed_at as prod_deployed_at, p_dep.file_count as prod_file_count, p_dep.total_size_bytes as prod_size_bytes,
                    prev_dep.version as prev_version, prev_dep.deployed_at as prev_deployed_at, prev_dep.preview_url as prev_url
             FROM fluxbase_global.hosting_sites s
             LEFT JOIN fluxbase_global.hosting_deployments p_dep ON p_dep.deploy_id = s.production_deploy_id
             LEFT JOIN fluxbase_global.hosting_deployments prev_dep ON prev_dep.deploy_id = s.preview_deploy_id
             WHERE s.project_id = $1`,
            [projectId]
        );

        const plan = await getProjectOwnerPlan(projectId);
        const limits = PLAN_HOSTING_LIMITS[plan] || PLAN_HOSTING_LIMITS.free;

        const site = siteRes.rows[0] || null;

        // Fetch usage summary (total deployments, bandwidth this month)
        let usage = { deploymentsCount: 0, bandwidthBytes: 0, requestsCount: 0 };
        if (site) {
            const usageRes = await pool.query(
                `SELECT 
                    (SELECT COUNT(*) FROM fluxbase_global.hosting_deployments WHERE site_id = $1) as deploy_count,
                    COALESCE(SUM(bytes_served), 0) as bandwidth_bytes,
                    COUNT(*) as request_count
                 FROM fluxbase_global.hosting_access_logs
                 WHERE site_id = $1 AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
                [site.site_id]
            );
            if (usageRes.rows[0]) {
                usage = {
                    deploymentsCount: parseInt(usageRes.rows[0].deploy_count || '0', 10),
                    bandwidthBytes: parseInt(usageRes.rows[0].bandwidth_bytes || '0', 10),
                    requestsCount: parseInt(usageRes.rows[0].request_count || '0', 10),
                };
            }
        }

        return NextResponse.json({
            success: true,
            site,
            plan,
            limits: {
                ...limits,
                bandwidthBytesMonthly: limits.bandwidthBytesMonthly.toString(),
                totalStorageBytes: limits.totalStorageBytes.toString(),
                deploySizeBytes: limits.deploySizeBytes.toString()
            },
            usage
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const {
            projectId,
            subdomain,
            isSpa,
            framework,
            rootDirectory,
            notFoundPage,
            aiModelsEnabled,
            buildCommand,
            outputDirectory,
            installCommand,
            githubRepo,
            branch,
            envVars,
            rawEnvText,
            environment = 'production'
        } = body;

        if (!projectId) {
            return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
        }

        const project = await getProjectById(projectId, auth.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
        }

        const pool = getPgPool();
        const existing = await pool.query(
            'SELECT * FROM fluxbase_global.hosting_sites WHERE project_id = $1',
            [projectId]
        );

        if (existing.rows.length === 0) {
            // Check quota before creating
            await checkHostingSiteLimit(projectId);

            if (subdomain) {
                const val = validateSubdomain(subdomain);
                if (!val.valid) {
                    return NextResponse.json({ success: false, error: val.error }, { status: 400 });
                }
            }

            const site = await getOrCreateHostingSite(projectId, auth.userId, subdomain);

            if (framework || buildCommand || outputDirectory || installCommand || rootDirectory || githubRepo) {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites 
                     SET framework = COALESCE($1, framework),
                         build_command = COALESCE($2, build_command),
                         output_directory = COALESCE($3, output_directory),
                         install_command = COALESCE($4, install_command),
                         root_directory = COALESCE($5, root_directory),
                         github_repo = COALESCE($6, github_repo),
                         github_branch = COALESCE($7, github_branch)
                     WHERE site_id = $8`,
                    [
                        framework || null,
                        buildCommand || null,
                        outputDirectory || null,
                        installCommand || null,
                        rootDirectory || null,
                        githubRepo || null,
                        branch || 'main',
                        site.site_id
                    ]
                );
            }

            // Save environment variables if provided during site provisioning
            let savedEnvCount = 0;
            if (envVars || rawEnvText) {
                const { saveSiteEnvVars } = await import('@/lib/hosting-env');
                const envRes = await saveSiteEnvVars({
                    siteId: site.site_id,
                    projectId,
                    envVars,
                    rawEnvText,
                    environment
                });
                savedEnvCount = envRes.savedCount;
            }

            const refreshed = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [site.site_id]);
            return NextResponse.json({ success: true, site: refreshed.rows[0], savedEnvCount });
        }

        const site = existing.rows[0];

        // If environment variables were submitted when updating the site
        if (envVars || rawEnvText) {
            const { saveSiteEnvVars } = await import('@/lib/hosting-env');
            await saveSiteEnvVars({
                siteId: site.site_id,
                projectId,
                envVars,
                rawEnvText,
                environment
            });
        }

        if (body.action === 'restart-backend') {
            const { restartBackendProcess } = await import('@/lib/hosting-runner');
            const res = await restartBackendProcess(site.site_id);
            if (res.success) {
                const refreshed = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [site.site_id]);
                return NextResponse.json({ success: true, message: `Backend process restarted on port ${res.port}`, site: refreshed.rows[0] });
            } else {
                return NextResponse.json({ success: false, error: res.error }, { status: 500 });
            }
        }

        // Updating existing site
        const updates: string[] = [];
        const values: any[] = [];
        let pIndex = 1;

        if (subdomain && subdomain !== site.subdomain) {
            const val = validateSubdomain(subdomain);
            if (!val.valid) {
                return NextResponse.json({ success: false, error: val.error }, { status: 400 });
            }
            // Check subdomain collision
            const check = await pool.query(
                'SELECT site_id FROM fluxbase_global.hosting_sites WHERE subdomain = $1 AND site_id != $2',
                [subdomain, site.site_id]
            );
            if (check.rows.length > 0) {
                return NextResponse.json({ success: false, error: 'Subdomain already taken' }, { status: 409 });
            }
            updates.push(`subdomain = $${pIndex++}`);
            values.push(subdomain.toLowerCase().trim());
        }

        if (typeof isSpa === 'boolean') {
            updates.push(`is_spa = $${pIndex++}`);
            values.push(isSpa);
        }

        if (framework) {
            updates.push(`framework = $${pIndex++}`);
            values.push(framework);
        }

        if (rootDirectory !== undefined) {
            updates.push(`root_directory = $${pIndex++}`);
            values.push(rootDirectory || '/');
        }

        if (notFoundPage !== undefined) {
            updates.push(`not_found_page = $${pIndex++}`);
            values.push(notFoundPage || '/404.html');
        }

        if (typeof aiModelsEnabled === 'boolean') {
            updates.push(`ai_models_enabled = $${pIndex++}`);
            values.push(aiModelsEnabled);
        }

        if (buildCommand !== undefined) {
            updates.push(`build_command = $${pIndex++}`);
            values.push(buildCommand || null);
        }

        if (outputDirectory !== undefined) {
            updates.push(`output_directory = $${pIndex++}`);
            values.push(outputDirectory || null);
        }

        if (installCommand !== undefined) {
            updates.push(`install_command = $${pIndex++}`);
            values.push(installCommand || null);
        }

        if (githubRepo !== undefined) {
            updates.push(`github_repo = $${pIndex++}`);
            values.push(githubRepo || null);
        }

        if (branch !== undefined) {
            updates.push(`github_branch = $${pIndex++}`);
            values.push(branch || 'main');
        }

        if (updates.length > 0) {
            updates.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(site.site_id);
            const query = `UPDATE fluxbase_global.hosting_sites SET ${updates.join(', ')} WHERE site_id = $${pIndex} RETURNING *`;
            const updated = await pool.query(query, values);

            // Invalidate Redis cache
            try {
                const { redis } = await import('@/lib/redis');
                await redis.del(`hosting:site:${site.subdomain}`);
                if (subdomain) await redis.del(`hosting:site:${subdomain}`);
            } catch {}

            return NextResponse.json({ success: true, site: updated.rows[0] });
        }

        return NextResponse.json({ success: true, site });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    if (!siteId) {
        return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });
    }

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const pool = getPgPool();
        const siteRes = await pool.query(
            'SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1',
            [siteId]
        );
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        // Clean up tenant directory and custom domain symlinks on edge server
        try {
            const { deleteFromTenantsEdge } = await import('@/lib/hosting-engine');
            const customDomains = site.custom_domain ? [site.custom_domain] : [];
            await deleteFromTenantsEdge(site.subdomain, customDomains);
        } catch (edgeErr: any) {
            console.error('Failed to clean up edge tenant files:', edgeErr?.message);
        }

        await pool.query('DELETE FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);

        try {
            const { redis } = await import('@/lib/redis');
            await redis.del(`hosting:site:${site.subdomain}`);
            if (site.custom_domain) {
                await redis.del(`hosting:site:${site.custom_domain}`);
            }
        } catch {}

        return NextResponse.json({ success: true, message: 'Hosting site deleted. Database project remains intact.' });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
