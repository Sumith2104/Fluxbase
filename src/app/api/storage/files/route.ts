import { NextRequest, NextResponse } from 'next/server';
import { getPgPool, handleDatabaseError } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { deleteFromS3 } from '@/lib/storage';
import { ERROR_CODES } from '@/lib/error-codes';
import { jsonError, requireProjectAccess } from '@/lib/project-auth';
import { requireWriteScope, requireReadScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

// GET /api/storage/files?bucketId=xxx&projectId=xxx
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const bucketId = searchParams.get('bucketId');
    const projectId = searchParams.get('projectId');

    if (!bucketId || !projectId) {
        return NextResponse.json({ success: false, error: { message: 'bucketId and projectId required', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });
    }

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });

    try {
        await requireProjectAccess(projectId, auth);
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }

    try {
        const pool = getPgPool();
        
        // Resolve bucket ID first (supports both ID or Name)
        const bucketQuery = await pool.query(
            `SELECT id FROM fluxbase_global.storage_buckets WHERE (id = $1 OR name = $1) AND project_id = $2`,
            [bucketId, projectId]
        );

        if (bucketQuery.rows.length === 0) {
            return NextResponse.json({ success: false, error: { message: 'Bucket not found', code: ERROR_CODES.BUCKET_NOT_FOUND } }, { status: 404 });
        }

        const actualBucketId = bucketQuery.rows[0].id;

        const result = await pool.query(
            `SELECT id, name, s3_key, size, mime_type, created_at
             FROM fluxbase_global.storage_objects
             WHERE bucket_id = $1 AND project_id = $2
             ORDER BY created_at DESC`,
            [actualBucketId, projectId]
        );

        return NextResponse.json({ success: true, files: result.rows });
    } catch (e) {
        return handleDatabaseError(e);
    }
}

// DELETE /api/storage/files  body: { fileId, projectId }
export async function DELETE(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });

    const body = await req.json();
    const { fileId, projectId } = body;

    if (!fileId || !projectId) {
        return NextResponse.json({ success: false, error: { message: 'fileId and projectId required', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });
    }

    try {
        await requireProjectAccess(projectId, auth, ['admin', 'developer']);
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }

    try {
        const pool = getPgPool();
        // Verify the file belongs to this project
        const fileRes = await pool.query(
            `SELECT id, s3_key FROM fluxbase_global.storage_objects WHERE id = $1 AND project_id = $2`,
            [fileId, projectId]
        );
        if (fileRes.rows.length === 0) return NextResponse.json({ success: false, error: { message: 'File not found', code: ERROR_CODES.FILE_NOT_FOUND } }, { status: 404 });

        // Delete from S3 first
        try {
            await deleteFromS3(fileRes.rows[0].s3_key);
        } catch (e: any) {
            logger.error('S3 delete error:', e);
            // Continue to delete from DB even if S3 fails (orphan cleanup later)
        }

        // Delete from DB
        await pool.query(`DELETE FROM fluxbase_global.storage_objects WHERE id = $1 AND project_id = $2`, [fileId, projectId]);

        return NextResponse.json({ success: true });
    } catch (e) {
        return handleDatabaseError(e);
    }
}
