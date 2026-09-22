import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { createDatabaseSnapshot, listDatabaseSnapshots } from '@/lib/aws-rds';
import { jsonError, requireProjectAccess } from '@/lib/project-auth';
import { ERROR_CODES, FluxbaseError } from '@/lib/error-codes';
import { assertReadScope, assertWriteScope } from '@/lib/require-scope';

function instancePrefixForProject(projectId: string): string {
    return `fluxbase-tenant-${projectId.toLowerCase().replace(/[^a-z0-9-]/g, '')}-`;
}

export async function GET(request: Request) {
    try {
        const auth = await getAuthContextFromRequest(request);
        assertReadScope(auth);
        const { searchParams } = new URL(request.url);
        const identifier = searchParams.get('identifier');
        const projectId = searchParams.get('projectId') || auth?.allowedProjectId;

        if (!identifier || !projectId) {
            throw new FluxbaseError('Missing required parameters: identifier and projectId', ERROR_CODES.MISSING_FIELD, 400);
        }
        await requireProjectAccess(projectId, auth, ['admin']);
        if (!identifier.startsWith(instancePrefixForProject(projectId))) {
            throw new FluxbaseError('Instance identifier is not associated with this project.', ERROR_CODES.FORBIDDEN, 403);
        }

        const snapshots = await listDatabaseSnapshots(identifier);

        return NextResponse.json({
            success: true,
            snapshots: snapshots.map((s: any) => ({
                id: s.DBSnapshotIdentifier,
                status: s.Status,
                createdAt: s.SnapshotCreateTime,
                engine: s.Engine,
                allocatedStorage: s.AllocatedStorage
            }))
        });
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}

export async function POST(request: Request) {
    try {
        const auth = await getAuthContextFromRequest(request);
        assertWriteScope(auth);

        const body = await request.json();
        const { identifier } = body;
        const projectId = body.projectId || auth?.allowedProjectId;

        if (!identifier || !projectId) {
            throw new FluxbaseError('Missing required parameters: identifier and projectId', ERROR_CODES.MISSING_FIELD, 400);
        }
        await requireProjectAccess(projectId, auth, ['admin']);
        if (!identifier.startsWith(instancePrefixForProject(projectId))) {
            throw new FluxbaseError('Instance identifier is not associated with this project.', ERROR_CODES.FORBIDDEN, 403);
        }

        const snapshotIdentifier = `${identifier}-manual-${Date.now()}`;
        const snapshot = await createDatabaseSnapshot(identifier, snapshotIdentifier);

        return NextResponse.json({
            success: true,
            snapshot: {
                id: snapshot?.DBSnapshotIdentifier,
                status: snapshot?.Status
            }
        });
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
