import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getPresignedUrl } from '@/lib/storage';
import { authenticateAiRequest, handleOptions, aiError, CORS_HEADERS } from '@/lib/ai-gateway/auth-middleware';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  if (!mediaId) {
    return aiError('Missing mediaId parameter.', 'invalid_request_error', 400);
  }

  // Look up asset in PostgreSQL
  try {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT id, user_id, media_type, s3_key, mime_type, expires_at 
       FROM fluxbase_global.ai_media 
       WHERE id = $1`,
      [mediaId]
    );

    if (res.rows.length === 0) {
      return aiError(`Media asset '${mediaId}' not found.`, 'invalid_request_error', 404);
    }

    const media = res.rows[0];

    // Check expiry
    if (media.expires_at && new Date(media.expires_at) < new Date()) {
      return aiError(`Media asset '${mediaId}' has expired and was cleaned up.`, 'invalid_request_error', 410);
    }

    // Generate fresh presigned GET URL (1 hour)
    const presignedUrl = await getPresignedUrl(media.s3_key, 3600);

    // Redirect to private S3 URL
    return NextResponse.redirect(presignedUrl, {
      status: 302,
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    logger.error(`[MediaRoute] Error serving media ${mediaId}:`, err);
    return aiError('Failed to retrieve media asset.', 'internal_error', 500);
  }
}
