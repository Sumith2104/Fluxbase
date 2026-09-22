import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { provisionDatabaseInstance, getDatabaseStatus } from '@/lib/aws-rds';
import crypto from 'crypto';
import { jsonError, requireProjectAccess } from '@/lib/project-auth';
import { checkInstanceSizeLimit } from '@/lib/limits';
import { ERROR_CODES, FluxbaseError } from '@/lib/error-codes';
import { assertAdminScope, assertReadScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

function instancePrefixForProject(projectId: string): string {
    return `fluxbase-tenant-${projectId.toLowerCase().replace(/[^a-z0-9-]/g, '')}-`;
}

export async function POST(request: Request) {
    try {
        const auth = await getAuthContextFromRequest(request);
        assertAdminScope(auth);
        const body = await request.json();
        const { engine } = body;
        const size = body.size || 'db.t3.micro';
        const projectId = body.projectId || auth?.allowedProjectId;

        if (!engine || !projectId) {
            throw new FluxbaseError('Missing required parameters: engine and projectId', ERROR_CODES.MISSING_FIELD, 400);
        }

        await requireProjectAccess(projectId, auth, ['admin']);
        await checkInstanceSizeLimit(auth!.userId, size);

        const masterUsername = 'fluxadmin_' + crypto.randomBytes(4).toString('hex');
        const masterPassword = 'Flux' + crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + 'A1!';
        const instanceIdentifier = `${instancePrefixForProject(projectId)}${Date.now()}`;

        const instance = await provisionDatabaseInstance({
            instanceIdentifier,
            engine: engine.toLowerCase() === 'mysql' ? 'mysql' : 'postgres',
            masterUsername,
            masterPassword,
            instanceClass: size
        });

        return NextResponse.json({
            success: true,
            status: 'creating',
            instanceIdentifier,
            masterUsername,
            awsResponse: {
                arn: instance?.DBInstanceArn,
                status: instance?.DBInstanceStatus
            }
        });

    } catch (error) {
        logger.error('[Provisioning API Error]', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
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

        const status = await getDatabaseStatus(identifier);

        if (!status) {
            return NextResponse.json({ success: false, error: 'Instance not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            status: status.status,
            endpoint: status.endpoint,
            port: status.port
        });
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
