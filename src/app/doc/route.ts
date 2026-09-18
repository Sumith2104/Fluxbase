import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const isDownload = searchParams.get('download') === 'true' || searchParams.get('pdf') === 'true';

    if (isDownload) {
        return NextResponse.redirect(new URL('/api/docs/download-pdf', request.url), 302);
    }

    // Redirect /doc to the complete /docs interactive documentation page
    return NextResponse.redirect(new URL('/docs', request.url), 307);
}
