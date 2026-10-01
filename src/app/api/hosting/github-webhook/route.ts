import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { executeGitHubDeployment } from '@/lib/hosting-engine';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const event = req.headers.get('x-github-event');
        if (event === 'ping') {
            return NextResponse.json({ success: true, message: 'Pong! Webhook registered successfully.' });
        }

        const payload = await req.json();
        const pool = getPgPool();

        // 1. Handle Pull Request events (Deploy Previews & bot comments like Vercel)
        if (event === 'pull_request') {
            const action = payload.action;
            if (!['opened', 'synchronize', 'reopened'].includes(action)) {
                return NextResponse.json({ success: true, message: `Ignored pull_request action: ${action}` });
            }

            const repoFullName = payload.repository?.full_name;
            const branch = payload.pull_request?.head?.ref;
            const commitSha = payload.pull_request?.head?.sha;
            const commitMessage = payload.pull_request?.title ? `PR #${payload.number}: ${payload.pull_request.title}` : `PR #${payload.number}`;
            const author = payload.pull_request?.user?.login || 'pr-author';
            const prNumber = payload.number;

            if (!repoFullName || !branch) {
                return NextResponse.json({ success: false, error: 'Invalid PR payload' }, { status: 400 });
            }

            const siteRes = await pool.query(
                `SELECT * FROM fluxbase_global.hosting_sites 
                 WHERE github_repo = $1 AND status = 'active' LIMIT 1`,
                [repoFullName]
            );

            if (siteRes.rows.length === 0) {
                return NextResponse.json({ success: true, message: `No active hosting site found for ${repoFullName}` });
            }

            const site = siteRes.rows[0];
            if (!site.auto_deploy) {
                return NextResponse.json({ success: true, message: 'Auto-deploy disabled for this site' });
            }

            const result = await executeGitHubDeployment({
                siteId: site.site_id,
                projectId: site.project_id,
                userId: site.user_id,
                branch,
                commitSha,
                commitMessage,
                author,
                environment: 'preview',
                autoPromote: false,
                asyncExecution: true,
                prNumber
            });

            return NextResponse.json({ success: true, deployment: result });
        }

        // 2. Handle Push events
        if (event === 'push') {
            const repoFullName = payload.repository?.full_name;
            const ref = payload.ref || ''; // e.g. refs/heads/main
            const branch = ref.replace('refs/heads/', '');
            const commitSha = payload.head_commit?.id || payload.after || '';
            const commitMessage = payload.head_commit?.message || 'New commit on ' + branch;
            const author = payload.head_commit?.author?.name || payload.pusher?.name || 'committer';

            if (!repoFullName || !branch) {
                return NextResponse.json({ success: false, error: 'Invalid webhook payload' }, { status: 400 });
            }

            const siteRes = await pool.query(
                `SELECT * FROM fluxbase_global.hosting_sites 
                 WHERE github_repo = $1 AND github_branch = $2 AND status = 'active'`,
                [repoFullName, branch]
            );

            if (siteRes.rows.length === 0) {
                return NextResponse.json({ success: true, message: `No active hosting site found for ${repoFullName}@${branch}` });
            }

            const site = siteRes.rows[0];

            if (!site.auto_deploy) {
                logger.info(`[GitHub Webhook] Auto-deploy is disabled for site ${site.site_id} (${repoFullName})`);
                return NextResponse.json({ success: true, message: 'Auto-deploy is disabled for this site' });
            }

            const result = await executeGitHubDeployment({
                siteId: site.site_id,
                projectId: site.project_id,
                userId: site.user_id,
                branch,
                commitSha,
                commitMessage,
                author,
                environment: 'production',
                autoPromote: true,
                asyncExecution: true
            });

            return NextResponse.json({
                success: true,
                deployment: result
            });
        }

        return NextResponse.json({ success: true, message: `Ignored event: ${event}` });
    } catch (err: any) {
        logger.error('[GitHub Webhook Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'Webhook processing failed' }, { status: 500 });
    }
}
