import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { createSessionCookie, createSessionToken, createRefreshToken, getSessionCookieDomain } from '@/lib/auth';
import { sendWelcomeEmail } from '@/lib/email';
import { getOAuthConfig, getBaseOrigin, decodeOAuthState, isAllowedOrigin } from '@/lib/oauth-config';
import crypto from 'crypto';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    
    const { origin: targetOrigin, returnTo } = decodeOAuthState(stateParam);
    const currentOrigin = getBaseOrigin(request);
    const destinationOrigin = targetOrigin && isAllowedOrigin(targetOrigin) ? targetOrigin : currentOrigin;
    const redirectPath = returnTo || '/dashboard/projects';

    // Use dynamic configuration
    const { clientId, clientSecret, redirectUri } = getOAuthConfig(request, 'google');

    if (!code || !clientId || !clientSecret) {
        logger.error("Missing Google Code or Environment Variables for this platform");
        return NextResponse.redirect(new URL('/?error=GoogleServerAuthFailed', destinationOrigin));
    }

    try {
        // 1. Exchange code for access token
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            })
        });
        
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        
        if (!accessToken) {
            logger.error("Google OAuth token exchange failed:", tokenData);
            return NextResponse.redirect(new URL('/?error=GoogleTokenFailed', destinationOrigin));
        }

        // 2. Fetch User Profile
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        
        const userData = await userResponse.json();
        const email = userData.email;
        
        if (!email) {
            return NextResponse.redirect(new URL('/?error=GoogleEmailMissing', destinationOrigin));
        }

        const name = userData.name || "Google User";
        const photoUrl = userData.picture || null;

        const pool = getPgPool();

        // 3. Check if user exists
        const existing = await pool.query('SELECT id FROM fluxbase_global.users WHERE email = $1', [email]);
        let userId = '';
        let isNewUser = false;

        if (existing.rows.length > 0) {
            userId = existing.rows[0].id;
            if (photoUrl) {
                await pool.query('UPDATE fluxbase_global.users SET photo_url = $1 WHERE id = $2', [photoUrl, userId]);
            }
        } else {
            isNewUser = true;
            userId = crypto.randomUUID();
            await pool.query(
                `INSERT INTO fluxbase_global.users (id, email, display_name, photo_url) 
                 VALUES ($1, $2, $3, $4)`,
                [userId, email, name, photoUrl]
            );

            // Send Welcome Email natively
            sendWelcomeEmail(email, name).catch((e) => { logger.error(e); });
        }

        // 4. Check for 2FA requirement (Security Hardening)
        const { rows: userSettings } = await pool.query(
            'SELECT two_factor_enabled FROM fluxbase_global.users WHERE id = $1',
            [userId]
        );

        if (userSettings[0]?.two_factor_enabled) {
            // Redirect back to destination home with 2FA flags so the LoginDialog can catch it
            const loginUrl = new URL('/', destinationOrigin);
            loginUrl.searchParams.set('requires2FA', 'true');
            loginUrl.searchParams.set('userId', userId);
            return NextResponse.redirect(loginUrl);
        }

        // 5. Cross-domain session bridge check
        if (destinationOrigin !== currentOrigin) {
            const magicToken = crypto.randomBytes(32).toString('hex');
            const otpCode = crypto.randomInt(100000, 999999).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            await pool.query(`
                CREATE TABLE IF NOT EXISTS fluxbase_global.magic_logins (
                    email VARCHAR(255) PRIMARY KEY,
                    otp_code VARCHAR(10) NOT NULL,
                    magic_token VARCHAR(255) NOT NULL,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);

            await pool.query(`
                INSERT INTO fluxbase_global.magic_logins (email, otp_code, magic_token, expires_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (email) DO UPDATE SET
                    otp_code = EXCLUDED.otp_code,
                    magic_token = EXCLUDED.magic_token,
                    expires_at = EXCLUDED.expires_at
            `, [email, otpCode, magicToken, expiresAt]);

            const bridgeUrl = new URL('/api/auth/magic-login', destinationOrigin);
            bridgeUrl.searchParams.set('token', magicToken);
            bridgeUrl.searchParams.set('email', email);
            if (redirectPath && redirectPath !== '/dashboard/projects') {
                bridgeUrl.searchParams.set('returnTo', redirectPath);
            }
            return NextResponse.redirect(bridgeUrl);
        }

        // 6. Same domain flow: create active session cookie identically to native login systems
        await createSessionCookie(userId, true);
        const sessionToken = await createSessionToken(userId, true);
        const refreshToken = await createRefreshToken(userId);
        const isProd = process.env.NODE_ENV === 'production';
        const domain = getSessionCookieDomain(currentOrigin);

        // Redirect seamlessly to projects dashboard
        const response = NextResponse.redirect(new URL(redirectPath, currentOrigin));
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

    } catch (error) {
        logger.error("Google Auth Exception:", error);
        return NextResponse.redirect(new URL('/?error=GoogleServerException', destinationOrigin));
    }
}

