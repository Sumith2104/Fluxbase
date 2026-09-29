import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getProjectById } from '@/lib/data';
import { cancelDeploymentBuild } from '@/lib/hosting-build';

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
        const { deployId } = body;

        if (!deployId) {
            return NextResponse.json({ success: false, error: 'deployId is required' }, { status: 400 });
        }

        const pool = getPgPool();
        const deployRes = await pool.query(
            'SELECT deploy_id, site_id, project_id, status FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1',
            [deployId]
        );
        const deploy = deployRes.rows[0];
        if (!deploy) {
            return NextResponse.json({ success: false, error: 'Deployment not found' }, { status: 404 });
        }

        const project = await getProjectById(deploy.project_id, auth.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: 'Unauthorized access to project' }, { status: 403 });
        }

        if (deploy.status !== 'uploading' && deploy.status !== 'building' && deploy.status !== 'queued') {
            return NextResponse.json({
                success: false,
                error: `Deployment is already ${deploy.status} and cannot be canceled.`
            }, { status: 400 });
        }

        const result = await cancelDeploymentBuild(deployId, 'Deployment canceled by user');
        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Failed to cancel deployment' }, { status: 500 });
    }
}
