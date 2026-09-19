'use server';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { validateApiKey } from '@/lib/api-keys';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { logToFluxDB } from '@/lib/fluxdb-logger';
import logger from '@/lib/logger';
import { getSessionCookieDomain } from '@/lib/cookie-domain';

function getJwtSecret(): Uint8Array {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.trim() === '') {
        throw new Error('JWT_SECRET environment variable is required. Set it in .env.local.');
    }
    return new TextEncoder().encode(secret);
}

// Access token TTL: 7 days (persistent session)
const ACCESS_TOKEN_TTL = 7 * 24 * 60 * 60; // seconds
// Refresh token TTL: 30 days
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // seconds

// Cache user suspension status for 30s — avoids a DB query on every API request.
// If a user is suspended it takes at most 30s to take effect, which is acceptable.
const _userStatusCache = new LRUCache<string, string>({ max: 1000, ttl: 30_000 });

// Cache the full AuthContext for cookie-based sessions for 30s.
// Keyed on a SHA-256 hash of the JWT so we never store the raw token in memory.
// AuthContext is declared below in this same file — TS hoists interface declarations.

const _authContextCache = new LRUCache<string, AuthContext>({ max: 1000, ttl: 30_000 });

export interface User {
    id: string;
    email: string;
    display_name?: string;
    password?: string;
    user_role?: 'student' | 'employee' | 'org_owner' | string;
    plan_type?: string;
    created_at: string;
}

/**
 * Retrieves the current user's core auth state from the JWT session cookie.
 */
export async function getCurrentUserId(): Promise<string | null> {
    const context = await getSessionContext();
    return context?.uid || null;
}

export async function getSessionContext(): Promise<{ uid: string; mfa?: boolean } | null> {
    const sessionCookie = (await cookies()).get('session')?.value;
    if (!sessionCookie) return null;

    try {
        const { payload } = await jwtVerify(sessionCookie, getJwtSecret());
        return { uid: payload.uid as string, mfa: payload.mfa as boolean | undefined };
    } catch (error) {
        logger.error("Failed to verify session cookie:", error);
        return null;
    }
}

/**
 * Generates a signed JWT session token for a given user ID.
 */
export async function createSessionToken(uid: string, isMfaVerified: boolean = true): Promise<string> {
    return await new SignJWT({ uid, mfa: isMfaVerified })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
        .sign(getJwtSecret());
}


/**
 * Creates a JWT session cookie from a raw user ID.
 * @param uid The user ID
 * @param isMfaVerified Whether 2FA has been completed for this session
 */
export async function createSessionCookie(uid: string, isMfaVerified: boolean = true) {
    try {
        const sessionCookie = await createSessionToken(uid, isMfaVerified);

        const isProduction = process.env.NODE_ENV === 'production';
        let reqHost: string | null = null;
        try {
            const { headers } = await import('next/headers');
            const h = await headers();
            reqHost = h.get('x-forwarded-host') || h.get('host');
        } catch {}

        const domain = getSessionCookieDomain(reqHost);

        (await cookies()).set('session', sessionCookie, {
            expires: new Date(Date.now() + ACCESS_TOKEN_TTL * 1000),
            maxAge: ACCESS_TOKEN_TTL,
            httpOnly: true,
            secure: isProduction,
            path: '/',
            domain,
            sameSite: 'lax',
        });

    } catch (error) {
        logger.error("Failed to create session cookie:", error);
        throw new Error("Authentication failed");
    }
}

/**
 * Creates a refresh token for a user. Stores a hashed version in the database.
 * Returns the raw token (to be sent to the client in an httpOnly cookie).
 */
export async function createRefreshToken(uid: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    try {
        const { getPgPool } = await import('@/lib/pg');
        await getPgPool().query(
            `INSERT INTO fluxbase_global.refresh_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '7 days')
             ON CONFLICT (user_id) DO UPDATE SET
               token_hash = EXCLUDED.token_hash,
               expires_at = EXCLUDED.expires_at`,
            [uid, hashedToken]
        );
    } catch (e) {
        logger.error('[Auth] Failed to store refresh token:', e);
        // If table doesn't exist yet, log but don't fail — this is a soft dependency
    }

    return rawToken;
}

