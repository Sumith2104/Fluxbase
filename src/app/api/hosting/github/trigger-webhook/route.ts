import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getGitHubToken } from '@/lib/github-token';
import { GitHubClient } from '@/lib/github-client';
import { extractZipArchive, uploadDeploymentAssetsToS3, checkHostingDeploySize } from '@/lib/hosting-engine';
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
        const { siteId } = await req.json();
        if (!siteId) {
            return NextResponse.json({ success: false, error: 'siteId is required' }, { status: 400 });
        }

        const pool = getPgPool();
        const siteRes = await pool.query(
            'SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1 AND user_id = $2',
            [siteId, auth.userId]
        );

        if (siteRes.rows.length === 0) {
            return NextResponse.json({ success: false, error: 'Site not found or unauthorized' }, { status: 404 });
        }

        const site = siteRes.rows[0];
        if (!site.github_repo) {
            return NextResponse.json({ success: false, error: 'No GitHub repository is connected to this site' }, { status: 400 });
        }

        const token = await getGitHubToken(auth.userId);
        if (!token) {
            return NextResponse.json({ success: false, error: 'GitHub token not found. Please reconnect GitHub.' }, { status: 401 });
        }

        const [owner, repo] = site.github_repo.split('/');
        const branch = site.github_branch || 'main';
        const client = new GitHubClient(token);

        // Fetch latest commit metadata from GitHub
        let commitSha = '';
        let commitMessage = 'Manual test auto-deploy';
        let author = 'You';

        try {
            const commitInfo = await client.getLatestCommit(owner, repo, branch);
            commitSha = commitInfo.sha;
            commitMessage = commitInfo.message;
            author = commitInfo.author;
        } catch (cErr) {
            logger.warn('Failed to fetch latest commit details:', cErr);
        }

        // Get next version number
        const verRes = await pool.query(
            'SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM fluxbase_global.hosting_deployments WHERE site_id = $1',
            [site.site_id]
        );
        const nextVersion = parseInt(verRes.rows[0].next_ver, 10);

        const deployId = `dep_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        const previewUrl = `https://${deployId}.preview.fluxbasedb.me`;
        const s3Prefix = `hosting/${site.project_id}/${deployId}/`;
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

        const initialLogs = `[${now}] Auto-deploy triggered for commit ${commitSha ? commitSha.slice(0, 7) : 'latest'} by ${author} on branch ${branch}\n[Commit Message] ${commitMessage.trim()}\n[System] Connecting to GitHub to fetch source archive...`;

        await pool.query(
            `INSERT INTO fluxbase_global.hosting_deployments (
                deploy_id, site_id, project_id, user_id, environment, version,
                commit_sha, commit_message, branch, source, s3_prefix, status, preview_url,
                build_command, install_command, output_directory, build_logs
            ) VALUES ($1, $2, $3, $4, 'production', $5, $6, $7, $8, 'github', $9, 'uploading', $10, $11, $12, $13, $14)`,
            [
                deployId,
                site.site_id,
                site.project_id,
                site.user_id,
                nextVersion,
                commitSha || null,
                commitMessage || null,
                branch,
                s3Prefix,
                previewUrl,
                site.build_command || null,
                site.install_command || null,
                site.output_directory || null,
                initialLogs
            ]
        );

        // Run deployment in background
        (async () => {
            const appendLog = async (msg: string, statusOverride?: string) => {
                const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
                const line = `[${ts}] ${msg}`;
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
                } catch {}
            };

            try {
                await appendLog(`Downloading repository archive for ${site.github_repo}@${branch} (commit ${commitSha ? commitSha.slice(0, 7) : 'latest'})...`);
                const zipBuffer = await client.getRepoZipball(owner, repo, commitSha || branch);
                await appendLog(`Downloaded ${(zipBuffer.length / 1024).toFixed(1)} KB archive. Extracting files...`);

                const files = await extractZipArchive(zipBuffer);
                const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
                await appendLog(`Extracted ${files.length} files (${(totalSizeBytes / 1024).toFixed(1)} KB).`);

                await checkHostingDeploySize(site.project_id, totalSizeBytes);

                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments
                     SET total_size_bytes = $1, file_count = $2, status = 'building'
                     WHERE deploy_id = $3`,
                    [totalSizeBytes, files.length, deployId]
                );

                const { executeProjectBuild } = await import('@/lib/hosting-build');
                const buildRes = await executeProjectBuild({
                    deployId,
                    siteId: site.site_id,
                    projectId: site.project_id,
                    files,
                    buildCommand: site.build_command,
                    outputDirectory: site.output_directory,
                    installCommand: site.install_command
                });

                if (buildRes.framework && buildRes.framework !== 'static') {
                    await pool.query('UPDATE fluxbase_global.hosting_sites SET framework = $1 WHERE site_id = $2', [buildRes.framework, site.site_id]);
                }

                await appendLog(`Uploading ${buildRes.files.length} compiled assets to global CDN...`);
                const uploadStats = await uploadDeploymentAssetsToS3(site.project_id, deployId, buildRes.files);

                const deployedAt = new Date();
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments
                     SET status = 'live', deployed_at = $1, file_count = $2, total_size_bytes = $3
                     WHERE deploy_id = $4`,
                    [deployedAt, uploadStats.fileCount, uploadStats.totalBytes, deployId]
                );

                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments
                     SET status = 'superseded', superseded_at = $1
                     WHERE site_id = $2 AND deploy_id != $3 AND status = 'live'`,
                    [deployedAt, site.site_id, deployId]
                );

                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites
                     SET production_deploy_id = $1, updated_at = $2
                     WHERE site_id = $3`,
                    [deployId, deployedAt, site.site_id]
                );

                try {
                    const { redis } = await import('@/lib/redis');
                    await redis.del(`hosting:site:${site.subdomain}`);
                    if (site.custom_domain) await redis.del(`hosting:site:${site.custom_domain}`);
                } catch {}

                await appendLog(`Auto-deployment complete! Live at https://${site.subdomain}.fluxbasedb.me`);
            } catch (err: any) {
                logger.error(`[Auto-Deploy Trigger Failed] [${deployId}]:`, err);
                const errMsg = err.message || 'Auto-deployment failed';
                await appendLog(`AUTO-DEPLOY FAILED: ${errMsg}`, 'failed');
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments SET status = 'failed', error_message = $1 WHERE deploy_id = $2`,
                    [errMsg.slice(0, 500), deployId]
                );
            }
        })();

        return NextResponse.json({
            success: true,
            deployment: {
                deploy_id: deployId,
                site_id: site.site_id,
                version: nextVersion,
                status: 'uploading',
                preview_url: previewUrl,
                commit_sha: commitSha,
                commit_message: commitMessage
            }
        });

    } catch (err: any) {
        logger.error('[Trigger Auto-Deploy Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'Failed to trigger auto-deploy' }, { status: 500 });
    }
}
