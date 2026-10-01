import { NextRequest, NextResponse } from 'next/server';
import { resolveHostingSite, serveHostedAsset, logHostingAccess } from '@/lib/hosting-serve';

export const dynamic = 'force-dynamic';

async function handleHostingServe(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const hostParam = searchParams.get('host');
    const pathParam = searchParams.get('path');

    const headerHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    const targetHost = (hostParam || headerHost).split(':')[0].toLowerCase();
    const targetPath = pathParam || new URL(req.url).pathname;

    const siteInfo = await resolveHostingSite(targetHost);

    if (!siteInfo) {
        const notFoundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Site Not Found - Fluxbase Hosting</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090a0f; color: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #131722; border: 1px solid #1e293b; border-radius: 12px; padding: 40px; max-width: 480px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #e2e8f0; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
    .code { font-family: monospace; background: #0f172a; padding: 4px 8px; border-radius: 4px; color: #38bdf8; }
    a { color: #38bdf8; text-decoration: none; font-weight: 500; font-size: 14px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Site Not Found</h1>
    <p>No active deployment exists for <span class="code">${targetHost}</span>. If you recently deployed, please wait a few seconds or check your deployment status in the Fluxbase dashboard.</p>
    <a href="https://fluxbasedb.me/hosting">&larr; Return to Fluxbase Dashboard</a>
  </div>
</body>
</html>`;
        return new NextResponse(notFoundHtml, {
            status: 404,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Flux-Hosting-Error': 'SiteNotFound'
            }
        });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || '';
    const referer = req.headers.get('referer') || '';

    // Check if site has an active full-stack standalone Node.js/Next.js backend server
    const { getBackendPort } = await import('@/lib/hosting-runner');
    const backendPort = await getBackendPort(targetHost, siteInfo.siteId);

    const isStaticAsset = targetPath.startsWith('/_next/static/') ||
        targetPath.startsWith('/static/') ||
        /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?|ttf|eot)$/i.test(targetPath);

    // For full-stack sites with a live backend: proxy ALL requests (SSR pages, API routes,
    // server components, static assets) - the backend handles everything including _next/static.
    // This ensures auth-protected pages, server actions, and SSR work correctly.
    if (backendPort) {
        try {
            // Build a clean query string: strip middleware rewrite params (host, path)
            // so the backend only sees the original client query params
            const rewriteParams = new URLSearchParams(req.nextUrl.search);
            rewriteParams.delete('host');
            rewriteParams.delete('path');
            const queryStr = rewriteParams.toString() ? `?${rewriteParams.toString()}` : '';
            const proxyUrl = `http://127.0.0.1:${backendPort}${targetPath}${queryStr}`;

            const proxyHeaders = new Headers(req.headers);
            proxyHeaders.set('host', targetHost);
            proxyHeaders.set('x-forwarded-host', targetHost);
            proxyHeaders.set('x-forwarded-proto', 'https');
            // Remove headers that interfere with proxy target interpretation
            proxyHeaders.delete('accept-encoding');

            const method = req.method;
            const hasBody = method !== 'GET' && method !== 'HEAD';
            const body = hasBody ? await req.arrayBuffer() : undefined;

            const proxyRes = await fetch(proxyUrl, {
                method,
                headers: proxyHeaders,
                body,
                redirect: 'manual'
            });

            // CRITICAL: Buffer the entire response body as a concrete ArrayBuffer.
            // Passing proxyRes.body (ReadableStream) directly to NextResponse causes
            // empty bodies in Next.js because the stream can get consumed/locked internally,
            // especially when content-encoding is stripped.
            const proxyBody = await proxyRes.arrayBuffer();

            const resHeaders = new Headers(proxyRes.headers);
            resHeaders.delete('content-encoding');
            resHeaders.delete('transfer-encoding');
            // Set the correct content-length for the buffered response
            resHeaders.set('content-length', proxyBody.byteLength.toString());

            return new NextResponse(proxyBody, {
                status: proxyRes.status,
                headers: resHeaders
            });
        } catch (proxyErr: any) {
            console.error(`[FullStack Proxy Error] Failed to proxy to backend on port ${backendPort}:`, proxyErr?.message);
            // Return a proper JSON error instead of silently falling through
            return NextResponse.json(
                { error: `Backend server on port ${backendPort} is not responding. It may be restarting.`, status: 502 },
                {
                    status: 502,
                    headers: {
                        'Retry-After': '3',
                        'X-Flux-Hosting-Status': 'ProxyError'
                    }
                }
            );
        }
    }

    // If this is an API call or non-GET dynamic mutation on a full-stack site where backend is starting/unavailable:
    // Return a structured JSON response instead of falling through to static S3 asset lookup (which throws 405 Method Not Allowed)
    const isDynamicApiOrAction = targetPath.startsWith('/api/') || req.headers.has('next-action') || (req.method !== 'GET' && req.method !== 'HEAD');
    if (isDynamicApiOrAction && (siteInfo.isFullstack || !isStaticAsset)) {
        return NextResponse.json(
            { error: 'Backend server is initializing or recovering. Please retry shortly.', status: 503 },
            {
                status: 503,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Retry-After': '3',
                    'X-Flux-Hosting-Status': 'BackendInitializing'
                }
            }
        );
    }

    try {
        const result = await serveHostedAsset(siteInfo, targetPath);

        logHostingAccess({
            siteId: siteInfo.siteId,
            deployId: siteInfo.deployId,
            path: targetPath,
            statusCode: result.statusCode,
            bytesServed: result.bytesServed || 0,
            ip,
            userAgent,
            referer
        });

        const headers: Record<string, string> = {
            'Content-Type': result.contentType || 'application/octet-stream',
            ...(result.headers || {})
        };

        const responseBody = result.body
            ? (typeof result.body === 'string' ? result.body : new Uint8Array(result.body))
            : null;

        return new NextResponse(responseBody, {
            status: result.statusCode,
            headers
        });
    } catch (err: any) {
        return new NextResponse('Internal Server Error - Fluxbase Hosting Asset Pipeline', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

export {
    handleHostingServe as GET,
    handleHostingServe as POST,
    handleHostingServe as PUT,
    handleHostingServe as DELETE,
    handleHostingServe as PATCH,
    handleHostingServe as OPTIONS,
    handleHostingServe as HEAD
};
