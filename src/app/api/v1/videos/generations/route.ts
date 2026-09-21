import { NextRequest, NextResponse } from 'next/server';
import { resolveFluxModel, getProviderConfig, buildFallbackChain } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, checkTierAccess, handleOptions, aiError, CORS_HEADERS } from '@/lib/ai-gateway/auth-middleware';
import { checkAiRateLimit } from '@/lib/ai-gateway/rate-limiter';
import { recordAiUsage } from '@/lib/ai-gateway/usage-ledger';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(req: NextRequest) {
  // 1. Authenticate Request
  const { auth, errorResponse } = await authenticateAiRequest(req);
  if (errorResponse || !auth) return errorResponse;

  // 2. Parse Request Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return aiError('Invalid JSON in request body.', 'invalid_request_error', 400);
  }

  const prompt = (body?.prompt || '').trim();
  if (!prompt) {
    return aiError("Missing required field 'prompt'.", 'invalid_request_error', 400);
  }

  const requestedModel = body?.model || 'flux-video';
  const primarySpec = resolveFluxModel(requestedModel, 'video');

  // 3. Check Tier Access (Free tier blocked)
  const tierAccess = checkTierAccess(auth.tier, primarySpec);
  if (!tierAccess.allowed && tierAccess.errorResponse) {
    return tierAccess.errorResponse;
  }

  // 4. Rate Limiting Check
  const rl = await checkAiRateLimit(auth.userId, auth.tier, 'video', 5000);
  if (!rl.allowed) {
    return aiError(rl.reason || 'Rate limit exceeded for video generation.', 'rate_limit_error', 429, rl.headers);
  }

  const startTime = Date.now();
  const providerConfig = getProviderConfig(primarySpec.provider);

  if (!providerConfig.isAvailable) {
    return aiError(
      `Video provider '${primarySpec.provider}' is not configured or missing API credentials.`,
      'api_error',
      503,
      rl.headers
    );
  }

  try {
    // Dispatch async generation to Zhipu CogVideoX
    const upstreamRes = await fetch(primarySpec.upstreamEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: primarySpec.upstreamModel,
        prompt,
        image_url: body?.image_url || undefined,
        quality: body?.quality || 'quality',
        with_audio: body?.with_audio ?? false,
        size: body?.size || '1280x720',
        duration: body?.duration || 5,
        fps: body?.fps || 30,
      }),
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      throw new Error(`Upstream video task creation error (${upstreamRes.status}): ${errText}`);
    }

    const upstreamData = await upstreamRes.json();
    const upstreamTaskId = upstreamData.id || upstreamData.task_id;
    if (!upstreamTaskId) {
      throw new Error('Upstream did not return a valid task ID.');
    }

    const fluxTaskId = `vid_${crypto.randomBytes(12).toString('hex')}`;

    // Store task mapping in Redis for 2 hours
    const taskData = {
      fluxTaskId,
      upstreamTaskId,
      provider: primarySpec.provider,
      modelId: primarySpec.id,
      userId: auth.userId,
      projectId: auth.projectId,
      prompt,
      createdAt: Date.now(),
      status: 'processing',
    };

    await (redis as any).set(`ai_video_task:${fluxTaskId}`, taskData, { ex: 7200 });

    recordAiUsage({
      userId: auth.userId,
      projectId: auth.projectId,
      modelId: primarySpec.id,
      modality: 'video',
      provider: primarySpec.provider,
      latencyMs: Date.now() - startTime,
      status: 'success',
      metadata: { promptLength: prompt.length, asyncTaskId: fluxTaskId },
    });

    return NextResponse.json(
      {
        id: fluxTaskId,
        object: 'video.generation',
        status: 'processing',
        model: primarySpec.id,
        created: Math.floor(Date.now() / 1000),
        poll_url: `/api/v1/videos/generations/${fluxTaskId}`,
      },
      {
        status: 202,
        headers: {
          ...CORS_HEADERS,
          ...rl.headers,
        },
      }
    );
  } catch (err: any) {
    logger.error('[VideoGen] Error dispatching async task:', err);
    return aiError(err?.message || 'Failed to initialize video generation task.', 'api_error', 500, rl.headers);
  }
}
