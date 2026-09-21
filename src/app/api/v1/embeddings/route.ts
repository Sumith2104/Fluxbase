import { NextRequest } from 'next/server';
import { resolveFluxModel, getProviderConfig } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, checkTierAccess, handleOptions, aiError } from '@/lib/ai-gateway/auth-middleware';
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

  // 2. Parse Request Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return aiError('Invalid JSON in request body.', 'invalid_request_error', 400);
  }

  const input = body?.input;
  if (!input || (Array.isArray(input) && input.length === 0)) {
    return aiError("Missing required field 'input'.", 'invalid_request_error', 400);
  }

  const requestedModel = body?.model || 'flux-embed';
  const primarySpec = resolveFluxModel(requestedModel, 'embedding');

  // 3. Check Tier Access
  const tierAccess = checkTierAccess(auth.tier, primarySpec);
  if (!tierAccess.allowed && tierAccess.errorResponse) {
    return tierAccess.errorResponse;
  }

  // Count estimated tokens
  const texts = Array.isArray(input) ? input : [input];
  const totalLength = texts.reduce((acc: number, t: any) => acc + (typeof t === 'string' ? t.length : 0), 0);
  const estimatedTokens = Math.max(1, Math.ceil(totalLength / 4));

  // 4. Rate Limiting Check
  const rl = await checkAiRateLimit(auth.userId, auth.tier, 'embedding', estimatedTokens);
  if (!rl.allowed) {
    return aiError(rl.reason || 'Rate limit exceeded for embeddings.', 'rate_limit_error', 429, rl.headers);
  }

  const startTime = Date.now();

  // Try providers in order: Gemini -> OpenAI -> GLM
  const providersToTry: Array<{ provider: 'gemini' | 'openai' | 'glm'; model: string }> = [
    { provider: 'gemini', model: 'text-embedding-004' },
    { provider: 'openai', model: 'text-embedding-3-small' },
    { provider: 'glm', model: 'embedding-3' },
  ];

  let lastError: any = null;

  for (const { provider, model } of providersToTry) {
    const config = getProviderConfig(provider);
    if (!config.isAvailable) continue;

    try {
      let res: Response;

      if (provider === 'gemini') {
        // Gemini OpenAI-compatible embeddings endpoint
        res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, input }),
        });
      } else if (provider === 'openai') {
        res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, input }),
        });
      } else {
        res = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, input: Array.isArray(input) ? input.join('\n') : input }),
        });
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${provider} embeddings error (${res.status}): ${errBody}`);
      }

      const result = await res.json();
      const latencyMs = Date.now() - startTime;

      recordAiUsage({
        userId: auth.userId,
        projectId: auth.projectId,
        modelId: primarySpec.id,
        modality: 'embedding',
        provider,
        inputTokens: result?.usage?.total_tokens || estimatedTokens,
        latencyMs,
        status: 'success',
      });

      // Whitelabel response model name
      result.model = primarySpec.id;

      return aiSuccess(result, rl.headers);
    } catch (err: any) {
      logger.warn(`[Embeddings] Provider ${provider} failed, trying fallback:`, err?.message || err);
      lastError = err;
    }
  }

  // All providers failed
  recordAiUsage({
    userId: auth.userId,
    projectId: auth.projectId,
    modelId: primarySpec.id,
    modality: 'embedding',
    provider: primarySpec.provider,
    latencyMs: Date.now() - startTime,
    status: 'error',
  });

  return aiError(
    lastError?.message || 'Embeddings service temporarily unavailable.',
    'api_error',
    502,
    rl.headers
  );
}
