import { describe, it, expect, vi } from 'vitest';
import {
  isUnlimitedTier,
  estimateTokens,
  checkAiRateLimit,
  TIER_LIMITS,
} from '../rate-limiter';

describe('Flux AI Gateway - Rate Limiter', () => {
  it('should identify unlimited tiers correctly', () => {
    expect(isUnlimitedTier('employee')).toBe(true);
    expect(isUnlimitedTier('EMPLOYEE')).toBe(true);
    expect(isUnlimitedTier('emp')).toBe(true);
    expect(isUnlimitedTier('org_owner')).toBe(true);
    expect(isUnlimitedTier('org')).toBe(true);
    expect(isUnlimitedTier('owner')).toBe(true);
    expect(isUnlimitedTier('pay_as_you_go')).toBe(true);
    expect(isUnlimitedTier('payg')).toBe(true);
    expect(isUnlimitedTier('pay-as-you-go')).toBe(true);

    expect(isUnlimitedTier('free')).toBe(false);
    expect(isUnlimitedTier('pro')).toBe(false);
    expect(isUnlimitedTier('max')).toBe(false);
  });

  it('should bypass throttles and return unlimited headers for employee, org_owner, and PAYG', async () => {
    const resOrg = await checkAiRateLimit('user_org', 'org_owner', 'text', 500);
    expect(resOrg.allowed).toBe(true);
    expect(resOrg.rpmRemaining).toBe(999999);
    expect(resOrg.headers['X-RateLimit-Limit-Requests']).toBe('unlimited');

    const resEmp = await checkAiRateLimit('user_emp', 'employee', 'image', 1000);
    expect(resEmp.allowed).toBe(true);
    expect(resEmp.rpmRemaining).toBe(999999);
    expect(resEmp.headers['X-RateLimit-Limit-Requests']).toBe('unlimited');

    const resPayg = await checkAiRateLimit('user_payg', 'pay_as_you_go', 'video', 5000);
    expect(resPayg.allowed).toBe(true);
    expect(resPayg.rpmRemaining).toBe(999999);
    expect(resPayg.headers['X-RateLimit-Limit-Requests']).toBe('unlimited');
  });

  it('should block video generation on free tier', async () => {
    const resFreeVideo = await checkAiRateLimit('user_free', 'free', 'video', 5000);
    expect(resFreeVideo.allowed).toBe(false);
    expect(resFreeVideo.reason).toContain('not available on the FREE tier');
    expect(resFreeVideo.headers['Retry-After']).toBe('86400');
  });

  it('should estimate token count correctly', () => {
    expect(estimateTokens('Hello world')).toBeGreaterThanOrEqual(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens(null, 'image')).toBe(1000);
    expect(estimateTokens(null, 'video')).toBe(5000);
    expect(estimateTokens(null, 'audio-stt')).toBe(500);
  });
});
