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
        const { siteId, targetDeployId } = body;

        if (!siteId) {
            return NextResponse.json({ success: false, error: 'siteId is required' }, { status: 400 });
        }

        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        let deployToRestore = targetDeployId;

        // If targetDeployId is not specified, find the most recent superseded deployment
        if (!deployToRestore) {
            const prevRes = await pool.query(
                `SELECT deploy_id FROM fluxbase_global.hosting_deployments 
                 WHERE site_id = $1 AND deploy_id != $2 AND status = 'superseded' 
                 ORDER BY superseded_at DESC, version DESC LIMIT 1`,
                [siteId, site.production_deploy_id || '']
            );
            if (prevRes.rows.length === 0) {
                return NextResponse.json({ success: false, error: 'No previous deployment found to roll back to' }, { status: 400 });
            }
            deployToRestore = prevRes.rows[0].deploy_id;
        }

        const result = await promoteDeploymentToProduction(siteId, deployToRestore);
        return NextResponse.json({
            success: true,
            message: 'Rollback completed successfully',
            deployId: deployToRestore,
            url: result.url
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Rollback failed' }, { status: 500 });
    }
}
