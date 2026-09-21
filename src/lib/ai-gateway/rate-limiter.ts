import { redis } from '@/lib/redis';
import logger from '@/lib/logger';
import type { Modality, PlanTier } from './config';

export interface RateLimitResult {
  allowed: boolean;
  rpmRemaining: number;
  tpmRemaining: number;
  dailyRemaining: number;
  resetSeconds: number;
  headers: Record<string, string>;
  reason?: string;
}

export interface ModalityLimits {
  rpm: number;
  tpm: number;
  daily: number;
}

/**
 * Dual-dimension Rate Limits Matrix by Tier & Modality
 * - employee, org_owner, pay_as_you_go are UNLIMITED across everything
 * - free, pro, max are enforceably bounded
 */
export const TIER_LIMITS: Record<string, Record<Modality, ModalityLimits>> = {
  free: {
    'text': { rpm: 10, tpm: 10000, daily: 500 },
    'image': { rpm: 2, tpm: 20000, daily: 5 },
    'audio-stt': { rpm: 3, tpm: 30000, daily: 20 },
    'audio-tts': { rpm: 3, tpm: 30000, daily: 20 },
    'video': { rpm: 0, tpm: 0, daily: 0 }, // Free tier blocked from video
    'embedding': { rpm: 20, tpm: 50000, daily: 500 },
  },
  pro: {
    'text': { rpm: 60, tpm: 100000, daily: 10000 },
    'image': { rpm: 10, tpm: 100000, daily: 50 },
    'audio-stt': { rpm: 15, tpm: 150000, daily: 200 },
    'audio-tts': { rpm: 15, tpm: 150000, daily: 200 },
    'video': { rpm: 2, tpm: 50000, daily: 5 },
    'embedding': { rpm: 100, tpm: 200000, daily: 5000 },
  },
  max: {
    'text': { rpm: 300, tpm: 500000, daily: 50000 },
    'image': { rpm: 30, tpm: 300000, daily: 200 },
    'audio-stt': { rpm: 50, tpm: 500000, daily: 1000 },
    'audio-tts': { rpm: 50, tpm: 500000, daily: 1000 },
    'video': { rpm: 5, tpm: 100000, daily: 20 },
    'embedding': { rpm: 500, tpm: 1000000, daily: 25000 },
  },
  // Unlimited tiers
  employee: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  org_owner: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  pay_as_you_go: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  payg: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  emp: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  org: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  owner: {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
  'pay-as-you-go': {
    'text': { rpm: -1, tpm: -1, daily: -1 },
    'image': { rpm: -1, tpm: -1, daily: -1 },
    'audio-stt': { rpm: -1, tpm: -1, daily: -1 },
    'audio-tts': { rpm: -1, tpm: -1, daily: -1 },
    'video': { rpm: -1, tpm: -1, daily: -1 },
    'embedding': { rpm: -1, tpm: -1, daily: -1 },
  },
};

/**
 * Checks if a tier has unlimited quotas
 */
export function isUnlimitedTier(tier: string): boolean {
  const normalized = (tier || '').toLowerCase().trim();
  return (
    normalized === 'employee' ||
    normalized === 'emp' ||
    normalized === 'org_owner' ||
    normalized === 'org' ||
    normalized === 'owner' ||
    normalized === 'pay_as_you_go' ||
    normalized === 'payg' ||
    normalized === 'pay-as-you-go'
  );
}

/**
 * Heuristic token estimator for pre-flight checks
 */
export function estimateTokens(input: string | any, modality: Modality = 'text'): number {
  if (modality === 'image') return 1000;
  if (modality === 'audio-stt') return 500;
  if (modality === 'audio-tts') return 500;
  if (modality === 'video') return 5000;

  if (typeof input === 'string') {
    return Math.max(1, Math.ceil(input.length / 4));
  }

  if (Array.isArray(input)) {
    let totalChars = 0;
    for (const msg of input) {
      if (typeof msg?.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg?.content)) {
        for (const part of msg.content) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            totalChars += part.text.length;
          }
        }
      }
    }
    return Math.max(1, Math.ceil(totalChars / 4));
  }

  return 100;
}

/**
 * Atomic sliding-window rate limit checker using Redis
 */
