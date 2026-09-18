import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const filePath = join(process.cwd(), 'public', 'fluxbase-integration-guide.pdf');

        if (!existsSync(filePath)) {
            return NextResponse.json(
                { success: false, error: 'Documentation PDF not found on server' },
                { status: 404 }
            );
        }

        const fileBuffer = readFileSync(filePath);

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="Fluxbase-Integration-Guide.pdf"',
                'Content-Length': fileBuffer.length.toString(),
                'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            },
        });
    } catch (error: any) {
        console.error('[Download PDF Error]:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to stream documentation PDF' },
            { status: 500 }
        );
    }
}
