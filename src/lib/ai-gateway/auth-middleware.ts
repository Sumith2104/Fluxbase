import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';
import { getAuthContextFromRequest } from '@/lib/auth';
import { getUserPlan } from '@/lib/limits';
import { isUnlimitedTier } from './rate-limiter';
import type { FluxModelSpec } from './config';

export interface AiAuthContext {
  userId: string;
  projectId?: string;
  tier: string;
  scopes: string[];
  isApiKey: boolean;
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With, OpenAI-Beta, OpenAI-Organization',
  'Access-Control-Max-Age': '86400',
};

export function handleOptions() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Standard OpenAI-compatible error response builder
 */
export function aiError(message: string, type: string = 'invalid_request_error', status: number = 400, extraHeaders?: Record<string, string>) {
  return NextResponse.json(
    {
      error: {
        message,
        type,
        param: null,
        code: status === 429 ? 'rate_limit_exceeded' : (status === 401 ? 'invalid_api_key' : (status === 403 ? 'tier_access_denied' : null)),
      },
    },
    {
      status,
      headers: {
        ...CORS_HEADERS,
        ...(extraHeaders || {}),
      },
    }
  );
}

export type AuthenticateAiResult =
  | { auth: AiAuthContext; errorResponse: null }
  | { auth: null; errorResponse: NextResponse };

/**
 * Authenticates request via API key (fl_...) or session token
 */
export async function authenticateAiRequest(req: NextRequest): Promise<AuthenticateAiResult> {
  const authHeader = req.headers.get('authorization') || '';

  if (!authHeader) {
    return {
      auth: null,
      errorResponse: aiError('Missing Authorization header. Provide a valid Bearer API key.', 'authentication_error', 401),
    };
  }

  const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!rawToken) {
    return {
      auth: null,
      errorResponse: aiError('Empty bearer token. Provide a valid Bearer API key.', 'authentication_error', 401),
    };
  }

  // 1. API Key Auth (fl_...)
  if (rawToken.startsWith('fl_')) {
    const keyData = await validateApiKey(rawToken);
    if (!keyData) {
      return {
        auth: null,
        errorResponse: aiError('Invalid API key provided.', 'authentication_error', 401),
      };
    }

    const tier = await getUserPlan(keyData.userId);
    return {
      auth: {
        userId: keyData.userId,
        projectId: keyData.projectId,
        tier,
        scopes: keyData.scopes || ['read', 'write', 'ai'],
        isApiKey: true,
      },
      errorResponse: null,
    };
  }

  // 2. Cookie / Session Token Fallback
  try {
    const sessionAuth = await getAuthContextFromRequest(req);
    if (sessionAuth?.userId) {
      const tier = await getUserPlan(sessionAuth.userId);
      return {
        auth: {
          userId: sessionAuth.userId,
          projectId: sessionAuth.allowedProjectId,
          tier,
          scopes: ['*'],
          isApiKey: false,
        },
        errorResponse: null,
      };
    }
  } catch {}

  return {
    auth: null,
    errorResponse: aiError('Invalid or expired credentials.', 'authentication_error', 401),
  };
}

/**
 * Verifies if user tier meets the minimum required tier for a model
 */
export function checkTierAccess(tier: string, model: FluxModelSpec): { allowed: boolean; errorResponse: NextResponse | null } {
  const userTier = (tier || 'free').toLowerCase().trim();
  
  // Unlimited tiers bypass all model restrictions (unlimited access to all models)
  if (isUnlimitedTier(userTier)) {
    return { allowed: true, errorResponse: null };
  }

  const minTier = model.minTier.toLowerCase();

  // Tier Hierarchy Rank
  const TIER_RANKS: Record<string, number> = {
    'free': 0,
    'pro': 1,
    'max': 2,
    'employee': 3,
    'emp': 3,
    'pay_as_you_go': 3,
    'payg': 3,
    'pay-as-you-go': 3,
    'org_owner': 4,
    'org': 4,
    'owner': 4,
  };

  const userRank = TIER_RANKS[userTier] ?? 0;
  const reqRank = TIER_RANKS[minTier] ?? 0;

  if (userRank < reqRank) {
    return {
      allowed: false,
      errorResponse: aiError(
        `Model '${model.id}' requires the ${model.minTier.toUpperCase()} tier or higher. Your current tier is ${userTier.toUpperCase()}. Please upgrade your plan to access this model.`,
        'permission_error',
        403
      ),
    };
  }

  return { allowed: true, errorResponse: null };
}
