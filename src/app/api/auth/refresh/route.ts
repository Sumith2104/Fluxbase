import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSessionCookie, verifyAndRotateRefreshToken } from '@/lib/auth';
import { getSessionCookieDomain } from '@/lib/cookie-domain';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/refresh
 *
 * Exchanges a valid refresh token (from httpOnly cookie) for a fresh access token.
 * Automatically rotates the refresh token (one-time use).
 *
 * Response: 200 with new access/refresh cookies set, or 401 if invalid.
 */
export async function POST(req: NextRequest) {
    try {
        const refreshToken = (await cookies()).get('refresh_token')?.value;
        if (!refreshToken) {
            return NextResponse.json(
                { success: false, error: { message: 'No refresh token provided.', code: 'UNAUTHORIZED' } },
                { status: 401 }
            );
        }

        const result = await verifyAndRotateRefreshToken(refreshToken);
        if (!result) {
            // Clear the invalid refresh token cookie
            const response = NextResponse.json(
                { success: false, error: { message: 'Refresh token is invalid or expired. Please sign in again.', code: 'UNAUTHORIZED' } },
                { status: 401 }
            );
            const domain = getSessionCookieDomain(req.headers.get('host'));
            response.cookies.delete('refresh_token');
            response.cookies.delete('session');
            if (domain) {
                try {
                    response.cookies.set('refresh_token', '', { path: '/', domain, maxAge: 0 });
                    response.cookies.set('session', '', { path: '/', domain, maxAge: 0 });
                } catch {}
            }
            return response;
        }

        // Issue new access token with verified session
        await createSessionCookie(result.uid, true);

        // Set new refresh token cookie
        const isProduction = process.env.NODE_ENV === 'production';
        const domain = getSessionCookieDomain(req.headers.get('host'));
        const response = NextResponse.json({ success: true, message: 'Token refreshed' });
        response.cookies.set('refresh_token', result.newToken, {
            httpOnly: true,
            secure: isProduction,
            path: '/',
            domain,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return response;
    } catch (error: any) {
        logger.error('[Auth Refresh Error]', error);
        return NextResponse.json(
            { success: false, error: { message: 'Internal server error.', code: 'INTERNAL_ERROR' } },
            { status: 500 }
        );
    }
}
