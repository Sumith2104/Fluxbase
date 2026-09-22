import { NextRequest, NextResponse } from 'next/server';
import { resetProjectData } from '@/lib/data';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireProjectAccess, jsonError } from '@/lib/project-auth';
import { requireAdminScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
    try {
        const auth = await getAuthContextFromRequest(request);
        if (!auth?.userId) {
            return NextResponse.json({ success: false, error: 'User not authenticated' }, { status: 401 });
        }

        const scopeErr = requireAdminScope(auth);
        if (scopeErr) return scopeErr;

        const body = await request.json().catch(() => ({}));
        const { projectId } = body;
        if (!projectId) {
            return NextResponse.json({ success: false, error: 'Missing projectId' }, { status: 400 });
        }

        // Enforce project ownership and admin role: only project admin/owner can wipe database
        await requireProjectAccess(projectId, auth, ['admin']);

        await resetProjectData(projectId);

        return NextResponse.json({ success: true, message: 'Database reset successfully.' });

    } catch (error: any) {
        logger.error('Failed to reset database:', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
