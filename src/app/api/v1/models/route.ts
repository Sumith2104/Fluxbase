import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';

export const dynamic = 'force-dynamic';

const AVAILABLE_MODELS = [
  {
    id: 'flux',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'Flagship Flux AI reasoning model (fast, high-accuracy intelligence)'
  },
  {
    id: 'flux-flash',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'Ultra-low latency reasoning and code synthesis model by Fluxbase'
  },
  {
    id: 'flux-pro',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'Balanced performance and depth for complex instructions and multi-step logic'
  },
  {
    id: 'flux-ultra',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'Maximum capability enterprise intelligence with deep reasoning and long context'
  },
  {
    id: 'flux-5.2',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'Frontier reasoning and synthetic multi-turn execution architecture'
  },
  {
    id: 'gpt-4o',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'OpenAI compatibility alias mapped to flux-ultra'
  },
  {
    id: 'gpt-3.5-turbo',
    object: 'model',
    created: 1717113600,
    owned_by: 'fluxbase',
    description: 'OpenAI compatibility alias mapped to flux-flash'
  }
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, api-key',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  // Optional auth: allow public discovery or validate key if provided
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

  return NextResponse.json(
    {
      object: 'list',
      data: AVAILABLE_MODELS
    },
    { headers: CORS_HEADERS }
  );
}
