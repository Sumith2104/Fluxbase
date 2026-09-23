import { NextRequest } from 'next/server';
import { resolveFluxModel, getProviderConfig, buildFallbackChain, type FluxModelSpec } from '@/lib/ai-gateway/config';
import { authenticateAiRequest, checkTierAccess, handleOptions, aiError } from '@/lib/ai-gateway/auth-middleware';
import { checkAiRateLimit } from '@/lib/ai-gateway/rate-limiter';
import { recordAiUsage } from '@/lib/ai-gateway/usage-ledger';
import { aiSuccess, storeMediaAsset } from '@/lib/ai-gateway/response-helpers';
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

  const prompt = (body?.prompt || '').trim();
  if (!prompt) {
    return aiError("Missing required field 'prompt'.", 'invalid_request_error', 400);
  }

  const requestedModel = body?.model || 'flux-image';
  const primarySpec = resolveFluxModel(requestedModel, 'image');

  // 3. Check Tier Access
  const tierAccess = checkTierAccess(auth.tier, primarySpec);
  if (!tierAccess.allowed && tierAccess.errorResponse) {
    return tierAccess.errorResponse;
  }

  // 4. Rate Limiting Check
  const rl = await checkAiRateLimit(auth.userId, auth.tier, 'image', 1000);
  if (!rl.allowed) {
    return aiError(rl.reason || 'Rate limit exceeded for image generation.', 'rate_limit_error', 429, rl.headers);
  }

  const n = Math.min(Math.max(1, body?.n || 1), 4);
  const size = body?.size || '1024x1024';
  const responseFormat = body?.response_format || 'url';

  const startTime = Date.now();
  const fallbackChain = buildFallbackChain(primarySpec);
  let lastError: any = null;

  for (const spec of fallbackChain) {
    const providerConfig = getProviderConfig(spec.provider);
    if (!providerConfig.isAvailable) continue;

    try {
      const generatedItems = await dispatchImageGeneration(spec, providerConfig.apiKey, prompt, n, size);
      if (generatedItems && generatedItems.length > 0) {
        // Store images in S3 and get durable URLs
        const finalData: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];
        for (const item of generatedItems) {
          if (item.buffer) {
            const { url } = await storeMediaAsset({
              userId: auth.userId,
              projectId: auth.projectId,
              mediaType: 'image',
              buffer: item.buffer,
              mimeType: 'image/png',
              modelId: spec.id,
              prompt,
            });

            if (responseFormat === 'b64_json') {
              finalData.push({
                b64_json: item.buffer.toString('base64'),
                revised_prompt: item.revised_prompt || prompt,
              });
            } else {
              finalData.push({
                url,
                revised_prompt: item.revised_prompt || prompt,
              });
            }
          } else if (item.url) {
            finalData.push({
              url: item.url,
              revised_prompt: item.revised_prompt || prompt,
            });
          }
        }

        const latencyMs = Date.now() - startTime;
        // Record usage asynchronously
        recordAiUsage({
          userId: auth.userId,
          projectId: auth.projectId,
          modelId: spec.id,
          modality: 'image',
          provider: spec.provider,
          latencyMs,
          status: 'success',
          metadata: { promptLength: prompt.length, count: n, size },
        });

        return aiSuccess(
          {
            created: Math.floor(Date.now() / 1000),
            data: finalData,
            model: primarySpec.id,
          },
          rl.headers
        );
      }
    } catch (err: any) {
      logger.warn(`[ImageGen] Model ${spec.id} failed, trying fallback:`, err?.message || err);
      lastError = err;
    }
  }

  // All providers failed
  recordAiUsage({
    userId: auth.userId,
    projectId: auth.projectId,
    modelId: primarySpec.id,
    modality: 'image',
    provider: primarySpec.provider,
    latencyMs: Date.now() - startTime,
    status: 'error',
  });

  return aiError(
    lastError?.message || 'Image generation service temporarily unavailable across all upstream providers.',
    'api_error',
    502,
    rl.headers
  );
}

interface ImageResultItem {
  buffer?: Buffer;
  url?: string;
  revised_prompt?: string;
}

async function dispatchImageGeneration(
  spec: FluxModelSpec,
  apiKey: string,
  prompt: string,
  n: number,
  size: string
): Promise<ImageResultItem[]> {
  // 1. Zhipu (CogView) Dispatch
  if (spec.provider === 'glm') {
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: spec.upstreamModel,
        prompt,
        size: size.includes('x') ? size : '1024x1024',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Zhipu image API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const items: ImageResultItem[] = [];
    if (data?.data && Array.isArray(data.data)) {
      for (const d of data.data) {
        if (d.url) {
          // Download buffer for S3 caching
          try {
            const imgRes = await fetch(d.url);
            const arrayBuf = await imgRes.arrayBuffer();
            items.push({ buffer: Buffer.from(arrayBuf), revised_prompt: d.revised_prompt });
          } catch {
            items.push({ url: d.url, revised_prompt: d.revised_prompt });
          }
        }
      }
    }
    return items;
  }

  // 2. OpenAI (DALL-E) Dispatch
  if (spec.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: spec.upstreamModel,
        prompt,
        n,
        size,
        response_format: 'b64_json',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI image API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const items: ImageResultItem[] = [];
    if (data?.data && Array.isArray(data.data)) {
      for (const d of data.data) {
        if (d.b64_json) {
          items.push({
            buffer: Buffer.from(d.b64_json, 'base64'),
            revised_prompt: d.revised_prompt,
          });
        } else if (d.url) {
          items.push({ url: d.url, revised_prompt: d.revised_prompt });
        }
      }
    }
    return items;
  }

  // 3. Gemini Imagen Dispatch
  if (spec.provider === 'gemini') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${spec.upstreamModel}:predict?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: n, aspectRatio: '1:1' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini image API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const items: ImageResultItem[] = [];
    if (data?.predictions && Array.isArray(data.predictions)) {
      for (const p of data.predictions) {
        if (p.bytesBase64Encoded) {
          items.push({
            buffer: Buffer.from(p.bytesBase64Encoded, 'base64'),
            revised_prompt: prompt,
          });
        }
      }
    }
    return items;
  }

  // 4. AWS Bedrock (Stability AI Stable Image Ultra) Dispatch
  if (spec.provider === 'bedrock') {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const region = process.env.AWS_BEDROCK_IMAGE_REGION || 'us-west-2';
    const client = new BedrockRuntimeClient({ region });

    const payload = {
      prompt,
      mode: 'text-to-image',
      aspect_ratio: size === '1024x1024' ? '1:1' : (size.includes('16:9') || size.includes('1792') ? '16:9' : '1:1'),
      output_format: 'jpeg',
    };

    const cmd = new InvokeModelCommand({
      modelId: spec.upstreamModel,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const res = await client.send(cmd);
    const bodyText = new TextDecoder().decode(res.body);
    const data = JSON.parse(bodyText);
    const items: ImageResultItem[] = [];
    if (data?.images && Array.isArray(data.images)) {
      for (const imgB64 of data.images) {
        items.push({
          buffer: Buffer.from(imgB64, 'base64'),
          revised_prompt: prompt,
        });
      }
    }
    return items;
  }

  return [];
}
