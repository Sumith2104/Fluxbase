import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { projectId, userId, role } = body;
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;

    if (!auth?.userId || !projectId || !userId || !role) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const pool = getPgPool();

        // 1. Verify that the requester is an ADMIN of the project
        // (Owners and those with 'admin' role in project_members)
        const requesterRes = await pool.query(`
            SELECT CASE 
                WHEN p.user_id = $2 THEN 'admin' 
                ELSE pm.role 
            END as role
            FROM fluxbase_global.projects p
            LEFT JOIN fluxbase_global.project_members pm ON p.project_id = pm.project_id AND pm.user_id = $2
            WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.user_id = $2)
        `, [projectId, auth.userId]);

        const requesterRole = requesterRes.rows[0]?.role;
        if (requesterRole !== 'admin') {
            return NextResponse.json({ 
                success: false, 
                error: 'Insufficient Permissions: Only Admins can change member roles.' 
            }, { status: 403 });
        }

        // 2. Prevent changing the role of the Project Owner
        const targetRes = await pool.query(`SELECT user_id FROM fluxbase_global.projects WHERE project_id = $1`, [projectId]);
        if (targetRes.rows[0]?.user_id === userId) {
            return NextResponse.json({ 
                success: false, 
                error: 'Cannot change the role of the Project Owner.' 
            }, { status: 400 });
        }

        // 3. Update the role in project_members
        const updateRes = await pool.query(
            `UPDATE fluxbase_global.project_members 
             SET role = $1 
             WHERE project_id = $2 AND user_id = $3
             RETURNING role`,
            [role, projectId, userId]
        );

        if (updateRes.rows.length === 0) {
            return NextResponse.json({ 
                success: false, 
                error: 'Member not found in this project.' 
            }, { status: 404 });
        }

        return NextResponse.json({ success: true, role: updateRes.rows[0].role });
    } catch (e: any) {
        logger.error('[API Team Role] Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
