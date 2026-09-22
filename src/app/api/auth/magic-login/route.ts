import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { createSessionCookie, createSessionToken, createRefreshToken } from '@/lib/auth';
import { getSessionCookieDomain } from '@/lib/cookie-domain';
import { getBaseOrigin, sanitizeRedirectPath } from '@/lib/oauth-config';
import crypto from 'crypto';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const email = searchParams.get('email');
    const rawReturnTo = searchParams.get('returnTo');
    const returnTo = sanitizeRedirectPath(rawReturnTo, '/dashboard/projects');
    const baseUrl = getBaseOrigin(req) || req.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://www.fluxbasedb.me';

    if (!token || !email) {
        return NextResponse.redirect(new URL('/?error=missing_token', baseUrl));
    }

    try {
        const pool = getPgPool();

        // 1. Ensure table exists with TIMESTAMPTZ
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.magic_logins (
                email VARCHAR(255) PRIMARY KEY,
                otp_code VARCHAR(10) NOT NULL,
                magic_token VARCHAR(255) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // 2. Look up magic token
        const result = await pool.query(
            'SELECT otp_code, magic_token, expires_at FROM fluxbase_global.magic_logins WHERE email = $1 AND magic_token = $2',
            [email, token]
        );

        if (result.rows.length === 0) {
            return NextResponse.redirect(new URL('/?error=invalid_or_consumed_token', baseUrl));
        }

        const record = result.rows[0];
        const rawExpiresAt = record.expires_at;
        const expiresAt = rawExpiresAt instanceof Date 
            ? rawExpiresAt.getTime() 
            : new Date(typeof rawExpiresAt === 'string' && !rawExpiresAt.endsWith('Z') ? rawExpiresAt + 'Z' : rawExpiresAt).getTime();

        // Allow 60-second grace window to absorb system clock drift between servers
        if (Date.now() > expiresAt + 60 * 1000) {
            await pool.query('DELETE FROM fluxbase_global.magic_logins WHERE email = $1', [email]);
            return NextResponse.redirect(new URL('/?error=expired_token', baseUrl));
        }

        // 3. Clear consumed token (single-use)
        await pool.query('DELETE FROM fluxbase_global.magic_logins WHERE email = $1', [email]);

        // 4. Find or create user
        let userResult = await pool.query(
            'SELECT id, display_name, two_factor_enabled FROM fluxbase_global.users WHERE email = $1',
            [email]
        );

        let user;
        if (userResult.rows.length === 0) {
            const userId = crypto.randomUUID();
            const displayName = email.split('@')[0];
            await pool.query(
                'INSERT INTO fluxbase_global.users (id, email, display_name) VALUES ($1::text, $2, $3)',
                [userId, email, displayName]
            );
            user = { id: userId, display_name: displayName, two_factor_enabled: false };
        } else {
            user = userResult.rows[0];
        }

        // 5. Check 2FA
        if (user.two_factor_enabled) {
            const twoFaUrl = new URL('/', baseUrl);
            twoFaUrl.searchParams.set('requires2FA', 'true');
            twoFaUrl.searchParams.set('userId', user.id);
            return NextResponse.redirect(twoFaUrl);
        }

        // 6. Create session cookie and redirect to dashboard
        await createSessionCookie(user.id, true);
        const sessionToken = await createSessionToken(user.id, true);
        const refreshToken = await createRefreshToken(user.id);
        const isProd = process.env.NODE_ENV === 'production';
        const domain = getSessionCookieDomain(baseUrl);
        const targetPath = returnTo.startsWith('/') ? returnTo : '/dashboard/projects';
        const response = NextResponse.redirect(new URL(targetPath, baseUrl));

        response.cookies.set('session', sessionToken, {
            expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            maxAge: 7 * 24 * 60 * 60,
            httpOnly: true,
            secure: isProd,
            path: '/',
            domain,
            sameSite: 'lax',
        });

        response.cookies.set('refresh_token', refreshToken, {
            httpOnly: true,
            secure: isProd,
            path: '/',
            domain,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60,
        });
        return response;
    } catch (error: any) {
        logger.error("Magic Login Error:", error);
        return NextResponse.redirect(new URL('/?error=authentication_failed', baseUrl));
    }
}

