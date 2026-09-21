import { NextRequest, NextResponse } from 'next/server';
import { resolveFluxModel, getProviderConfig, buildFallbackChain, type FluxModelSpec } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, checkTierAccess, handleOptions, aiError, CORS_HEADERS } from '@/lib/ai-gateway/auth-middleware';
import { checkAiRateLimit } from '@/lib/ai-gateway/rate-limiter';
import { recordAiUsage } from '@/lib/ai-gateway/usage-ledger';
import { aiSuccess } from '@/lib/ai-gateway/response-helpers';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(req: NextRequest) {
  // 1. Authenticate Request
  const { auth, errorResponse } = await authenticateAiRequest(req);
  if (errorResponse || !auth) return errorResponse;

  // 2. Parse Multipart Form Data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return aiError('Invalid multipart form data in request.', 'invalid_request_error', 400);
  }

  const audioFile = formData.get('file') as Blob | null;
  if (!audioFile) {
    return aiError("Missing required multipart field 'file'.", 'invalid_request_error', 400);
  }

  const requestedModel = (formData.get('model') as string) || 'flux-listen';
  const primarySpec = resolveFluxModel(requestedModel, 'audio-stt');

  // 3. Check Tier Access
  const tierAccess = checkTierAccess(auth.tier, primarySpec);
  if (!tierAccess.allowed && tierAccess.errorResponse) {
    return tierAccess.errorResponse;
  }

  // 4. Rate Limiting Check
  const rl = await checkAiRateLimit(auth.userId, auth.tier, 'audio-stt', 500);
  if (!rl.allowed) {
    return aiError(rl.reason || 'Rate limit exceeded for speech-to-text.', 'rate_limit_error', 429, rl.headers);
  }

  const responseFormat = (formData.get('response_format') as string) || 'json';
  const language = formData.get('language') as string | null;
  const prompt = formData.get('prompt') as string | null;
  const temperature = formData.get('temperature') as string | null;

  const audioBytes = await audioFile.arrayBuffer();
  const startTime = Date.now();
  const fallbackChain = buildFallbackChain(primarySpec);
  let lastError: any = null;

  for (const spec of fallbackChain) {
    const providerConfig = getProviderConfig(spec.provider);
    if (!providerConfig.isAvailable) continue;

    try {
      // Build outbound form data for upstream
      const upstreamFormData = new FormData();
      upstreamFormData.append('file', new Blob([audioBytes], { type: audioFile.type || 'audio/wav' }), 'audio.wav');
      upstreamFormData.append('model', spec.upstreamModel);
      if (responseFormat) upstreamFormData.append('response_format', responseFormat);
      if (language) upstreamFormData.append('language', language);
      if (prompt) upstreamFormData.append('prompt', prompt);
      if (temperature) upstreamFormData.append('temperature', temperature);

      const endpoint = spec.provider === 'groq'
        ? 'https://api.groq.com/openai/v1/audio/transcriptions'
        : 'https://api.openai.com/v1/audio/transcriptions';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${providerConfig.apiKey}`,
        },
        body: upstreamFormData,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Upstream ${spec.provider} transcription error (${res.status}): ${errBody}`);
      }

      const latencyMs = Date.now() - startTime;
      recordAiUsage({
        userId: auth.userId,
        projectId: auth.projectId,
        modelId: spec.id,
        modality: 'audio-stt',
        provider: spec.provider,
        latencyMs,
        status: 'success',
      });

      if (responseFormat === 'text' || responseFormat === 'srt' || responseFormat === 'vtt') {
        const textOutput = await res.text();
        return new NextResponse(textOutput, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            ...rl.headers,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      const resultJson = await res.json();
      // Whitelabel the model in the response
      resultJson.model = primarySpec.id;

      return aiSuccess(resultJson, rl.headers);
    } catch (err: any) {
      logger.warn(`[AudioSTT] Model ${spec.id} failed, trying fallback:`, err?.message || err);
      lastError = err;
    }
  }

  // Fallback failed
  recordAiUsage({
    userId: auth.userId,
    projectId: auth.projectId,
    modelId: primarySpec.id,
    modality: 'audio-stt',
    provider: primarySpec.provider,
    latencyMs: Date.now() - startTime,
    status: 'error',
  });

  return aiError(
    lastError?.message || 'Audio transcription service temporarily unavailable.',
    'api_error',
    502,
    rl.headers
  );
}
