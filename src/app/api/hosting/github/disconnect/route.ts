import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getGitHubToken } from '@/lib/github-token';
import { GitHubClient } from '@/lib/github-client';
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

        // If webhook was created on GitHub, attempt to delete it
        if (site.github_repo && site.github_webhook_id) {
            try {
                const token = await getGitHubToken(auth.userId);
                if (token) {
                    const [owner, repo] = site.github_repo.split('/');
                    const client = new GitHubClient(token);
                    await client.deleteWebhook(owner, repo, site.github_webhook_id);
                }
            } catch (wErr) {
                logger.warn('Failed to delete GitHub webhook on disconnect:', wErr);
            }
        }

        // Clear GitHub connection on site
        await pool.query(
            `UPDATE fluxbase_global.hosting_sites 
             SET github_repo = NULL, github_branch = NULL, auto_deploy = false, github_webhook_id = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE site_id = $1`,
            [siteId]
        );

        return NextResponse.json({
            success: true,
            message: 'Repository disconnected successfully'
        });

    } catch (err: any) {
        logger.error('[Disconnect Repo Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'Failed to disconnect repository' }, { status: 500 });
    }
}
