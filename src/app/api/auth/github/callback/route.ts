import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { createSessionCookie, createSessionToken, createRefreshToken, getCurrentUserId, getSessionCookieDomain } from '@/lib/auth';
import { sendWelcomeEmail } from '@/lib/email';
import { getOAuthConfig, getBaseOrigin, decodeOAuthState, isAllowedOrigin } from '@/lib/oauth-config';
import { storeGitHubToken } from '@/lib/github-token';
import crypto from 'crypto';
import { logToFluxDB } from '@/lib/fluxdb-logger';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');

    const decoded = decodeOAuthState(stateParam);
    const { origin: targetOrigin, returnTo, isImport, userId: stateUserId } = decoded;
    const currentOrigin = getBaseOrigin(request);
    const destinationOrigin = targetOrigin && isAllowedOrigin(targetOrigin) ? targetOrigin : currentOrigin;
    const redirectPath = returnTo || '/dashboard/projects';

    // Use dynamic configuration
    const { clientId, clientSecret, redirectUri } = getOAuthConfig(request, 'github');

    if (!code || !clientId || !clientSecret) {
        logger.error("Missing GitHub Code or Environment Variables for this platform");
        const failDest = isImport ? redirectPath : '/';
        const errParam = isImport ? 'GithubImportFailed' : 'GithubAuthFailed';
        return NextResponse.redirect(new URL(`${failDest}?error=${errParam}`, destinationOrigin));
    }

    try {
        // 1. Exchange code for access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }),
        });
        
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        
        if (!accessToken) {
            logger.error("GitHub OAuth Error:", tokenData);
            const failDest = isImport ? redirectPath : '/';
            const errParam = isImport ? 'GithubTokenExchangeFailed' : 'GithubTokenFailed';
            return NextResponse.redirect(new URL(`${failDest}?error=${errParam}`, destinationOrigin));
        }

        // --- SPECIAL BRANCH: GITHUB IMPORT FLOW ---
        if (isImport) {
            const activeId = await getCurrentUserId();
            const userId = activeId || stateUserId;
            if (!userId) {
                logger.error('[GitHub Import Callback] No authenticated user found');
                return NextResponse.redirect(new URL('/?error=LoginRequired', destinationOrigin));
            }

            // If session cookie was missing after cross-origin OAuth redirect, restore session
            if (!activeId && stateUserId) {
                await createSessionCookie(stateUserId, true);
            }

            let githubUsername = '';
            try {
                const userRes = await fetch('https://api.github.com/user', {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/vnd.github.v3+json',
                        'User-Agent': 'Fluxbase-Cloud',
                    },
                });
                if (userRes.ok) {
                    const userData = await userRes.json();
                    githubUsername = userData.login || '';
                }
            } catch (uErr) {
                logger.warn('[GitHub Import Callback] Failed to fetch user profile:', uErr);
            }

            await storeGitHubToken(userId, accessToken, tokenData.scope || 'repo', githubUsername);
            logger.info(`[GitHub Import Callback] Successfully connected GitHub repo access for user ${userId} (@${githubUsername})`);

            const successUrl = new URL(redirectPath, destinationOrigin);
            successUrl.searchParams.set('github_connected', 'true');
            if (githubUsername) {
                successUrl.searchParams.set('github_username', githubUsername);
            }
            return NextResponse.redirect(successUrl);
        }
        // --- END GITHUB IMPORT FLOW ---

        // 2. Fetch User Profile
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        
        const userData = await userResponse.json();
        
        // 3. Fetch User Emails
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        
        const emailsData = await emailsResponse.json();
        const primaryEmailObj = Array.isArray(emailsData) ? emailsData.find(e => e.primary) || emailsData[0] : null;
        const email = userData.email || (primaryEmailObj ? primaryEmailObj.email : null);
        
        if (!email) {
            return NextResponse.redirect(new URL('/?error=GithubEmailMissing', destinationOrigin));
        }

        const name = userData.name || userData.login || "GitHub User";
        const photoUrl = userData.avatar_url || null;

        const pool = getPgPool();

        // 4. Check if user exists
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

            sendWelcomeEmail(email, name).catch((e) => { logger.error(e); });
        }

        // 5. Check for 2FA
        const { rows: userSettings } = await pool.query(
            'SELECT two_factor_enabled FROM fluxbase_global.users WHERE id = $1',
            [userId]
        );

        if (userSettings[0]?.two_factor_enabled) {
            const loginUrl = new URL('/', destinationOrigin);
            loginUrl.searchParams.set('requires2FA', 'true');
            loginUrl.searchParams.set('userId', userId);
            return NextResponse.redirect(loginUrl);
        }

        // Log to FluxDB desktop (no-op if FLUXDB_WEBHOOK_URL is not set)
        logToFluxDB({
            level: isNewUser ? 'INFO' : 'INFO',
            component: 'AUTH',
            message: isNewUser
                ? `New user signed up via GitHub: ${email}`
                : `User logged in via GitHub: ${email}`,
            user_id: userId,
            email,
            provider: 'github',
            event: isNewUser ? 'signup' : 'login',
        });

        // 6. Cross-domain session bridge check
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

        // 7. Same domain flow: create active session cookie directly
        await createSessionCookie(userId, true);
        const sessionToken = await createSessionToken(userId, true);
        const refreshToken = await createRefreshToken(userId);
        const isProd = process.env.NODE_ENV === 'production';
        const domain = getSessionCookieDomain(currentOrigin);

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
        logger.error("GitHub Auth Exception:", error);
        return NextResponse.redirect(new URL('/?error=GithubServerException', destinationOrigin));
    }
}

