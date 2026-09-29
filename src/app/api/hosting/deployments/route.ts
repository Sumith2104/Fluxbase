import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireReadScope, requireWriteScope } from '@/lib/require-scope';
import { getProjectById } from '@/lib/data';
import { getPgPool } from '@/lib/pg';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const projectId = searchParams.get('projectId');

    if (!siteId && !projectId) {
        return NextResponse.json({ success: false, error: 'siteId or projectId required' }, { status: 400 });
    }

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const pool = getPgPool();
        let targetSiteId = siteId;

        if (!targetSiteId && projectId) {
            const project = await getProjectById(projectId, auth.userId);
            if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
            const sRes = await pool.query('SELECT site_id FROM fluxbase_global.hosting_sites WHERE project_id = $1', [projectId]);
            if (sRes.rows.length === 0) {
                return NextResponse.json({ success: true, deployments: [] });
            }
            targetSiteId = sRes.rows[0].site_id;
        }

        const res = await pool.query(
            `SELECT * FROM fluxbase_global.hosting_deployments 
             WHERE site_id = $1 
             ORDER BY version DESC, created_at DESC 
             LIMIT 50`,
            [targetSiteId]
        );

        return NextResponse.json({ success: true, deployments: res.rows });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
