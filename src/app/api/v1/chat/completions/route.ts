import { NextRequest, NextResponse } from 'next/server';
import { resolveFluxModel, getProviderConfig, buildFallbackChain, type FluxModelSpec } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, checkTierAccess, handleOptions, aiError, CORS_HEADERS } from '@/lib/ai-gateway/auth-middleware';
import { checkAiRateLimit, estimateTokens } from '@/lib/ai-gateway/rate-limiter';
import { recordAiUsage } from '@/lib/ai-gateway/usage-ledger';
import { whitelabelStream, aiSuccess } from '@/lib/ai-gateway/response-helpers';
import { executeBedrockConverse, executeBedrockConverseStream } from '@/lib/ai-gateway/bedrock-adapter';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max execution duration for streaming responses

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(req: NextRequest) {
  // 1. Authenticate Request
  const { auth, errorResponse } = await authenticateAiRequest(req);
  if (errorResponse || !auth) return errorResponse;

  // 2. Parse & Validate Request Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return aiError('Invalid JSON in request body.', 'invalid_request_error', 400);
  }

  const { messages, model: requestedModel = 'flux-fast', stream = false, temperature, top_p, max_tokens, tools, tool_choice, response_format, allow_fallback = false } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return aiError('Invalid request: "messages" must be a non-empty array.', 'invalid_request_error', 400);
  }

  // 3. Resolve Model Spec
  const primarySpec = resolveFluxModel(requestedModel, 'text');

  // 4. Check Tier Permissions
  const tierAccess = checkTierAccess(auth.tier, primarySpec);
  if (!tierAccess.allowed && tierAccess.errorResponse) {
    return tierAccess.errorResponse;
  }

  // 5. Dual-Dimension Rate Limiting (RPM + TPM)
  const estTokens = estimateTokens(messages, 'text');
  const rl = await checkAiRateLimit(auth.userId, auth.tier, 'text', estTokens);
  if (!rl.allowed) {
    return aiError(rl.reason || 'Rate limit exceeded.', 'rate_limit_error', 429, rl.headers);
  }

  const hasMultimodal = Array.isArray(messages) && messages.some((m: any) => {
    if (Array.isArray(m?.content)) {
      return m.content.some((p: any) => p && (p.type === 'image_url' || p.image_url));
    }
    return Array.isArray(m?.images) && m.images.length > 0;
  });

  // Normalize messages with images into standard OpenAI vision format
  const formattedMessages = messages.map((m: any) => {
    if (Array.isArray(m?.images) && m.images.length > 0 && typeof m?.content === 'string') {
      return {
        ...m,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map((url: string) => ({ type: 'image_url', image_url: { url } }))
        ]
      };
    }
    return m;
  });

  const outboundModelName = primarySpec.id;
  const startTime = Date.now();
  const allowFallback = Boolean(allow_fallback);
  const fallbackChain = buildFallbackChain(primarySpec, hasMultimodal, allowFallback);
  let lastError: any = null;

  for (const spec of fallbackChain) {
    const providerConfig = getProviderConfig(spec.provider);
    if (!providerConfig.isAvailable) {
      if (!allowFallback) {
        return aiError(
          `Provider '${spec.provider}' for model '${spec.id}' is not configured or missing API credentials (${spec.provider.toUpperCase()}_API_KEY or AWS credentials).`,
          'configuration_error',
          503,
          rl.headers
        );
      }
      continue;
    }

    try {
      // Direct AWS Bedrock Converse API Dispatch
      if (spec.provider === 'bedrock') {
        const isThinkingCapable = Boolean(spec.capabilities?.includes('extended-thinking') && spec.upstreamModel.includes('3-7'));
        const bedrockOpts = {
          modelId: spec.upstreamModel,
          messages: formattedMessages,
          temperature: isThinkingCapable ? undefined : temperature,
          top_p: isThinkingCapable ? undefined : top_p,
          max_tokens,
          outboundModelName,
          enableThinking: isThinkingCapable,
          thinkingBudget: isThinkingCapable ? 2048 : undefined,
        };

        if (stream) {
          const { stream: bedrockStream, getUsage } = await executeBedrockConverseStream(bedrockOpts);
          const latencyMs = Date.now() - startTime;
          const usage = getUsage();

          recordAiUsage({
            userId: auth.userId,
            projectId: auth.projectId,
            modelId: spec.id,
            modality: 'text',
            provider: 'bedrock',
            inputTokens: usage.inputTokens || estTokens,
            outputTokens: usage.outputTokens || 150,
            latencyMs,
            status: 'success',
          });

          recordProjectRollup(auth.projectId, 1, (usage.inputTokens || estTokens) + 150);

          return new Response(bedrockStream, {
            headers: {
              ...CORS_HEADERS,
              ...rl.headers,
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
          });
        }

        const data = await executeBedrockConverse(bedrockOpts);
        const latencyMs = Date.now() - startTime;
        const promptTokens = data?.usage?.prompt_tokens || estTokens;
        const completionTokens = data?.usage?.completion_tokens || 50;

        recordAiUsage({
          userId: auth.userId,
          projectId: auth.projectId,
          modelId: spec.id,
          modality: 'text',
          provider: 'bedrock',
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          latencyMs,
          status: 'success',
        });

        recordProjectRollup(auth.projectId, 1, promptTokens + completionTokens);

        return aiSuccess(data, rl.headers);
      }

      const upstreamPayload: Record<string, any> = {
        model: spec.upstreamModel,
        messages: formattedMessages,
        stream: Boolean(stream),
      };

      if (typeof temperature === 'number') upstreamPayload.temperature = temperature;
      if (typeof top_p === 'number') upstreamPayload.top_p = top_p;
      if (typeof max_tokens === 'number') upstreamPayload.max_tokens = max_tokens;
      if (tools) upstreamPayload.tools = tools;
      if (tool_choice) upstreamPayload.tool_choice = tool_choice;
      if (response_format) upstreamPayload.response_format = response_format;

      const upstreamResponse = await fetch(spec.upstreamEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${providerConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upstreamPayload),
      });

      if (!upstreamResponse.ok) {
        const errText = await upstreamResponse.text();
        throw new Error(`${spec.provider} error (${upstreamResponse.status}): ${errText}`);
      }

      // 6. Streaming Mode (SSE)
      if (stream) {
        const upstreamBody = upstreamResponse.body;
        if (!upstreamBody) {
          throw new Error('No response body received from upstream stream.');
        }

        recordAiUsage({
          userId: auth.userId,
          projectId: auth.projectId,
          modelId: spec.id,
          modality: 'text',
          provider: spec.provider,
          inputTokens: estTokens,
          outputTokens: 150,
          latencyMs: Date.now() - startTime,
          status: 'success',
        });

        recordProjectRollup(auth.projectId, 1, estTokens + 150);

        const transformedStream = whitelabelStream(upstreamBody, outboundModelName);

        return new Response(transformedStream, {
          headers: {
            ...CORS_HEADERS,
            ...rl.headers,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      // 7. Non-Streaming JSON Mode
      const data = await upstreamResponse.json();
      const latencyMs = Date.now() - startTime;
      const promptTokens = data?.usage?.prompt_tokens || estTokens;
      const completionTokens = data?.usage?.completion_tokens || 50;

      recordAiUsage({
        userId: auth.userId,
        projectId: auth.projectId,
        modelId: spec.id,
        modality: 'text',
        provider: spec.provider,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        latencyMs,
        status: 'success',
      });

      recordProjectRollup(auth.projectId, 1, promptTokens + completionTokens);

      if (data && typeof data === 'object') {
        data.model = outboundModelName;
      }

      return NextResponse.json(data, {
        headers: {
          ...CORS_HEADERS,
          ...rl.headers,
        },
      });
    } catch (err: any) {
      logger.warn(`[ChatCompletions] Model ${spec.id} (${spec.provider}) failed: ${err?.message || err}`);
      lastError = err;
      if (!allowFallback) {
        return aiError(
          `[${spec.provider}] ${err?.message || err}`,
          'upstream_error',
          502,
          rl.headers
        );
      }
    }
  }

  // All upstream providers exhausted
  recordAiUsage({
    userId: auth.userId,
    projectId: auth.projectId,
    modelId: primarySpec.id,
    modality: 'text',
    provider: primarySpec.provider,
    latencyMs: Date.now() - startTime,
    status: 'error',
  });

  return aiError(
    lastError?.message || 'Upstream AI provider error: service temporarily unavailable across all providers.',
    'api_error',
    502,
    rl.headers
  );
}

/**
 * Updates hourly project rollups for database dashboard analytics
 */
function recordProjectRollup(projectId: string | undefined, calls: number, tokens: number) {
  if (!projectId) return;
  setImmediate(async () => {
    try {
      const hourStartMs = Math.floor(Date.now() / 3600000) * 3600000;
      const callsKey = `analytics_rollup:${projectId}:${hourStartMs}:api_call`;
      const tokensKey = `analytics_rollup:${projectId}:${hourStartMs}:ai_tokens`;
      await (redis as any).incrby(callsKey, calls);
      await (redis as any).incrby(tokensKey, tokens);
      await (redis as any).sadd('analytics_keys_to_flush', callsKey, tokensKey);
    } catch {}
  });
}
