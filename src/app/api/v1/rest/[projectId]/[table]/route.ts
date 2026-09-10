import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getProjectById, logAuditAction, type Project } from '@/lib/data';
import { trackApiRequest } from '@/lib/analytics';
import {
    listRows,
    getRow,
    insertRow,
    updateRow,
    deleteRow,
    sanitizeTableName,
} from '@/lib/rest-generator';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function trackRestCall(projectId: string, userId: string, method: string, table: string) {
    trackApiRequest(projectId, 'api_call').catch(() => {});
    trackApiRequest(projectId, 'sql_execution').catch(() => {});
    const methodType = method === 'GET' ? 'sql_select'
                     : method === 'POST' ? 'sql_insert'
                     : method === 'PUT' ? 'sql_update'
                     : method === 'DELETE' ? 'sql_delete' : null;
    if (methodType) {
        trackApiRequest(projectId, methodType as any).catch(() => {});
    }
    logAuditAction(projectId, userId, `REST_${method}`, `${method} ${table}`, { table, method }).catch(() => {});
}

/**
 * GET /api/v1/rest/[projectId]/[table]
 * List rows with pagination and filtering.
 * Query params: page, limit, order_by, order_dir, filter[col]=val
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; table: string }> }
) {
    try {
        const { projectId, table: rawTable } = await params;
        const authContext = await getAuthContextFromRequest(request);
        if (!authContext) {
            return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, { status: 401 });
        }

        const project = await getProjectById(projectId, authContext.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: { message: 'Project not found', code: 'NOT_FOUND' } }, { status: 404 });
        }

        const table = sanitizeTableName(rawTable);

        // Parse query parameters
        const url = new URL(request.url);
        const options: any = {
            page: parseInt(url.searchParams.get('page') || '1', 10),
            limit: Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 1000),
            order_by: url.searchParams.get('order_by') || undefined,
            order_dir: (url.searchParams.get('order_dir') as 'asc' | 'desc') || 'asc',
            filters: {},
        };

        for (const [key, value] of url.searchParams.entries()) {
            if (key.startsWith('filter[') && key.endsWith(']')) {
                const colName = key.slice(7, -1);
                options.filters[colName] = value;
            }
        }

        const result = await listRows(project, table, options);
        trackRestCall(projectId, authContext.userId, 'GET', table);
        return NextResponse.json(result);
    } catch (error: any) {
        logger.error('[REST GET] Error:', error);
        return NextResponse.json({
            success: false,
            error: { message: error.message || 'Internal server error', code: 'INTERNAL_ERROR' },
        }, { status: 500 });
    }
}

/**
 * POST /api/v1/rest/[projectId]/[table]
 * Insert a new row.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; table: string }> }
) {
    try {
        const { projectId, table: rawTable } = await params;
        const authContext = await getAuthContextFromRequest(request);
        if (!authContext) {
            return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, { status: 401 });
        }

        requireWriteScope(authContext);

        const project = await getProjectById(projectId, authContext.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: { message: 'Project not found', code: 'NOT_FOUND' } }, { status: 404 });
        }

        const table = sanitizeTableName(rawTable);
        const body = await request.json();

        if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
            return NextResponse.json({ success: false, error: { message: 'Request body must be a non-empty object', code: 'BAD_REQUEST' } }, { status: 400 });
        }

        const row = await insertRow(project, table, body);
        trackRestCall(projectId, authContext.userId, 'POST', table);
        return NextResponse.json(row, { status: 201 });
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') {
            return NextResponse.json({ success: false, error: { message: 'Insufficient permissions', code: 'FORBIDDEN' } }, { status: 403 });
        }
        logger.error('[REST POST] Error:', error);
        return NextResponse.json({
            success: false,
            error: { message: error.message || 'Internal server error', code: 'INTERNAL_ERROR' },
        }, { status: 500 });
    }
}

/**
 * PUT /api/v1/rest/[projectId]/[table]
 * Update a row by ID.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; table: string }> }
) {
    try {
        const { projectId, table: rawTable } = await params;
        const authContext = await getAuthContextFromRequest(request);
        if (!authContext) {
            return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, { status: 401 });
        }

        requireWriteScope(authContext);

        const project = await getProjectById(projectId, authContext.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: { message: 'Project not found', code: 'NOT_FOUND' } }, { status: 404 });
        }

        const table = sanitizeTableName(rawTable);
        const body = await request.json();
        const { id, ...data } = body;

        if (!id) {
            return NextResponse.json({ success: false, error: { message: 'ID is required in request body', code: 'BAD_REQUEST' } }, { status: 400 });
        }

        const row = await updateRow(project, table, id, data);
        if (!row) {
            return NextResponse.json({ success: false, error: { message: 'Row not found', code: 'NOT_FOUND' } }, { status: 404 });
        }
        trackRestCall(projectId, authContext.userId, 'PUT', table);
        return NextResponse.json(row);
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') {
            return NextResponse.json({ success: false, error: { message: 'Insufficient permissions', code: 'FORBIDDEN' } }, { status: 403 });
        }
        logger.error('[REST PUT] Error:', error);
        return NextResponse.json({
            success: false,
            error: { message: error.message || 'Internal server error', code: 'INTERNAL_ERROR' },
        }, { status: 500 });
    }
}

/**
 * DELETE /api/v1/rest/[projectId]/[table]
 * Delete a row by ID.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; table: string }> }
) {
    try {
        const { projectId, table: rawTable } = await params;
        const authContext = await getAuthContextFromRequest(request);
        if (!authContext) {
            return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, { status: 401 });
        }

        requireWriteScope(authContext);

        const project = await getProjectById(projectId, authContext.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: { message: 'Project not found', code: 'NOT_FOUND' } }, { status: 404 });
        }

        const table = sanitizeTableName(rawTable);
        const url = new URL(request.url);
        const id = url.searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, error: { message: 'ID is required as query parameter ?id=', code: 'BAD_REQUEST' } }, { status: 400 });
        }

        const deleted = await deleteRow(project, table, id);
        if (!deleted) {
            return NextResponse.json({ success: false, error: { message: 'Row not found', code: 'NOT_FOUND' } }, { status: 404 });
        }
        trackRestCall(projectId, authContext.userId, 'DELETE', table);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') {
            return NextResponse.json({ success: false, error: { message: 'Insufficient permissions', code: 'FORBIDDEN' } }, { status: 403 });
        }
        logger.error('[REST DELETE] Error:', error);
        return NextResponse.json({
            success: false,
            error: { message: error.message || 'Internal server error', code: 'INTERNAL_ERROR' },
        }, { status: 500 });
    }
}
