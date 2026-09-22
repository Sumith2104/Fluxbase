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

  // 1. API Key Auth (fl_...)
  if (authHeader) {
    const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!rawToken) {
      return {
        auth: null,
        errorResponse: aiError('Empty bearer token. Provide a valid Bearer API key.', 'authentication_error', 401),
      };
    }

    if (rawToken.startsWith('fl_')) {
      const keyData = await validateApiKey(rawToken);
      if (!keyData) {
        return {
          auth: null,
          errorResponse: aiError('Invalid API key provided.', 'authentication_error', 401),
        };
      }

      const keyScopes = Array.isArray(keyData.scopes) ? keyData.scopes : [];
      // Strict Scope Enforcement: Key must have 'ai' or 'admin' scope (or wildcard '*')
      const hasAiScope = keyScopes.includes('ai') || keyScopes.includes('admin') || keyScopes.includes('*');
      if (!hasAiScope) {
        return {
          auth: null,
          errorResponse: aiError(
            "Access denied: This API key does not have the 'AI Gateway Access' (ai) scope. Please create or update an API key with the 'AI Gateway Access' permission in Project Settings > API Keys.",
            'permission_error',
            403
          ),
        };
      }

      const tier = await getUserPlan(keyData.userId);
      return {
        auth: {
          userId: keyData.userId,
          projectId: keyData.projectId,
          tier,
          scopes: keyScopes,
          isApiKey: true,
        },
        errorResponse: null,
      };
    }
  }

  // 2. Cookie / Session Token / Query Param API Key Fallback
  try {
    const sessionAuth = await getAuthContextFromRequest(req);
    if (sessionAuth?.userId) {
      // If request was authenticated via an API key in getAuthContextFromRequest
      if (sessionAuth.scopes && Array.isArray(sessionAuth.scopes)) {
        const hasAiScope = sessionAuth.scopes.includes('ai') || sessionAuth.scopes.includes('admin') || sessionAuth.scopes.includes('*');
        if (!hasAiScope) {
          return {
            auth: null,
            errorResponse: aiError(
              "Access denied: This API key does not have the 'AI Gateway Access' (ai) scope. Please create or update an API key with the 'AI Gateway Access' permission in Project Settings > API Keys.",
              'permission_error',
              403
            ),
          };
        }
      }

      const tier = await getUserPlan(sessionAuth.userId);
      return {
        auth: {
          userId: sessionAuth.userId,
          projectId: sessionAuth.allowedProjectId,
          tier,
          scopes: sessionAuth.scopes || ['*'],
          isApiKey: Boolean(sessionAuth.scopes),
        },
        errorResponse: null,
      };
    }
  } catch {}

  return {
    auth: null,
    errorResponse: aiError(
      authHeader ? 'Invalid or expired credentials.' : 'Missing Authorization header. Provide a valid Bearer API key.',
      'authentication_error',
      401
    ),
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
