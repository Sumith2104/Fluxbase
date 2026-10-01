import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { executeGitHubDeployment } from '@/lib/hosting-engine';
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

        const result = await executeGitHubDeployment({
            siteId: site.site_id,
            projectId: site.project_id,
            userId: auth.userId,
            environment: 'production',
            autoPromote: true,
            asyncExecution: true
        });

        return NextResponse.json({
            success: true,
            deployment: result
        });
    } catch (err: any) {
        logger.error('[Trigger Auto-Deploy Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'Failed to trigger auto-deploy' }, { status: 500 });
    }
}
