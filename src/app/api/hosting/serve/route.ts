import { NextRequest, NextResponse } from 'next/server';
import { resolveHostingSite, serveHostedAsset, logHostingAccess } from '@/lib/hosting-serve';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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
