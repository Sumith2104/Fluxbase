import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { getProjectById } from '@/lib/data';
import { ERROR_CODES } from '@/lib/error-codes';
import crypto from 'crypto';
import { requireWriteScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: { message: 'Unauthorized', code: ERROR_CODES.UNAUTHORIZED } }, { status: 401 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: { message: 'Invalid JSON body', code: ERROR_CODES.BAD_REQUEST } }, { status: 400 });
    }

    const { fileName, fileSize, mimeType, bucketId, projectId, s3Key } = body;
    if (!fileName || fileSize === undefined || !mimeType || !bucketId || !projectId || !s3Key) {
        return NextResponse.json({ success: false, error: { message: 'fileName, fileSize, mimeType, bucketId, projectId and s3Key are required', code: ERROR_CODES.MISSING_FIELD } }, { status: 400 });
    }

    if (auth.allowedProjectId && auth.allowedProjectId !== projectId) {
        return NextResponse.json({ success: false, error: { message: 'This API key is not allowed to access the requested project.', code: ERROR_CODES.FORBIDDEN } }, { status: 403 });
    }

    // Validate project access
    const project = await getProjectById(projectId, auth.userId);
    if (!project) {
        return NextResponse.json({ success: false, error: { message: 'Project not found', code: ERROR_CODES.PROJECT_NOT_FOUND } }, { status: 404 });
    }

    // Save metadata to DB
    const pool = getPgPool();
    const id = crypto.randomUUID();
    try {
        const result = await pool.query(
            `INSERT INTO fluxbase_global.storage_objects (id, bucket_id, project_id, name, s3_key, size, mime_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [id, bucketId, projectId, fileName, s3Key, fileSize, mimeType]
        );
        return NextResponse.json({ success: true, file: result.rows[0] });
    } catch (e: any) {
        logger.error('Finalize save error:', e);
        return NextResponse.json({ success: false, error: { message: 'Failed to record object metadata', code: ERROR_CODES.INTERNAL_ERROR } }, { status: 500 });
    }
}
