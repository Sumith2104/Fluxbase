import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { promoteDeploymentToProduction } from '@/lib/hosting-engine';
import { getPgPool } from '@/lib/pg';
import { getProjectById } from '@/lib/data';

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
        const { siteId, deployId } = body;

        if (!siteId || !deployId) {
            return NextResponse.json({ success: false, error: 'siteId and deployId are required' }, { status: 400 });
        }

        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        const result = await promoteDeploymentToProduction(siteId, deployId);
        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Promotion failed' }, { status: 500 });
    }
}