/**
 * Verifies a refresh token against the stored hash.
 * On success: returns userId and rotates the token (one-time use).
 * On failure: returns null.
 */
export async function verifyAndRotateRefreshToken(rawToken: string): Promise<{ uid: string; newToken: string } | null> {
    if (!rawToken || rawToken.length < 16) return null;

    const hashedInput = crypto.createHash('sha256').update(rawToken).digest('hex');

    try {
        const { getPgPool } = await import('@/lib/pg');
        const result = await getPgPool().query(
            `SELECT user_id FROM fluxbase_global.refresh_tokens
             WHERE token_hash = $1 AND expires_at > NOW()
             FOR UPDATE`,
            [hashedInput]
        );

        if (!result.rows.length) return null;

        const uid = result.rows[0].user_id;

        // Rotate: delete old token, issue new one
        await getPgPool().query(
            `DELETE FROM fluxbase_global.refresh_tokens WHERE token_hash = $1`,
            [hashedInput]
        );

        const newRawToken = crypto.randomBytes(32).toString('hex');
        const newHashedToken = crypto.createHash('sha256').update(newRawToken).digest('hex');

        await getPgPool().query(
            `INSERT INTO fluxbase_global.refresh_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
            [uid, newHashedToken]
        );

        return { uid, newToken: newRawToken };
    } catch (e) {
        logger.error('[Auth] Refresh token verification failed:', e);
        return null;
    }
}

/**
 * Invalidates all refresh tokens for a user (e.g., on password change or suspicious activity).
 */
export async function revokeAllRefreshTokens(uid: string): Promise<void> {
    try {
        const { getPgPool } = await import('@/lib/pg');
        await getPgPool().query(
            `DELETE FROM fluxbase_global.refresh_tokens WHERE user_id = $1`,
            [uid]
        );
    } catch (e) {
        logger.error('[Auth] Failed to revoke refresh tokens:', e);
    }
}

/**
 * Logs out the user by clearing the session cookie.
 */
export async function logout() {
    const sessionCookie = (await cookies()).get('session')?.value;
    if (sessionCookie) {
        try {
            const { payload } = await jwtVerify(sessionCookie, getJwtSecret());
            const uid = payload.uid as string;
            // Revoke all refresh tokens for this user
            await revokeAllRefreshTokens(uid);
            // Clear auth caches
            await invalidateAuthCache(uid);
        } catch {
            // Token may be expired — that's fine, just clear cookies
        }
    }
    let reqHost: string | null = null;
    try {
        const { headers } = await import('next/headers');
        const h = await headers();
        reqHost = h.get('x-forwarded-host') || h.get('host');
    } catch {}
    const domain = getSessionCookieDomain(reqHost);
    (await cookies()).delete('session');
    (await cookies()).delete('refresh_token');
    if (domain) {
        try {
            (await cookies()).set('session', '', { path: '/', domain, maxAge: 0 });
            (await cookies()).set('refresh_token', '', { path: '/', domain, maxAge: 0 });
        } catch {}
    }
}

/**
 * Retrieves the user ID from the request, checking both session cookies and API keys.
 * enhancing security for API routes.
 */

export async function getUserIdFromRequest(request: Request): Promise<string | null> {
    const context = await getAuthContextFromRequest(request);
    return context?.userId || null;
}

export interface AuthContext {
    userId: string;
    email: string;
    allowedProjectId?: string; // If present, the user is restricted to this project
    scopes?: string[]; // If present (API access), these define permitted actions
    status?: string; // Organization status
}

export async function getAuthContextFromRequest(request: Request): Promise<AuthContext | null> {
    // Cached helper — avoids 1 DB query per request just to check suspension status.
    const fetchUserStatus = async (uid: string): Promise<{ status: string; email: string }> => {
        const cached = _userStatusCache.get(uid);
        if (cached !== undefined) {
             const [status, email] = cached.split(':');
             return { status, email };
        }
        try {
            const { redis } = await import('@/lib/redis');
            const redisKey = `user_status:${uid}`;
            const redisCached = await redis.get<string>(redisKey);
            if (redisCached) {
                const [status, email] = redisCached.split(':');
                _userStatusCache.set(uid, redisCached);
                return { status, email };
            }

            const { getPgPool } = await import('@/lib/pg');
            const pool = getPgPool();
            const res = await pool.query('SELECT status, email FROM fluxbase_global.users WHERE id = $1', [uid]);
            const status = res.rows[0]?.status || 'active';
            const email = res.rows[0]?.email || '';
            const valStr = `${status}:${email}`;
            
            _userStatusCache.set(uid, valStr);
            await redis.set(redisKey, valStr, { ex: 300 }); // Cache in Redis for 5 minutes
            return { status, email };
        } catch {
            return { status: 'active', email: '' };
        }
    };

    // 1. Check Session Cookie (Browser Access)
    const userId = await getCurrentUserId();
    if (userId) {
        // Cache the full context keyed on userId for cookie sessions.
        // This eliminates the fetchUserStatus DB hit on every API request.
        const cached = _authContextCache.get(`cookie:${userId}`);
        if (cached !== undefined) return cached;

        const { status, email } = await fetchUserStatus(userId);
        const ctx: AuthContext = { userId, email, status };
        _authContextCache.set(`cookie:${userId}`, ctx);
        return ctx;
    }

    // 2. Check Authorization Header OR URL Search Params (API Access)
    let apiKey = '';
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.split('Bearer ')[1].trim();
    } else {
        // Fallback for EventSource which cannot send headers cross-origin
        try {
            const url = new URL(request.url);
            apiKey = url.searchParams.get('apiKey') || '';
        } catch {}
    }

    const headerProjectId = request.headers.get('x-project-id');

    if (apiKey) {
        // Cache API key auth context keyed on hash of key (never raw key in memory).
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
        const cacheKey = `apikey:${keyHash}`;
        const cached = _authContextCache.get(cacheKey);
        if (cached !== undefined) return cached;

        const result = await validateApiKey(apiKey);
        if (result) {
            const isNoisyRoute = request.url.includes('/api/realtime/subscribe');
            if (result.projectId && !isNoisyRoute) {
                const { trackSession } = await import('@/lib/track-session');
                await trackSession(result.projectId, result.userId);
            }

            const { status, email } = await fetchUserStatus(result.userId);
            const ctx: AuthContext = {
                userId: result.userId,
                email,
                allowedProjectId: result.projectId || headerProjectId || undefined,
                scopes: result.scopes,
                status
            };
            _authContextCache.set(cacheKey, ctx);

            // Live log to FluxDB desktop (no-op if FLUXDB_WEBHOOK_URL not set)
            if (!isNoisyRoute) {
                const routePath = (() => { try { return new URL(request.url).pathname; } catch { return '?'; } })();
                logToFluxDB({
                    level: 'INFO',
                    component: 'API',
                    message: `${request.method} ${routePath}`,
                    user_id: result.userId,
                    email,
                    project_id: result.projectId || undefined,
                    scopes: result.scopes?.join(','),
                    status,
                });
            }

            return ctx;
        }
    }

    return null;
}

/**
 * Invalidates the authentication cache for a specific user.
 * Essential for immediate suspension enforcement.
 */
export async function invalidateAuthCache(userId: string) {
    _userStatusCache.delete(userId);
    _authContextCache.delete(`cookie:${userId}`);
    
    try {
        const { redis } = await import('@/lib/redis');
        await redis.del(`user_status:${userId}`);
    } catch (e) {
        logger.warn('[Redis Error] invalidateAuthCache Redis delete failed:', e);
    }

    try {
        const { invalidateUserCache } = await import('@/lib/auth-actions');
        await invalidateUserCache(userId);
    } catch {}

    try {
        const { invalidateBillingCache } = await import('@/app/(app)/settings/billing-actions');
        await invalidateBillingCache(userId);
    } catch {}

    try {
        const { invalidateUserProjectsCache } = await import('@/lib/data');
        await invalidateUserProjectsCache(userId);
    } catch {}
    
    if (_authContextCache.size === 0) return;

    // For API keys, we clear all entries belonging to this user.
    for (const key of _authContextCache.keys()) {
        const val = _authContextCache.get(key);
        if (val?.userId === userId) {
            _authContextCache.delete(key);
        }
    }
}
