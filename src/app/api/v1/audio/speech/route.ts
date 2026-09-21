import { NextRequest, NextResponse } from 'next/server';
import { resolveFluxModel, getProviderConfig, buildFallbackChain } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, checkTierAccess, handleOptions, aiError, CORS_HEADERS } from '@/lib/ai-gateway/auth-middleware';
import { checkAiRateLimit } from '@/lib/ai-gateway/rate-limiter';
import { recordAiUsage } from '@/lib/ai-gateway/usage-ledger';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleOptions();
}

const MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

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

  const input = (body?.input || '').trim();
  if (!input) {
    return aiError("Missing required field 'input'.", 'invalid_request_error', 400);
  }

  const requestedModel = body?.model || 'flux-speak';
  const primarySpec = resolveFluxModel(requestedModel, 'audio-tts');

  // 3. Check Tier Access
  const tierAccess = checkTierAccess(auth.tier, primarySpec);
  if (!tierAccess.allowed && tierAccess.errorResponse) {
    return tierAccess.errorResponse;
  }

  // 4. Rate Limiting Check
  const rl = await checkAiRateLimit(auth.userId, auth.tier, 'audio-tts', Math.max(100, Math.ceil(input.length / 4)));
  if (!rl.allowed) {
    return aiError(rl.reason || 'Rate limit exceeded for text-to-speech.', 'rate_limit_error', 429, rl.headers);
  }

  const voice = body?.voice || 'alloy';
  const responseFormat = (body?.response_format || 'mp3').toLowerCase();
  const speed = typeof body?.speed === 'number' ? Math.max(0.25, Math.min(4.0, body.speed)) : 1.0;

  const startTime = Date.now();
  const fallbackChain = buildFallbackChain(primarySpec);
  let lastError: any = null;

  for (const spec of fallbackChain) {
    const providerConfig = getProviderConfig(spec.provider);
    if (!providerConfig.isAvailable) continue;

    try {
      const upstreamRes = await fetch(spec.upstreamEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${providerConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: spec.upstreamModel,
          input,
          voice,
          response_format: responseFormat,
          speed,
        }),
      });

      if (!upstreamRes.ok) {
        const errText = await upstreamRes.text();
        throw new Error(`Upstream TTS error (${upstreamRes.status}): ${errText}`);
      }

      const audioBuffer = await upstreamRes.arrayBuffer();
      const latencyMs = Date.now() - startTime;

      recordAiUsage({
        userId: auth.userId,
        projectId: auth.projectId,
        modelId: spec.id,
        modality: 'audio-tts',
        provider: spec.provider,
        latencyMs,
        status: 'success',
        metadata: { inputLength: input.length, voice, format: responseFormat },
      });

      const contentType = MIME_TYPES[responseFormat] || 'audio/mpeg';

      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          ...rl.headers,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="speech.${responseFormat}"`,
        },
      });
    } catch (err: any) {
      logger.warn(`[AudioTTS] Model ${spec.id} failed, trying fallback:`, err?.message || err);
      lastError = err;
    }
  }

  // All failed
  recordAiUsage({
    userId: auth.userId,
    projectId: auth.projectId,
    modelId: primarySpec.id,
    modality: 'audio-tts',
    provider: primarySpec.provider,
    latencyMs: Date.now() - startTime,
    status: 'error',
  });

  return aiError(
    lastError?.message || 'Text-to-speech service temporarily unavailable.',
    'api_error',
    502,
    rl.headers
  );
}
