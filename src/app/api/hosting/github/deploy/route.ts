import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getProjectById } from '@/lib/data';
import { getGitHubToken } from '@/lib/github-token';
import { GitHubClient } from '@/lib/github-client';
import {
    getOrCreateHostingSite,
    extractZipArchive,
    uploadDeploymentAssetsToS3,
    deployToTenantsEdge,
    checkHostingDeploySize
} from '@/lib/hosting-engine';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PipelineParams {
    deployId: string;
    siteId: string;
    projectId: string;
    userId: string;
    githubRepo: string;
    owner: string;
    repo: string;
    branch: string;
    buildCommand?: string;
    outputDirectory?: string;
    installCommand?: string;
    environment: 'preview' | 'production';
    token: string;
    previewUrl: string;
    subdomain: string;
    customDomain?: string;
    autoPromote: boolean;
}

/**
 * Background worker that downloads the repo, compiles it, and uploads to edge S3
 */
async function runGitHubDeploymentPipeline(params: PipelineParams) {
    const pool = getPgPool();
    const {
        deployId,
        siteId,
        projectId,
        owner,
        repo,
        branch,
        githubRepo,
        token,
        autoPromote,
        environment,
        subdomain,
        customDomain
    } = params;

    const appendDeployLog = async (msg: string, statusOverride?: string) => {
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const line = `[${timestamp}] ${msg}`;
        logger.info(`[Deploy ${deployId}] ${msg}`);
        try {
            if (statusOverride) {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments
                     SET build_logs = COALESCE(build_logs, '') || E'\\n' || $1, status = $2
                     WHERE deploy_id = $3`,
                    [line, statusOverride, deployId]
                );
            } else {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments
                     SET build_logs = COALESCE(build_logs, '') || E'\\n' || $1
                     WHERE deploy_id = $2`,
                    [line, deployId]
                );
            }
        } catch (dbErr) {
            logger.warn(`Failed to append deploy log for ${deployId}:`, dbErr);
        }
    };

    try {
        await appendDeployLog(`Fetching repository archive from GitHub (${branch})...`);
        const client = new GitHubClient(token);
        const zipBuffer = await client.getRepoZipball(owner, repo, branch);
        const sizeKb = (zipBuffer.length / 1024).toFixed(1);
        await appendDeployLog(`Downloaded ${sizeKb} KB archive. Extracting files...`);

        const files = await extractZipArchive(zipBuffer);
        const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
        await appendDeployLog(`Extracted ${files.length} files (${(totalSizeBytes / 1024).toFixed(1)} KB).`);

        // Check hosting deploy size quota
        await checkHostingDeploySize(projectId, totalSizeBytes);

        // Update deployment with extracted file metrics
        await pool.query(
            `UPDATE fluxbase_global.hosting_deployments
             SET total_size_bytes = $1, file_count = $2, status = 'building'
             WHERE deploy_id = $3`,
            [totalSizeBytes, files.length, deployId]
        );

        // Execute build with real-time log streaming
        const { executeProjectBuild } = await import('@/lib/hosting-build');
        const buildRes = await executeProjectBuild({
            deployId,
            siteId,
            projectId,
            files,
            buildCommand: params.buildCommand,
            outputDirectory: params.outputDirectory,
            installCommand: params.installCommand
        });

        if (buildRes.framework && buildRes.framework !== 'static') {
            await pool.query(
                'UPDATE fluxbase_global.hosting_sites SET framework = $1 WHERE site_id = $2',
                [buildRes.framework, siteId]
            );
        }

        // Check if deployment was canceled by user during build
        const depCheck = await pool.query('SELECT status FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1', [deployId]);
        if (depCheck.rows[0]?.status === 'canceled') {
            await appendDeployLog('Deployment canceled before asset publication.');
            return;
        }

        // Upload compiled static assets to S3 edge storage
        await appendDeployLog(`Uploading ${buildRes.files.length} compiled assets to global CDN...`);
        const uploadStats = await uploadDeploymentAssetsToS3(projectId, deployId, buildRes.files);

        // Deploy directly to the dedicated top-tier edge server (/var/www/tenants/<subdomain>)
        await appendDeployLog(`Deploying to top-tier edge cluster (/var/www/tenants)...`);
        const siteRow = await pool.query('SELECT subdomain, custom_domain FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const sub = siteRow.rows[0]?.subdomain;
        const customDomains = siteRow.rows[0]?.custom_domain ? [siteRow.rows[0].custom_domain] : [];
        if (sub) {
            await deployToTenantsEdge(sub, buildRes.files, customDomains);
        }

        // Mark deployment live / ready
        const isProd = environment === 'production' || autoPromote;
        const finalStatus = isProd ? 'live' : 'ready';
        const now = new Date();

        await pool.query(
            `UPDATE fluxbase_global.hosting_deployments
             SET status = $1, deployed_at = $2, file_count = $3, total_size_bytes = $4
             WHERE deploy_id = $5`,
            [finalStatus, isProd ? now : null, uploadStats.fileCount, uploadStats.totalBytes, deployId]
        );

        if (isProd) {
            // Supersede previous deployment
            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET status = 'superseded', superseded_at = $1
                 WHERE site_id = $2 AND deploy_id != $3 AND status = 'live'`,
                [now, siteId, deployId]
            );

            // Update site pointer
            await pool.query(
                `UPDATE fluxbase_global.hosting_sites
                 SET production_deploy_id = $1, updated_at = $2
                 WHERE site_id = $3`,
                [deployId, now, siteId]
            );

            // Invalidate Redis cache for instant zero-downtime routing
            try {
                const { redis } = await import('@/lib/redis');
                await redis.del(`hosting:site:${subdomain}`);
                if (customDomain) {
                    await redis.del(`hosting:site:${customDomain}`);
                }
            } catch (err) {
                logger.warn('Failed to clear hosting Redis cache:', err);
            }

            await appendDeployLog(`Deployment successfully published to production! Live URL: https://${subdomain}.fluxbasedb.me`);
        } else {
            await pool.query(
                `UPDATE fluxbase_global.hosting_sites
                 SET preview_deploy_id = $1, updated_at = $2
                 WHERE site_id = $3`,
                [deployId, now, siteId]
            );
            await appendDeployLog(`Preview deployment ready! Preview URL: ${params.previewUrl}`);
        }

    } catch (err: any) {
        logger.error(`[GitHub Deploy Pipeline Failed] [${deployId}]:`, err);
        const isCanceled = err?.message?.includes('canceled by user') || err?.message?.includes('Deployment was canceled');
        if (isCanceled) {
            await appendDeployLog(`DEPLOYMENT CANCELED: Deployment was canceled by user.`, 'canceled');
            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET status = 'canceled', error_message = 'Deployment canceled by user'
                 WHERE deploy_id = $1`,
                [deployId]
            );
            return;
        }
        const errMsg = err.message || 'Deployment pipeline failed';
        await appendDeployLog(`DEPLOYMENT FAILED: ${errMsg}`, 'failed');
        await pool.query(
            `UPDATE fluxbase_global.hosting_deployments
             SET status = 'failed', error_message = $1
             WHERE deploy_id = $2`,
            [errMsg.slice(0, 500), deployId]
        );
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
            githubRepo,
            branch = 'main',
            buildCommand,
            outputDirectory,
            installCommand,
            environment = 'production',
            autoDeploy = true
        } = body;

        if (!projectId || !githubRepo) {
            return NextResponse.json({ success: false, error: 'projectId and githubRepo are required' }, { status: 400 });
        }

        const project = await getProjectById(projectId, auth.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
        }

        const token = await getGitHubToken(auth.userId);
        if (!token) {
            return NextResponse.json({
                success: false,
                connected: false,
                error: 'GitHub account is not connected. Please connect your GitHub account first.'
            }, { status: 400 });
        }

        const [owner, repo] = githubRepo.split('/');
        if (!owner || !repo) {
            return NextResponse.json({ success: false, error: 'Invalid repository name format (expected owner/repo)' }, { status: 400 });
        }

        const site = await getOrCreateHostingSite(projectId, auth.userId);

        // Enforce Single Repository Lock: Once a repository is selected, no other repository can be selected
        if (site.github_repo && site.github_repo.toLowerCase() !== githubRepo.toLowerCase()) {
            return NextResponse.json({
                success: false,
                error: `This hosting site is locked to repository "${site.github_repo}". No other repository can be selected. Please disconnect the current repository first if you wish to switch.`
            }, { status: 400 });
        }

        const pool = getPgPool();

        // Update site GitHub metadata & default commands
        await pool.query(
            `UPDATE fluxbase_global.hosting_sites 
             SET github_repo = $1, github_branch = $2, auto_deploy = $3,
                 build_command = COALESCE($4, build_command),
                 output_directory = COALESCE($5, output_directory),
                 install_command = COALESCE($6, install_command),
                 updated_at = CURRENT_TIMESTAMP
             WHERE site_id = $7`,
            [githubRepo, branch, autoDeploy, buildCommand || null, outputDirectory || null, installCommand || null, site.site_id]
        );

        // Get next version number
        const verRes = await pool.query(
            'SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM fluxbase_global.hosting_deployments WHERE site_id = $1',
            [site.site_id]
        );
        const nextVersion = parseInt(verRes.rows[0].next_ver, 10);

        const deployId = `dep_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        const previewUrl = `https://${deployId}.preview.fluxbasedb.me`;
        const s3Prefix = `hosting/${projectId}/${deployId}/`;
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const initialLogs = `[${now}] Initializing deployment for ${githubRepo} (${branch})...\n[System] Connecting to GitHub API to fetch repository archive...`;

        // Immediately create the deployment in DB with status 'uploading'
        await pool.query(
            `INSERT INTO fluxbase_global.hosting_deployments (
                deploy_id, site_id, project_id, user_id, environment, version,
                branch, source, s3_prefix, status, preview_url,
                build_command, install_command, output_directory, build_logs
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'github', $8, 'uploading', $9, $10, $11, $12, $13)`,
            [
                deployId,
                site.site_id,
                projectId,
                auth.userId,
                environment,
                nextVersion,
                branch,
                s3Prefix,
                previewUrl,
                buildCommand || site.build_command || null,
                installCommand || site.install_command || null,
                outputDirectory || site.output_directory || null,
                initialLogs
            ]
        );

        // Launch the deployment pipeline asynchronously in the background
        (async () => {
            try {
                await runGitHubDeploymentPipeline({
                    deployId,
                    siteId: site.site_id,
                    projectId,
                    userId: auth.userId,
                    githubRepo,
                    owner,
                    repo,
                    branch,
                    buildCommand: buildCommand || site.build_command,
                    outputDirectory: outputDirectory || site.output_directory,
                    installCommand: installCommand || site.install_command,
                    environment: environment as 'preview' | 'production',
                    token,
                    previewUrl,
                    subdomain: site.subdomain,
                    customDomain: site.custom_domain,
                    autoPromote: environment === 'production'
                });
            } catch (bgErr: any) {
                logger.error(`[Background GitHub Deploy Launcher Error] [${deployId}]:`, bgErr);
            }
        })();

        // Respond immediately in <100ms so frontend transitions to live terminal logs
        return NextResponse.json({
            success: true,
            deployment: {
                deploy_id: deployId,
                site_id: site.site_id,
                version: nextVersion,
                status: 'uploading',
                preview_url: previewUrl,
                branch,
                environment
            },
            previewUrl,
            liveUrl: `https://${site.subdomain}.fluxbasedb.me`
        });

    } catch (err: any) {
        logger.error('[GitHub Deploy Init Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'Deployment initialization failed' }, { status: 500 });
    }
}