export async function checkAiRateLimit(
  userId: string,
  tier: string,
  modality: Modality,
  estimatedTokens: number = 100
): Promise<RateLimitResult> {
  const cleanTier = (tier || 'free').toLowerCase().trim();

  // 1. UNLIMITED TIERS (Employee, Org Owner, Pay-As-You-Go)
  if (isUnlimitedTier(cleanTier)) {
    return {
      allowed: true,
      rpmRemaining: 999999,
      tpmRemaining: 999999999,
      dailyRemaining: 999999,
      resetSeconds: 0,
      headers: {
        'X-RateLimit-Limit-Requests': 'unlimited',
        'X-RateLimit-Limit-Tokens': 'unlimited',
        'X-RateLimit-Remaining-Requests': 'unlimited',
        'X-RateLimit-Remaining-Tokens': 'unlimited',
        'X-RateLimit-Reset-Requests': '0s',
        'X-RateLimit-Reset-Tokens': '0s',
      },
    };
  }

  // 2. Modality access gates (e.g. video blocked for free tier)
  const tierConfig = TIER_LIMITS[cleanTier] || TIER_LIMITS.free;
  const limits = tierConfig[modality] || { rpm: 10, tpm: 10000, daily: 100 };

  if (limits.rpm === 0) {
    return {
      allowed: false,
      rpmRemaining: 0,
      tpmRemaining: 0,
      dailyRemaining: 0,
      resetSeconds: 86400,
      reason: `${modality.toUpperCase()} generation is not available on the ${cleanTier.toUpperCase()} tier. Please upgrade to Pro or Max.`,
      headers: {
        'X-RateLimit-Limit-Requests': '0',
        'X-RateLimit-Remaining-Requests': '0',
        'Retry-After': '86400',
      },
    };
  }

  // 3. Redis keys for dual-dimension evaluation
  const now = new Date();
  const currentMinute = `${now.getUTCFullYear()}${now.getUTCMonth() + 1}${now.getUTCDate()}_${now.getUTCHours()}_${now.getUTCMinutes()}`;
  const currentDay = `${now.getUTCFullYear()}${now.getUTCMonth() + 1}${now.getUTCDate()}`;

  const rpmKey = `ai_rl:${userId}:${modality}:rpm:${currentMinute}`;
  const tpmKey = `ai_rl:${userId}:${modality}:tpm:${currentMinute}`;
  const dailyKey = `ai_rl:${userId}:${modality}:daily:${currentDay}`;

  try {
    // Atomic multi / pipeline check
    const pipe = (redis as any).pipeline();
    pipe.incr(rpmKey);
    pipe.expire(rpmKey, 65);
    pipe.incrby(tpmKey, estimatedTokens);
    pipe.expire(tpmKey, 65);
    pipe.incr(dailyKey);
    pipe.expire(dailyKey, 86400 + 3600);

    const results = await pipe.exec();
    const rpmCount = typeof results[0] === 'number' ? results[0] : (results[0]?.[1] || 1);
    const tpmCount = typeof results[2] === 'number' ? results[2] : (results[2]?.[1] || estimatedTokens);
    const dailyCount = typeof results[4] === 'number' ? results[4] : (results[4]?.[1] || 1);

    const rpmRemaining = Math.max(0, limits.rpm - rpmCount);
    const tpmRemaining = Math.max(0, limits.tpm - tpmCount);
    const dailyRemaining = limits.daily > 0 ? Math.max(0, limits.daily - dailyCount) : 999999;

    const rpmOk = rpmCount <= limits.rpm;
    const tpmOk = tpmCount <= limits.tpm;
    const dailyOk = limits.daily <= 0 || dailyCount <= limits.daily;

    const allowed = rpmOk && tpmOk && dailyOk;
    const resetSeconds = 60 - now.getUTCSeconds();

    let reason: string | undefined;
    if (!rpmOk) reason = `Requests per minute limit exceeded (${limits.rpm} RPM). Please retry in ${resetSeconds}s.`;
    else if (!tpmOk) reason = `Tokens per minute limit exceeded (${limits.tpm} TPM). Please retry in ${resetSeconds}s.`;
    else if (!dailyOk) reason = `Daily generation quota exceeded (${limits.daily} per day). Resets at midnight UTC.`;

    const headers: Record<string, string> = {
      'X-RateLimit-Limit-Requests': String(limits.rpm),
      'X-RateLimit-Limit-Tokens': String(limits.tpm),
      'X-RateLimit-Remaining-Requests': String(rpmRemaining),
      'X-RateLimit-Remaining-Tokens': String(tpmRemaining),
      'X-RateLimit-Reset-Requests': `${resetSeconds}s`,
      'X-RateLimit-Reset-Tokens': `${resetSeconds}s`,
    };

    if (!allowed) {
      headers['Retry-After'] = String(resetSeconds);
    }

    return {
      allowed,
      rpmRemaining,
      tpmRemaining,
      dailyRemaining,
      resetSeconds,
      headers,
      reason,
    };
  } catch (err: any) {
    logger.warn('[RateLimiter] Redis rate-limit evaluation warning (failing open):', err?.message || err);
    // Fail-open for transient Redis blips so paying API traffic is never dropped
    return {
      allowed: true,
      rpmRemaining: limits.rpm,
      tpmRemaining: limits.tpm,
      dailyRemaining: limits.daily,
      resetSeconds: 60,
      headers: {
        'X-RateLimit-Limit-Requests': String(limits.rpm),
        'X-RateLimit-Limit-Tokens': String(limits.tpm),
        'X-RateLimit-Remaining-Requests': String(limits.rpm),
        'X-RateLimit-Remaining-Tokens': String(limits.tpm),
      },
    };
  }
}
