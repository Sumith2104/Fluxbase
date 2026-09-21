import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getOrCreateCurrentCycle, invalidatePaygCache } from '@/lib/payg-engine';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const force = searchParams.get('force') === 'true';

    if (!projectId) {
        return NextResponse.json({ error: 'Missing projectId parameter' }, { status: 400 });
    }

    try {
        const pool = getPgPool();
        // Verify user owns or has access to this project
        const pRes = await pool.query(
            'SELECT project_id, display_name, billing_preference FROM fluxbase_global.projects WHERE project_id = $1 AND user_id = $2',
            [projectId, userId]
        );

        if (pRes.rows.length === 0) {
            return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 });
        }

        const cycle = await getOrCreateCurrentCycle(projectId, userId, force);

        return NextResponse.json({
            success: true,
            projectName: pRes.rows[0].display_name,
            billingPreference: pRes.rows[0].billing_preference,
            cycle
        });
    } catch (error: any) {
        logger.error('[API PAYG Error]:', error);
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { projectId, spendingLimit } = body;

        if (!projectId || spendingLimit === undefined || isNaN(Number(spendingLimit))) {
            return NextResponse.json({ error: 'Valid projectId and spendingLimit are required' }, { status: 400 });
        }

        const pool = getPgPool();
        const updateRes = await pool.query(`
            UPDATE fluxbase_global.payg_usage_cycles 
            SET spending_limit = $1, updated_at = NOW() 
            WHERE project_id = $2 AND user_id = $3 AND status = 'active'
            RETURNING id, spending_limit;
        `, [parseFloat(spendingLimit), projectId, userId]);

        if (updateRes.rows.length === 0) {
            return NextResponse.json({ error: 'Active billing cycle not found' }, { status: 404 });
        }

        invalidatePaygCache(projectId);

        return NextResponse.json({
            success: true,
            spendingLimit: parseFloat(updateRes.rows[0].spending_limit)
        });
    } catch (error: any) {
        logger.error('[API PAYG Spending Limit Update Error]:', error);
        return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
    }
}
