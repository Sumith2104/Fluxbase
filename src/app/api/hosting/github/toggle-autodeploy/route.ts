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
        const { siteId, autoDeploy } = await req.json();
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

        let webhookId = site.github_webhook_id;

        // If enabling auto-deploy and no webhook ID, attempt to register webhook on GitHub
        if (autoDeploy && !webhookId) {
            try {
                const token = await getGitHubToken(auth.userId);
                if (token) {
                    const [owner, repo] = site.github_repo.split('/');
                    const client = new GitHubClient(token);
                    const webhookBase = process.env.NEXT_PUBLIC_APP_URL || 'https://fluxbasedb.me';
                    const webhookUrl = `${webhookBase.replace(/\/$/, '')}/api/hosting/github-webhook`;
                    const hookRes = await client.createWebhook(owner, repo, webhookUrl);
                    if (hookRes?.id) {
                        webhookId = hookRes.id.toString();
                    }
                }
            } catch (wErr) {
                logger.warn('Notice: GitHub webhook creation on toggle skipped or failed:', wErr);
            }
        }

        await pool.query(
            `UPDATE fluxbase_global.hosting_sites 
             SET auto_deploy = $1, github_webhook_id = COALESCE($2, github_webhook_id), updated_at = CURRENT_TIMESTAMP
             WHERE site_id = $3`,
            [Boolean(autoDeploy), webhookId || null, siteId]
        );

        return NextResponse.json({
            success: true,
            autoDeploy: Boolean(autoDeploy),
            message: autoDeploy ? 'Auto-deploy on new commit enabled' : 'Auto-deploy disabled'
        });

    } catch (err: any) {
        logger.error('[Toggle Auto-Deploy Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'Failed to toggle auto-deploy' }, { status: 500 });
    }
}
