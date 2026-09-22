import { NextRequest, NextResponse } from 'next/server';
import { getPgPool, handleDatabaseError } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { getProjectById } from '@/lib/data';
import { ERROR_CODES } from '@/lib/error-codes';
import crypto from 'crypto';
import { requireWriteScope, requireReadScope } from '@/lib/require-scope';

// GET /api/storage/buckets?projectId=xxx  - list buckets
// POST /api/storage/buckets               - create bucket
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ success: false, error: { message: 'projectId required', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ success: false, error: { message: 'This API key is not allowed to access the requested project.', code: ERROR_CODES.FORBIDDEN } }, { status: 403 });
    }

    const project = await getProjectById(projectId, auth.userId);
    if (!project) return NextResponse.json({ success: false, error: { message: 'Project not found', code: ERROR_CODES.PROJECT_NOT_FOUND } }, { status: 404 });

    try {
        const pool = getPgPool();
        const result = await pool.query(
            `SELECT 
                b.id, b.name, b.is_public, b.created_at,
                COALESCE(SUM(o.size), 0) as total_size
             FROM fluxbase_global.storage_buckets b
             LEFT JOIN fluxbase_global.storage_objects o ON b.id = o.bucket_id
             WHERE b.project_id = $1 
             GROUP BY b.id, b.name, b.is_public, b.created_at
             ORDER BY b.created_at ASC`,
            [projectId]
        );
        return NextResponse.json({ success: true, buckets: result.rows });
    } catch (e) {
        return handleDatabaseError(e);
    }
}

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });

    const body = await req.json();
    const { projectId, name, isPublic = false } = body;
    if (!projectId || !name) return NextResponse.json({ success: false, error: { message: 'projectId and name required', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ success: false, error: { message: 'This API key is not allowed to access the requested project.', code: ERROR_CODES.FORBIDDEN } }, { status: 403 });
    }

    // Validate bucket name
    if (!/^[a-z0-9][a-z0-9\-_]{0,62}$/.test(name)) {
        return NextResponse.json({
            success: false,
            error: { message: 'Bucket name must be lowercase alphanumeric, hyphens or underscores, 1-63 chars', code: ERROR_CODES.BAD_REQUEST }
        }, { status: 400 });
    }

    const project = await getProjectById(projectId, auth.userId);
    if (!project) return NextResponse.json({ success: false, error: { message: 'Project not found', code: ERROR_CODES.PROJECT_NOT_FOUND } }, { status: 404 });

    const pool = getPgPool();
    const id = crypto.randomUUID();
    try {
        const result = await pool.query(
            `INSERT INTO fluxbase_global.storage_buckets (id, project_id, name, is_public) VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, projectId, name, isPublic]
        );
        return NextResponse.json({ success: true, bucket: result.rows[0] });
    } catch (e: any) {
        if (e.code === '23505') {
            return NextResponse.json({ success: false, error: { message: 'A bucket with this name already exists', code: ERROR_CODES.BAD_REQUEST } }, { status: 409 });
        }
        return NextResponse.json({ success: false, error: { message: e.message || 'Storage creation failed', code: ERROR_CODES.INTERNAL_ERROR } }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });

    const body = await req.json();
    const { bucketId, projectId, name } = body;
    if (!bucketId || !projectId || !name) return NextResponse.json({ success: false, error: { message: 'bucketId, projectId, and name required', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ success: false, error: { message: 'This API key is not allowed to access the requested project.', code: ERROR_CODES.FORBIDDEN } }, { status: 403 });
    }

    if (!/^[a-z0-9][a-z0-9\-_]{0,62}$/.test(name)) {
        return NextResponse.json({ success: false, error: { message: 'Invalid bucket name', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });
    }

    const project = await getProjectById(projectId, auth.userId);
    if (!project) return NextResponse.json({ success: false, error: { message: 'Project not found', code: ERROR_CODES.PROJECT_NOT_FOUND } }, { status: 404 });

    const pool = getPgPool();
    try {
        const result = await pool.query(
            `UPDATE fluxbase_global.storage_buckets SET name = $1 WHERE id = $2 AND project_id = $3 RETURNING *`,
            [name, bucketId, projectId]
        );
        if (result.rows.length === 0) return NextResponse.json({ success: false, error: { message: 'Bucket not found', code: ERROR_CODES.BUCKET_NOT_FOUND } }, { status: 404 });
        return NextResponse.json({ success: true, bucket: result.rows[0] });
    } catch (e: any) {
        if (e.code === '23505') return NextResponse.json({ success: false, error: { message: 'Bucket name already exists', code: ERROR_CODES.BAD_REQUEST } }, { status: 409 });
        return NextResponse.json({ success: false, error: { message: e.message || 'Update failed', code: ERROR_CODES.INTERNAL_ERROR } }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });

    const body = await req.json();
    const { bucketId, projectId } = body;
    if (!bucketId || !projectId) return NextResponse.json({ success: false, error: { message: 'bucketId and projectId required', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ success: false, error: { message: 'This API key is not allowed to access the requested project.', code: ERROR_CODES.FORBIDDEN } }, { status: 403 });
    }

    const project = await getProjectById(projectId, auth.userId);
    if (!project) return NextResponse.json({ success: false, error: { message: 'Project not found', code: ERROR_CODES.PROJECT_NOT_FOUND } }, { status: 404 });

    // Since we don't have bulk S3 delete easily accessible here and keeping API fast,
    // we just delete bucket from DB. 'storage_objects' cascades,
    // S3 cleanup can be a cron job later, or if bucket is empty.
    try {
        const pool = getPgPool();
        
        // Optional: Only allow deleting empty buckets for now to prevent S3 orphans
        const countRes = await pool.query(`SELECT COUNT(*) as count FROM fluxbase_global.storage_objects WHERE bucket_id = $1`, [bucketId]);
        if (parseInt(countRes.rows[0].count) > 0) {
            return NextResponse.json({ success: false, error: { message: 'Bucket is not empty. Delete all files inside first.', code: ERROR_CODES.BUCKET_NOT_EMPTY } }, { status: 400 });
        }

        const result = await pool.query(`DELETE FROM fluxbase_global.storage_buckets WHERE id = $1 AND project_id = $2 RETURNING id`, [bucketId, projectId]);
        if (result.rows.length === 0) return NextResponse.json({ success: false, error: { message: 'Bucket not found', code: ERROR_CODES.BUCKET_NOT_FOUND } }, { status: 404 });

        return NextResponse.json({ success: true });
    } catch (e) {
        return handleDatabaseError(e);
    }
}
