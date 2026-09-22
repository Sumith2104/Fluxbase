import { NextRequest, NextResponse } from 'next/server';
import { getPgPool, handleDatabaseError } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { sendTeamInviteEmail } from '@/lib/email';
import crypto from 'crypto';
import { requireWriteScope, requireReadScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const scope = searchParams.get('scope'); // 'project' or 'my-invites'
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const pool = getPgPool();

        if (scope === 'my-invites') {
            const res = await pool.query(`
                SELECT pi.id, pi.role, pi.created_at as "invitedAt",
                       COALESCE(p.display_name, 'Unknown Project') as "projectName", 
                       COALESCE(u.display_name, 'A team member') as "inviterName"
                FROM fluxbase_global.project_invitations pi
                LEFT JOIN fluxbase_global.projects p ON p.project_id = pi.project_id
                LEFT JOIN fluxbase_global.users u ON u.id = pi.invited_by
                WHERE LOWER(pi.email) = LOWER($1) AND (pi.status = 'pending' OR pi.status IS NULL)
            `, [auth.email]);
            return NextResponse.json({ invites: res.rows });
        }

        if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });

        const { requireProjectAccess, jsonError } = await import('@/lib/project-auth');
        try {
            await requireProjectAccess(projectId, auth);
        } catch (error) {
            const { body, status } = jsonError(error);
            return NextResponse.json(body, { status });
        }
        const membersRes = await pool.query(`
            SELECT u.id as "userId", u.email, u.display_name as "displayName", 
                   'admin' as role, 
                   p.created_at as "joinedAt"
            FROM fluxbase_global.projects p
            JOIN fluxbase_global.users u ON u.id = p.user_id
            WHERE p.project_id = $1
            UNION
            SELECT u.id as "userId", u.email, u.display_name as "displayName", pm.role, pm.created_at as "joinedAt"
            FROM fluxbase_global.project_members pm
            JOIN fluxbase_global.users u ON u.id = pm.user_id
            WHERE pm.project_id = $1
            ORDER BY "joinedAt" ASC
        `, [projectId]);

        // 2. Get pending invites for this project (Admins only)
        const invitesRes = await pool.query(`
            SELECT pi.id, pi.email, pi.role, pi.created_at as "invitedAt"
            FROM fluxbase_global.project_invitations pi
            WHERE pi.project_id = $1 AND (pi.status = 'pending' OR pi.status IS NULL)
        `, [projectId]);

        return NextResponse.json({ 
            members: membersRes.rows,
            invites: invitesRes.rows 
        });
    } catch (e) {
        return handleDatabaseError(e);
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { projectId, email, role } = body;
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId || !projectId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const pool = getPgPool();

        // 1. Parallel Fetch
        const [metaRes, userRes] = await Promise.all([
            pool.query(`
                SELECT 
                    (CASE WHEN p.user_id = $2 THEN 'admin' ELSE pm.role END) as role,
                    u.display_name as inviter_name,
                    p.display_name as project_name
                FROM fluxbase_global.projects p
                JOIN fluxbase_global.users u ON u.id = $2
                LEFT JOIN fluxbase_global.project_members pm ON p.project_id = pm.project_id AND pm.user_id = $2
                WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.user_id = $2)
            `, [projectId, auth.userId]),
            pool.query(`SELECT id FROM fluxbase_global.users WHERE LOWER(email) = LOWER($1)`, [email])
        ]);

        const metadata = metaRes.rows[0];
        if (!metadata || metadata.role !== 'admin') {
            return NextResponse.json({ success: false, error: 'Insufficient Permissions' }, { status: 403 });
        }

        if (userRes.rows.length === 0) {
            return NextResponse.json({ success: false, error: `No user found with email "${email}"` }, { status: 404 });
        }

        const inviterName = metadata.inviter_name || 'A team member';
        const projectName = metadata.project_name || 'a project';

        // 2. Persistent Action: Reset state and create fresh invitation
        const inviteId = crypto.randomUUID();
        logger.info(`[Invitation DEBUG] Resetting and creating invite: ${inviteId} for ${email} in project ${projectId}`);
        
        // Use a transaction or sequential queries to ensure we clear stale ones first
        await pool.query('BEGIN');
        try {
            // Remove any existing invites for this user in this project (resetting state)
            await pool.query(
                `DELETE FROM fluxbase_global.project_invitations 
                 WHERE project_id = $1 AND LOWER(email) = LOWER($2)`,
                [projectId, email]
            );

            await pool.query(
                `INSERT INTO fluxbase_global.project_invitations (id, project_id, email, invited_by, role, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending')`,
                [inviteId, projectId, email, auth.userId, role]
            );
            await pool.query('COMMIT');
        } catch (err) {
            await pool.query('ROLLBACK');
            throw err;
        }

        // 3. Background Action: Email
        sendTeamInviteEmail(email, inviterName, projectName, role).catch(err => {
            logger.error("[Email Dispatch Failed]", err.message);
        });

        return NextResponse.json({ success: true, invited: true });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    }
}

export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const userId = searchParams.get('userId');
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId || !projectId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const pool = getPgPool();
        const requesterRes = await pool.query(`
            SELECT CASE WHEN p.user_id = $2 THEN 'admin' ELSE pm.role END as role
            FROM fluxbase_global.projects p
            LEFT JOIN fluxbase_global.project_members pm ON p.project_id = pm.project_id AND pm.user_id = $2
            WHERE p.project_id = $1 AND (p.user_id = $2 OR pm.user_id = $2)
        `, [projectId, auth.userId]);

        if (requesterRes.rows[0]?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        await pool.query(`DELETE FROM fluxbase_global.project_members WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
        return NextResponse.json({ success: true });
    } catch (e) { return handleDatabaseError(e); }
}
