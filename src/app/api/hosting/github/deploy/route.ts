import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getProjectById } from '@/lib/data';
import { getGitHubToken } from '@/lib/github-token';
import { getOrCreateHostingSite, executeGitHubDeployment } from '@/lib/hosting-engine';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

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
            autoDeploy = true,
            envVars,
            rawEnvText
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

        // Save environment variables if provided
        if (envVars || rawEnvText) {
            const { saveSiteEnvVars } = await import('@/lib/hosting-env');
            await saveSiteEnvVars({
                siteId: site.site_id,
                projectId,
                envVars,
                rawEnvText,
                environment: environment as 'preview' | 'production'
            });
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

        // Execute unified GitHub deployment
        const result = await executeGitHubDeployment({
            siteId: site.site_id,
            projectId,
            userId: auth.userId,
            branch,
            buildCommand,
            outputDirectory,
            installCommand,
            environment: environment as 'preview' | 'production',
            autoPromote: environment === 'production',
            asyncExecution: true
        });

        return NextResponse.json({
            success: true,
            deployment: {
                deploy_id: result.deployId,
                site_id: site.site_id,
                version: result.version,
                status: 'uploading',
                preview_url: result.previewUrl,
                live_url: result.liveUrl
            },
            previewUrl: result.previewUrl,
            liveUrl: result.liveUrl,
            message: `Deployment initiated for ${githubRepo}@${branch}`
        });

    } catch (err: any) {
        logger.error('Error in GitHub deploy route:', err);
        return NextResponse.json({ success: false, error: err.message || 'Deployment initiation failed' }, { status: 500 });
    }
}
