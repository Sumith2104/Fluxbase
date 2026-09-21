import { NextRequest } from 'next/server';
import { getProviderConfig } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, handleOptions, aiError } from '@/lib/ai-gateway/auth-middleware';
import { aiSuccess, storeMediaAsset } from '@/lib/ai-gateway/response-helpers';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { auth, errorResponse } = await authenticateAiRequest(req);
  if (errorResponse || !auth) return errorResponse;

  const { taskId } = await params;
  if (!taskId) {
    return aiError('Missing taskId parameter in request path.', 'invalid_request_error', 400);
  }

  // 1. Retrieve Task from Redis
  const taskKey = `ai_video_task:${taskId}`;
  const taskData: any = await (redis as any).get(taskKey);

  if (!taskData) {
    return aiError(`Video generation task '${taskId}' not found or has expired.`, 'invalid_request_error', 404);
  }

  // Ensure requesting user owns the task
  if (taskData.userId !== auth.userId) {
    return aiError('Unauthorized to inspect this generation task.', 'permission_error', 403);
  }

  // 2. Return immediately if already completed or failed
  if (taskData.status === 'completed') {
    return aiSuccess({
      id: taskId,
      object: 'video.generation',
      status: 'completed',
      model: taskData.modelId,
      created: Math.floor(taskData.createdAt / 1000),
      data: taskData.data,
    });
  }

  if (taskData.status === 'failed') {
    return aiSuccess({
      id: taskId,
      object: 'video.generation',
      status: 'failed',
      model: taskData.modelId,
      created: Math.floor(taskData.createdAt / 1000),
      error: taskData.error || 'Video generation failed upstream.',
    });
  }

  // 3. Poll upstream provider (Zhipu CogVideoX)
  const providerConfig = getProviderConfig(taskData.provider);
  if (!providerConfig.isAvailable) {
    return aiError('Provider credentials missing to query task.', 'api_error', 500);
  }

  try {
    const upstreamUrl = `https://open.bigmodel.cn/api/paas/v4/async-result/${taskData.upstreamTaskId}`;
    const res = await fetch(upstreamUrl, {
      headers: {
        'Authorization': `Bearer ${providerConfig.apiKey}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.warn(`[VideoPoll] Upstream check failed (${res.status}):`, errText);
      return aiSuccess({
        id: taskId,
        object: 'video.generation',
        status: 'processing',
        model: taskData.modelId,
        created: Math.floor(taskData.createdAt / 1000),
      });
    }

    const data = await res.json();
    const taskStatus = (data.task_status || '').toUpperCase();

    if (taskStatus === 'SUCCESS') {
      const videoResults = data.video_result || [];
      const finalData: any[] = [];

      for (const v of videoResults) {
        if (v.url) {
          try {
            // Download video and store in durable S3
            const vidFetch = await fetch(v.url);
            const arrayBuf = await vidFetch.arrayBuffer();
            const { url: durableUrl } = await storeMediaAsset({
              userId: auth.userId,
              projectId: auth.projectId,
              mediaType: 'video',
              buffer: Buffer.from(arrayBuf),
              mimeType: 'video/mp4',
              modelId: taskData.modelId,
              prompt: taskData.prompt,
            });

            finalData.push({
              url: durableUrl,
              revised_prompt: taskData.prompt,
            });
          } catch {
            finalData.push({
              url: v.url,
              revised_prompt: taskData.prompt,
            });
          }
        }
      }

      // Update Redis task state
      taskData.status = 'completed';
      taskData.data = finalData;
      await (redis as any).set(taskKey, taskData, { ex: 86400 });

      return aiSuccess({
        id: taskId,
        object: 'video.generation',
        status: 'completed',
        model: taskData.modelId,
        created: Math.floor(taskData.createdAt / 1000),
        data: finalData,
      });
    }

    if (taskStatus === 'FAIL') {
      taskData.status = 'failed';
      taskData.error = data.message || 'Upstream video synthesis failed.';
      await (redis as any).set(taskKey, taskData, { ex: 86400 });

      return aiSuccess({
        id: taskId,
        object: 'video.generation',
        status: 'failed',
        model: taskData.modelId,
        created: Math.floor(taskData.createdAt / 1000),
        error: taskData.error,
      });
    }

    // Still PROCESSING
    return aiSuccess({
      id: taskId,
      object: 'video.generation',
      status: 'processing',
      model: taskData.modelId,
      created: Math.floor(taskData.createdAt / 1000),
    });
  } catch (pollErr: any) {
    logger.error('[VideoPoll] Error polling upstream:', pollErr);
    return aiSuccess({
      id: taskId,
      object: 'video.generation',
      status: 'processing',
      model: taskData.modelId,
      created: Math.floor(taskData.createdAt / 1000),
    });
  }
}
