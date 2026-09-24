import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';


function getJwtSecretValue(): string {
    const secret = process.env.JWT_SECRET;
    if (secret) return secret;

    if (process.env.NODE_ENV === 'production') {
        throw new Error('Missing required JWT_SECRET environment variable');
    }
    return 'fluxbase_dev_secret_key_123';
}

// In-memory sliding window fallback for local/AWS native deployments (0ms latency, zero external calls)
const memoryRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkLocalRateLimit(key: string, limit = 50, windowMs = 10000): { success: boolean; limit: number; remaining: number; reset: number } {
    const now = Date.now();
    const entry = memoryRateLimitMap.get(key);
    
    // Periodically prune stale entries
    if (memoryRateLimitMap.size > 5000) {
        for (const [k, v] of memoryRateLimitMap.entries()) {
            if (v.resetAt < now) memoryRateLimitMap.delete(k);
        }
    }

    if (!entry || entry.resetAt < now) {
        memoryRateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
        return { success: true, limit, remaining: limit - 1, reset: now + windowMs };
    }

    if (entry.count >= limit) {
        return { success: false, limit, remaining: 0, reset: entry.resetAt };
    }

    entry.count++;
    return { success: true, limit, remaining: limit - entry.count, reset: entry.resetAt };
}

export async function middleware(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('session')?.value;
    const { pathname } = request.nextUrl;
    
    // 0. Path normalization and exclusion
    // Skip static files, images, favicon, robots.txt, sitemap.xml etc. to avoid infinite loops or blocking SEO crawlers
    if (
        pathname.startsWith('/_next/') || 
        pathname.startsWith('/static/') || 
        pathname === '/favicon.ico' || 
        pathname === '/robots.txt' || 
        pathname === '/sitemap.xml' || 
        pathname === '/manifest.webmanifest' || 
        pathname.startsWith('/.well-known/') || 
        pathname.startsWith('/google') || 
        /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?|ttf|eot|txt|xml|json|pdf|html)$/i.test(pathname)
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
            // To prevent redirect loop on '/' or breaking checkout payment returns on '/checkout', we just clear the cookie and continue
            if (pathname === '/' || pathname === '/checkout') {
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

    if (isProd && !isLoopback && pathname.startsWith('/api/') && !pathname.startsWith('/api/realtime/subscribe')) {
        const { success, limit, reset, remaining } = checkLocalRateLimit(`global_api_${ip}`);
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

        // allow public access to marketing pages: '/', '/pricing', etc., and '/checkout' for payment handoffs & returns
        const isPublicStaticPage = [
            '/', '/pricing', '/privacy', '/terms', '/docs', '/doc', '/contact', '/reset-password', '/checkout', '/ai-models', '/models', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest'
        ].includes(pathname) || pathname.startsWith('/docs') || pathname.startsWith('/doc') || pathname.startsWith('/ai-models') || pathname.startsWith('/models') || pathname.startsWith('/google');

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
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|google.*).*)',
  ],
};
