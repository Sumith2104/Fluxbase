import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock validateApiKey
vi.mock('@/lib/api-keys', () => ({
  validateApiKey: vi.fn(),
}));

// Mock pg
vi.mock('@/lib/pg', () => ({
  getPgPool: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({ rows: [{ plan_type: 'free' }], rowCount: 1 }),
  }),
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [{ plan_type: 'free' }], rowCount: 1 }),
  },
}));

// Mock auth context
vi.mock('@/lib/auth', () => ({
  getAuthContextFromRequest: vi.fn().mockResolvedValue(null),
}));

import { authenticateAiRequest } from '@/lib/ai-gateway/auth-middleware';
import { validateApiKey } from '@/lib/api-keys';

describe('AI Gateway Authentication and Scope Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an API key that has only "read" scope with 403 Forbidden', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      userId: 'usr_123',
      projectId: 'proj_abc',
      scopes: ['read'],
    });

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        authorization: 'Bearer fl_test_read_key',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.auth).toBeNull();
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse.status).toBe(403);

    const body = await result.errorResponse.json();
    expect(body.error.message).toContain("Access denied: This API key does not have the 'AI Gateway Access' (ai) scope");
  });

  it('rejects an API key that has only "read" and "write" scopes with 403 Forbidden', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      userId: 'usr_123',
      projectId: 'proj_abc',
      scopes: ['read', 'write'],
    });

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        authorization: 'Bearer fl_test_read_write_key',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.auth).toBeNull();
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse.status).toBe(403);

    const body = await result.errorResponse.json();
    expect(body.error.message).toContain("Access denied: This API key does not have the 'AI Gateway Access' (ai) scope");
  });

  it('allows an API key with "ai" scope', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      userId: 'usr_123',
      projectId: 'proj_abc',
      scopes: ['ai'],
    });

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        authorization: 'Bearer fl_test_ai_key',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.errorResponse).toBeNull();
    expect(result.auth).not.toBeNull();
    expect(result.auth?.userId).toBe('usr_123');
    expect(result.auth?.scopes).toEqual(['ai']);
  });

  it('allows an API key with "admin" scope', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      userId: 'usr_admin',
      projectId: 'proj_abc',
      scopes: ['admin'],
    });

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        authorization: 'Bearer fl_test_admin_key',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.errorResponse).toBeNull();
    expect(result.auth).not.toBeNull();
    expect(result.auth?.userId).toBe('usr_admin');
    expect(result.auth?.scopes).toEqual(['admin']);
  });

  it('allows an API key with both "read" and "ai" scopes', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      userId: 'usr_combo',
      projectId: 'proj_abc',
      scopes: ['read', 'ai'],
    });

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        authorization: 'Bearer fl_test_combo_key',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.errorResponse).toBeNull();
    expect(result.auth).not.toBeNull();
    expect(result.auth?.userId).toBe('usr_combo');
    expect(result.auth?.scopes).toEqual(['read', 'ai']);
  });

  it('returns 401 when API key is invalid', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        authorization: 'Bearer fl_invalid_key',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.auth).toBeNull();
    expect(result.errorResponse?.status).toBe(401);
  });

  it('allows authenticated session cookie users with wildcard scope', async () => {
    const { getAuthContextFromRequest } = await import('@/lib/auth');
    vi.mocked(getAuthContextFromRequest).mockResolvedValueOnce({
      userId: 'usr_cookie_session',
      email: 'user@example.com',
      status: 'active',
    });

    // Request without Authorization header (browser session cookie)
    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: {
        cookie: 'session=jwt_session_token',
      },
    });

    const result = await authenticateAiRequest(req);
    expect(result.errorResponse).toBeNull();
    expect(result.auth).not.toBeNull();
    expect(result.auth?.userId).toBe('usr_cookie_session');
    expect(result.auth?.scopes).toEqual(['*']);
    expect(result.auth?.isApiKey).toBe(false);
  });

  it('rejects an API key authenticated via getAuthContextFromRequest lacking "ai" scope', async () => {
    const { getAuthContextFromRequest } = await import('@/lib/auth');
    vi.mocked(getAuthContextFromRequest).mockResolvedValueOnce({
      userId: 'usr_fallback',
      scopes: ['read', 'write'],
      status: 'active',
    });

    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions?apiKey=custom_key');

    const result = await authenticateAiRequest(req);
    expect(result.auth).toBeNull();
    expect(result.errorResponse).not.toBeNull();
    expect(result.errorResponse.status).toBe(403);
  });
});
