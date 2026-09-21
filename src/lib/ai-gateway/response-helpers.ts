import { NextResponse } from 'next/server';
import { CORS_HEADERS } from './auth-middleware';
import { uploadToS3, getPresignedUrl } from '@/lib/storage';
import { getPgPool } from '@/lib/pg';
import { ensureAiTablesExist } from './usage-ledger';
import logger from '@/lib/logger';
import crypto from 'crypto';

/**
 * Returns an OpenAI-compatible JSON success response with CORS & Rate Limit headers
 */
export function aiSuccess(data: any, extraHeaders?: Record<string, string>, status: number = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      ...CORS_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

/**
 * Replaces any upstream provider model names in a JSON object with the requested Flux model ID
 */
export function whitelabelJson(data: any, fluxModelId: string): any {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => whitelabelJson(item, fluxModelId));
  }

  const result = { ...data };
  if ('model' in result && typeof result.model === 'string') {
    result.model = fluxModelId;
  }

  return result;
}

/**
 * Transforms an SSE stream chunk-by-chunk to replace upstream model names with the Flux model name
 */
export function whitelabelStream(upstreamStream: ReadableStream, fluxModelId: string): ReadableStream {
  const reader = upstreamStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        const chunkText = decoder.decode(value, { stream: true });
        // Replace model names inside JSON data lines
        const lines = chunkText.split('\n');
        const modifiedLines = lines.map(line => {
          if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
            try {
              const jsonStr = line.slice(6).trim();
              const parsed = JSON.parse(jsonStr);
              if (parsed && typeof parsed === 'object') {
                if (parsed.model) parsed.model = fluxModelId;
                return `data: ${JSON.stringify(parsed)}`;
              }
            } catch {}
          }
          return line;
        });

        controller.enqueue(encoder.encode(modifiedLines.join('\n')));
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    }
  });
}

export interface StoreMediaParams {
  userId: string;
  projectId?: string;
  mediaType: 'image' | 'video' | 'audio';
  buffer: Buffer;
  mimeType: string;
  modelId: string;
  prompt?: string;
  metadata?: Record<string, any>;
  retentionDays?: number;
}

/**
 * Uploads generated media (image/audio/video) to S3, registers in ai_media, and returns URL
 */
export async function storeMediaAsset(params: StoreMediaParams): Promise<{ mediaId: string; url: string }> {
  const mediaId = `${params.mediaType.slice(0, 3)}_${crypto.randomBytes(12).toString('hex')}`;
  const extension = params.mimeType.split('/')[1] || 'bin';
  const timestamp = Date.now();
  const s3Key = `ai-media/${params.mediaType}s/${params.userId}/${timestamp}_${mediaId}.${extension}`;

  let finalUrl = '';

  try {
    // 1. Upload to S3 if configured
    await uploadToS3(s3Key, params.buffer, params.mimeType);
    finalUrl = await getPresignedUrl(s3Key, 86400); // 24-hour presigned URL
  } catch (s3Err: any) {
    logger.warn('[StoreMedia] S3 upload skipped or failed, falling back to base64 URL:', s3Err?.message || s3Err);
    // Base64 fallback if S3 credentials not set
    finalUrl = `data:${params.mimeType};base64,${params.buffer.toString('base64')}`;
  }

  // 2. Persist metadata to database
  try {
    await ensureAiTablesExist();
    const pool = getPgPool();
    const retentionDays = params.retentionDays || 30;
    const expiresAt = new Date(Date.now() + retentionDays * 86400 * 1000);

    await pool.query(
      `INSERT INTO fluxbase_global.ai_media 
       (id, user_id, project_id, media_type, s3_key, mime_type, file_size, model_id, prompt, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        mediaId,
        params.userId,
        params.projectId || null,
        params.mediaType,
        s3Key,
        params.mimeType,
        params.buffer.length,
        params.modelId,
        params.prompt || null,
        JSON.stringify(params.metadata || {}),
        expiresAt,
      ]
    );
  } catch (dbErr: any) {
    logger.warn('[StoreMedia] Failed to write ai_media DB record:', dbErr?.message || dbErr);
  }

  return { mediaId, url: finalUrl };
}
