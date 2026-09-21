import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';
import { FLUX_MODEL_REGISTRY, MODEL_ALIASES } from '@/lib/ai-gateway/config';
import { CORS_HEADERS, handleOptions } from '@/lib/ai-gateway/auth-middleware';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return handleOptions();
}

export async function GET(req: NextRequest) {
  // Optional auth: validate key if provided
  const authHeader = req.headers.get('authorization') || req.headers.get('x-api-key') || req.headers.get('api-key');
  if (authHeader) {
    const rawKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    const authData = await validateApiKey(rawKey);
    if (!authData) {
      return NextResponse.json(
        {
          error: {
            message: 'Invalid API key provided.',
            type: 'invalid_request_error',
            param: null,
            code: 'invalid_api_key'
          }
        },
        { status: 401, headers: CORS_HEADERS }
      );
    }
  }

  // Generate dynamic models list from registry
  const models = Object.values(FLUX_MODEL_REGISTRY).map(spec => ({
    id: spec.id,
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    label: spec.label,
    description: spec.description,
    modality: spec.modality,
    min_tier: spec.minTier,
    capabilities: spec.capabilities,
    context_window: spec.contextWindow || undefined,
    supported_formats: spec.supportedFormats || undefined,
    supported_voices: spec.supportedVoices || undefined,
  }));

  // Add standard OpenAI compatibility aliases
  const aliasEntries = [
    { id: 'gpt-4o', mapped: 'flux-ultra', modality: 'text', description: 'OpenAI compatibility alias mapped to flux-ultra' },
    { id: 'gpt-4o-mini', mapped: 'flux-max', modality: 'text', description: 'OpenAI compatibility alias mapped to flux-max' },
    { id: 'gpt-3.5-turbo', mapped: 'flux-fast', modality: 'text', description: 'OpenAI compatibility alias mapped to flux-fast' },
    { id: 'dall-e-3', mapped: 'flux-image', modality: 'image', description: 'OpenAI compatibility alias mapped to flux-image' },
    { id: 'whisper-1', mapped: 'flux-listen', modality: 'audio-stt', description: 'OpenAI compatibility alias mapped to flux-listen' },
    { id: 'tts-1', mapped: 'flux-speak', modality: 'audio-tts', description: 'OpenAI compatibility alias mapped to flux-speak' },
    { id: 'text-embedding-3-small', mapped: 'flux-embed', modality: 'embedding', description: 'OpenAI compatibility alias mapped to flux-embed' },
  ];

  for (const alias of aliasEntries) {
    const targetSpec = FLUX_MODEL_REGISTRY[alias.mapped];
    if (targetSpec && !models.some(m => m.id === alias.id)) {
      models.push({
        id: alias.id,
        object: 'model',
        created: 1717113600,
        owned_by: 'fluxbase',
        label: alias.id,
        description: alias.description,
        modality: alias.modality as any,
        min_tier: targetSpec.minTier,
        capabilities: targetSpec.capabilities,
        context_window: targetSpec.contextWindow || undefined,
        supported_formats: targetSpec.supportedFormats || undefined,
        supported_voices: targetSpec.supportedVoices || undefined,
      });
    }
  }

  return NextResponse.json(
    {
      object: 'list',
      data: models
    },
    { headers: CORS_HEADERS }
  );
}
