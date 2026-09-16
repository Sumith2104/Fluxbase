import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max execution duration for streaming responses

const UPSTREAM_GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, api-key',
};

// Aliases mapping developer / OpenAI / Flux model names to upstream models
const MODEL_ALIASES: Record<string, string> = {
  // Flux branded models
  'flux': 'glm-4-flash',
  'flux-flash': 'glm-4-flash',
  'flux-pro': 'glm-4-air',
  'flux-ultra': 'glm-4-plus',
  'flux-5.2': 'glm-5.2',

  // OpenAI compatibility aliases mapped to Flux
  'gpt-4o': 'glm-4-plus',
  'gpt-4': 'glm-4-plus',
  'gpt-4-turbo': 'glm-4-plus',
  'gpt-3.5-turbo': 'glm-4-flash',
  'claude-3-5-sonnet': 'glm-4-plus',

  // Legacy mappings
  'glm': 'glm-4-flash',
  'glm-4-flash': 'glm-4-flash',
  'glm-4-air': 'glm-4-air',
  'glm-4-plus': 'glm-4-plus',
  'glm-5.2': 'glm-5.2',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(req: NextRequest) {
  // 1. Authenticate Request
  const authHeader = req.headers.get('authorization') || req.headers.get('x-api-key') || req.headers.get('api-key');
  if (!authHeader) {
    return NextResponse.json(
      {
        error: {
          message: 'Missing API key. Provide your Fluxbase API key via Authorization: Bearer <key> or x-api-key header.',
          type: 'authentication_error',
          param: null,
          code: 'missing_api_key'
        }
      },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const rawKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  const authData = await validateApiKey(rawKey);

  if (!authData) {
    return NextResponse.json(
      {
        error: {
          message: 'Invalid API key provided.',
          type: 'authentication_error',
          param: null,
          code: 'invalid_api_key'
        }
      },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  // Check key scopes (allow if scopes contains 'ai', 'write', 'admin', or is empty/read)
  const allowedScopes = ['ai', 'write', 'admin', '*'];
  const hasScope = !authData.scopes || authData.scopes.length === 0 || authData.scopes.some(s => allowedScopes.includes(s) || s === 'read');
  if (!hasScope) {
    return NextResponse.json(
      {
        error: {
          message: 'Insufficient API key permissions for AI gateway access.',
          type: 'permission_error',
          param: null,
          code: 'insufficient_scope'
        }
      },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  // 2. Upstream Master Key Check
  const masterApiKey = process.env.GLM_API_KEY;
  if (!masterApiKey) {
    logger.error('[AI Gateway] Server missing GLM_API_KEY environment variable');
    return NextResponse.json(
      {
        error: {
          message: 'Upstream AI provider is not configured on this Fluxbase server.',
          type: 'api_error',
          param: null,
          code: 'upstream_not_configured'
        }
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  // 3. Rate Limiting Check via Redis (Sliding Window per Minute)
  const currentMinute = Math.floor(Date.now() / 60000);
  const rateLimitKey = `rate_limit:ai_gateway:${authData.userId}:${currentMinute}`;
  const MAX_REQUESTS_PER_MINUTE = 60;

  try {
    const currentCount = await redis.incr(rateLimitKey);
    if (currentCount === 1) {
      await redis.expire(rateLimitKey, 70);
    }
    if (currentCount > MAX_REQUESTS_PER_MINUTE) {
      return NextResponse.json(
        {
          error: {
            message: `Rate limit exceeded: Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute.`,
            type: 'rate_limit_error',
            param: null,
            code: 'rate_limit_exceeded'
          }
        },
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            'Retry-After': '60',
          }
        }
      );
    }
  } catch (err) {
    logger.warn('[AI Gateway] Redis rate limit check failed, proceeding safely:', err);
  }

  // 4. Parse & Validate Request Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: 'Invalid JSON request body.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_json'
        }
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { messages, model: requestedModel = 'flux', stream = false, temperature, top_p, max_tokens, tools, tool_choice, response_format } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      {
        error: {
          message: 'Invalid request: "messages" must be a non-empty array.',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'invalid_messages'
        }
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // 5. Model Resolution (defaults to 'flux' -> 'glm-4-flash')
  const resolvedModel = MODEL_ALIASES[requestedModel.toLowerCase()] || 'glm-4-flash';

  const upstreamPayload: Record<string, any> = {
    model: resolvedModel,
    messages,
    stream: Boolean(stream),
  };

  if (typeof temperature === 'number') upstreamPayload.temperature = temperature;
  if (typeof top_p === 'number') upstreamPayload.top_p = top_p;
  if (typeof max_tokens === 'number') upstreamPayload.max_tokens = max_tokens;
  if (tools) upstreamPayload.tools = tools;
  if (tool_choice) upstreamPayload.tool_choice = tool_choice;
  if (response_format) upstreamPayload.response_format = response_format;

  // 6. Dispatch to Upstream GLM Provider
  try {
    let upstreamResponse = await fetch(UPSTREAM_GLM_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${masterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamPayload),
    });

    // Graceful Tier Fallback: If a premium model returns 429 (quota) or 5xx, automatically retry with glm-4-flash
    if (!upstreamResponse.ok && resolvedModel !== 'glm-4-flash' && (upstreamResponse.status === 429 || upstreamResponse.status >= 500)) {
      logger.warn(`[AI Gateway] Model ${resolvedModel} returned status ${upstreamResponse.status}. Gracefully falling back to glm-4-flash...`);
      upstreamPayload.model = 'glm-4-flash';
      upstreamResponse = await fetch(UPSTREAM_GLM_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${masterApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upstreamPayload),
      });
    }

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      let errorJson: any;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        errorJson = null;
      }

      logger.warn(`[AI Gateway] Upstream GLM error (${upstreamResponse.status}):`, errorText);

      return NextResponse.json(
        errorJson || {
          error: {
            message: `Upstream AI provider error: ${errorText}`,
            type: 'upstream_error',
            param: null,
            code: `upstream_status_${upstreamResponse.status}`
          }
        },
        { status: upstreamResponse.status, headers: CORS_HEADERS }
      );
    }

    // 7. Handle Streaming Mode (SSE)
    if (stream) {
      const upstreamBody = upstreamResponse.body;
      if (!upstreamBody) {
        return NextResponse.json(
          { error: { message: 'No response body received from upstream AI provider.' } },
          { status: 502, headers: CORS_HEADERS }
        );
      }

      // Background token tracking for the project
      recordUsageMetrics(authData.projectId, 1, 150).catch(e =>
        logger.warn('[AI Gateway] Failed to record streaming metrics:', e)
      );

      // Transform stream to ensure model name is white-labeled as Flux in real-time SSE chunks
      const textDecoder = new TextDecoder();
      const textEncoder = new TextEncoder();
      const outboundModelName = requestedModel || 'flux';

      const transformStream = new TransformStream({
        transform(chunk, controller) {
          const text = textDecoder.decode(chunk, { stream: true });
          const replaced = text.replace(/"model"\s*:\s*"[^"]*"/g, `"model":"${outboundModelName}"`);
          controller.enqueue(textEncoder.encode(replaced));
        }
      });

      const clientStream = upstreamBody.pipeThrough(transformStream);

      // Stream directly to client with appropriate SSE headers
      return new Response(clientStream as any, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // 8. Handle Non-Streaming JSON Mode
    const data = await upstreamResponse.json();

    // Preserve the Flux model name the caller requested in the response object
    if (data && typeof data === 'object') {
      data.model = requestedModel || 'flux';
    }

    // Record token usage asynchronously
    const totalTokens = data.usage?.total_tokens || 100;
    recordUsageMetrics(authData.projectId, 1, totalTokens).catch(e =>
      logger.warn('[AI Gateway] Failed to record usage metrics:', e)
    );

    return NextResponse.json(data, {
      headers: CORS_HEADERS,
    });

  } catch (error: any) {
    logger.error('[AI Gateway] Fatal proxy dispatch exception:', error);
    return NextResponse.json(
      {
        error: {
          message: 'An unexpected internal error occurred while communicating with the AI provider.',
          type: 'api_error',
          param: null,
          code: 'gateway_internal_error'
        }
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * Records API call and token consumption to Redis rollups for analytics and PAYG metering.
 */
async function recordUsageMetrics(projectId: string | undefined, calls: number, tokens: number) {
  if (!projectId) return;
  const hourStartMs = Math.floor(Date.now() / 3600000) * 3600000;
  const callsKey = `analytics_rollup:${projectId}:${hourStartMs}:api_call`;
  const tokensKey = `analytics_rollup:${projectId}:${hourStartMs}:ai_tokens`;

  try {
    await redis.incrby(callsKey, calls);
    await redis.incrby(tokensKey, tokens);
    await redis.sadd('analytics_keys_to_flush', callsKey, tokensKey);
  } catch (e) {
    logger.warn('[AI Gateway] Failed to flush rollup metrics:', e);
  }
}
