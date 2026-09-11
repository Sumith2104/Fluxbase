import { NextResponse, type NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { jwtVerify } from 'jose';


function getJwtSecretValue(): string {
    const secret = process.env.JWT_SECRET;
    if (secret) return secret;

    if (process.env.NODE_ENV === 'production') {
        throw new Error('Missing required JWT_SECRET environment variable');
    }
    return 'fluxbase_dev_secret_key_123';
}

// Only create ratelimiter if we have env vars, otherwise bypass locally to avoid breaking dev
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let ratelimit: Ratelimit | null = null;
if (redisUrl && redisToken) {
    ratelimit = new Ratelimit({
        redis: new Redis({ url: redisUrl, token: redisToken }),
        limiter: Ratelimit.slidingWindow(50, '10 s'), // 50 requests per 10s per IP globally
        analytics: false, // Disabled: analytics: true writes extra data to Upstash on every request
    });
}

export async function middleware(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('session')?.value;
    const { pathname } = request.nextUrl;
    
    // 0. Path normalization and exclusion
    // Skip static files, images, favicon etc. to avoid infinite loops or overhead
    if (
        pathname.startsWith('/_next/') || 
        pathname.startsWith('/static/') || 
        pathname === '/favicon.ico' || 
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    const isAuthPage = ['/login', '/signup', '/reset-password'].includes(pathname);

    let userId: any = null;
    let isMfaVerified = false;

    if (sessionCookie) {
        try {
            const { payload } = await jwtVerify(sessionCookie, new TextEncoder().encode(getJwtSecretValue()));
            userId = payload.uid;
            isMfaVerified = !!payload.mfa;
        } catch {
            // Invalid or expired session
            // To prevent redirect loop on '/', we just clear the cookie and continue
            if (pathname === '/') {
                const response = NextResponse.next();
                response.cookies.delete('session');
                return response;
            }
            const response = NextResponse.redirect(new URL('/', request.url));
            response.cookies.delete('session');
            return response;
        }
    }

    // 1. Global API Rate Limiting for all /api/ endpoints (Production Only)
    // Bypasses remote Upstash HTTPS round-trips for local development and loopback
    const isProd = process.env.NODE_ENV === 'production';
    const ip = (request as any).ip || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip === 'localhost';

    if (isProd && !isLoopback && pathname.startsWith('/api/') && !pathname.startsWith('/api/realtime/subscribe') && ratelimit) {
        try {
            const { success, limit, reset, remaining } = await ratelimit.limit(`global_api_${ip}`);
            
            if (!success) {
                return NextResponse.json({ success: false, error: 'Too Many Requests' }, { 
                    status: 429,
                    headers: {
                        'X-RateLimit-Limit': limit.toString(),
                        'X-RateLimit-Remaining': remaining.toString(),
                        'X-RateLimit-Reset': reset.toString()
                    }
                });
            }
        } catch (rateError: any) {
            // Fail open cleanly if Redis or Upstash quota limit is reached
            const isQuotaError = rateError?.message?.includes('max requests limit exceeded');
            if (!isQuotaError) {
                console.warn('[Middleware] Rate limiter fallback active:', rateError?.message || rateError);
            }
        }
    }

    // 2. Auth Logic
    if (userId) {
        if (!isMfaVerified) {
             const isMutationRoute = 
                 pathname.startsWith('/api/execute-sql') || 
                 pathname.startsWith('/api/projects') || 
                 pathname.startsWith('/api/webhooks') || 
                 pathname.startsWith('/api/backups') ||
                 pathname.startsWith('/api/admin');

             if (isMutationRoute && request.method !== 'GET') {
                 return NextResponse.json({ success: false, error: 'MFA Required' }, { status: 403 });
             }
        }

        // and tries to access an auth page (login/signup), redirect to dashboard if fully verified
        if (isAuthPage && pathname !== '/reset-password') {
            return NextResponse.redirect(new URL('/dashboard/projects', request.url));
        }
    }
    // If user is not logged in...
    else {
        // Intercept standalone /login and /signup requests and send to homepage modals if not there
        if (pathname === '/login' || pathname === '/signup') {
            return NextResponse.redirect(new URL('/', request.url));
        }

        // allow public access to marketing pages: '/', '/pricing', etc.
        const isPublicStaticPage = ['/', '/pricing', '/privacy', '/terms', '/docs', '/contact', '/reset-password'].includes(pathname);

        // and tries to access a protected page (non-public, non-api), redirect to root
        if (!isPublicStaticPage && !pathname.startsWith('/api/')) {
            return NextResponse.redirect(new URL('/', request.url));
        }
    }

    const res = NextResponse.next();
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('X-Frame-Options', 'SAMEORIGIN');
    res.headers.set('X-XSS-Protection', '1; mode=block');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return res;
  } catch (globalError) {
    console.error('Middleware Critical Error:', globalError);
    // Safety net: allow the request to proceed if the middleware crashes to avoid site-wide 404/500
    const fallbackRes = NextResponse.next();
    fallbackRes.headers.set('X-Content-Type-Options', 'nosniff');
    fallbackRes.headers.set('X-Frame-Options', 'SAMEORIGIN');
    return fallbackRes;
  }
}

// Config matcher is still useful but simpler to avoid issues with standard assets
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
