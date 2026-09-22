import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { inviteId, status } = body; // status can be 'accepted' or 'rejected'

    if (!['accepted', 'rejected'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const pool = getPgPool();

    try {
        // 1. Fetch the invite
        const inviteRes = await pool.query(
            `SELECT project_id, role FROM fluxbase_global.project_invitations 
             WHERE id = $1 AND email = $2 AND status = 'pending'`,
            [inviteId, auth.email]
        );

        if (inviteRes.rows.length === 0) {
            return NextResponse.json({ error: 'Invitation not found or already processed' }, { status: 404 });
        }

        const { project_id: projectId, role } = inviteRes.rows[0];

        if (status === 'accepted') {
            // Move to members
            await pool.query(
                `INSERT INTO fluxbase_global.project_members (project_id, user_id, role)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
                [projectId, auth.userId, role]
            );
        }

        // Update invite status
        await pool.query(
            `UPDATE fluxbase_global.project_invitations SET status = $1 WHERE id = $2`,
            [status, inviteId]
        );

        return NextResponse.json({ success: true, status });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
