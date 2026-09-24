/**
 * High-Throughput Streaming Firehose API (`POST /api/v1/firehose`)
 * ───────────────────────────────────────────────────────────────
 * Designed for continuous high-speed data piping (e.g. curl --data-binary @huge.ndjson).
 * Accepts both application/x-ndjson and application/json.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ingestEngine } from '@/lib/high-throughput-ingest';
import readline from 'readline';
import { Readable } from 'stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const contentType = req.headers.get('content-type') || '';
    const table = req.headers.get('x-target-table') || 'firehose_stream';

    // Fast-path 1: NDJSON Stream
    if (contentType.includes('ndjson') || contentType.includes('x-ndjson')) {
        if (!req.body) {
            return NextResponse.json({ error: 'No stream body provided' }, { status: 400 });
        }

        const nodeStream = Readable.fromWeb(req.body as any);
        const rl = readline.createInterface({
            input: nodeStream,
            crlfDelay: Infinity,
        });

        let totalQueued = 0;
        let batch: Record<string, any>[] = [];

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const parsed = JSON.parse(trimmed);
                batch.push(parsed);
                if (batch.length >= 1000) {
                    ingestEngine.enqueue(table, batch);
                    totalQueued += batch.length;
                    batch = [];
                }
            } catch {
                // Ignore malformed individual lines to keep stream unbroken
            }
        }

        if (batch.length > 0) {
            ingestEngine.enqueue(table, batch);
            totalQueued += batch.length;
        }

        const metrics = ingestEngine.getMetrics();
        return NextResponse.json({
            ok: true,
            stream: 'completed',
            queued: totalQueued,
            currentRps: metrics.currentRps,
            peakRps: metrics.peakRps,
        }, { status: 202 });
    }

    // Fast-path 2: Standard JSON or Array
    try {
        const body = await req.json();
        const rows = Array.isArray(body) ? body : (Array.isArray(body.rows) ? body.rows : [body]);
        const targetTable = body.table || table;
        const result = ingestEngine.enqueue(targetTable, rows);

        return NextResponse.json({
            ok: true,
            queued: result.queued,
            batchId: result.batchId,
            currentRps: result.currentRps,
            latencyUs: result.latencyUs,
        }, { status: 202 });
    } catch {
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
}

export async function GET() {
    return NextResponse.json({
        service: 'Fluxbase High-Throughput Firehose',
        status: 'online',
        metrics: ingestEngine.getMetrics(),
    });
}
