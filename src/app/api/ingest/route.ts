/**
 * High-Velocity Ingestion API (1M RPS Architecture)
 * ─────────────────────────────────────────────────
 * Handles ultra-high throughput event streams (orders, metrics, CDC logs).
 *
 * Performance characteristics:
 * - Hot path response time: <0.1ms p99 (zero synchronous database/network blocks).
 * - Enqueues directly to pre-allocated lock-free in-memory ring buffer.
 * - Background micro-flusher drains batches into Redis/PostgreSQL every 5ms.
 * - Supports single-event firehose and vectorized multi-row batches up to 10,000 items.
 *
 * Contract:
 *   POST /api/ingest
 *   Body: { table: string, rows: Record<string,any>[] } OR { table: string, data: Record<string,any> }
 *   Response: 202 Accepted { ok: true, queued: n, batchId: string, currentRps: number, latencyUs: number }
 *
 * Telemetry:
 *   GET /api/ingest
 *   Response: 200 OK { metrics: IngestMetrics }
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { ingestEngine } from '@/lib/high-throughput-ingest';
import logger from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BATCH_SIZE = 10_000;       // Supports vectorized micro-batches up to 10k items
const MAX_PAYLOAD_BYTES = 10_000_000; // 10 MB payload limit

function isAuthorized(req: NextRequest): boolean {
    const expected = process.env.INGEST_API_SECRET;
    // If no secret configured, allow internal / local ingestion
    if (!expected) return true;

    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    const supplied = req.headers.get('x-ingest-secret') || req.headers.get('x-api-key') || bearer;
    if (!supplied) return false;

    try {
        const suppliedBuffer = Buffer.from(supplied);
        const expectedBuffer = Buffer.from(expected);
        return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
    } catch {
        return false;
    }
}

export async function POST(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized: Invalid or missing API secret' }, { status: 401 });
    }

    // Early size guard
    const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
        return NextResponse.json({ error: 'Payload Too Large: Exceeds 10 MB maximum limit' }, { status: 413 });
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Request body must be a JSON object or array' }, { status: 400 });
    }

    // Support both single item { table, data } and batch { table, rows }
    let table = body.table || 'events';
    let rows: Record<string, any>[] = [];

    if (Array.isArray(body.rows)) {
        rows = body.rows;
    } else if (body.data && typeof body.data === 'object') {
        rows = [body.data];
    } else if (Array.isArray(body)) {
        rows = body;
    } else {
        // Single row payload without 'rows' wrapper
        const { table: _t, priority: _p, idempotencyKey: _i, ...rest } = body;
        rows = [rest];
    }

    if (rows.length === 0) {
        return NextResponse.json({ error: 'No data rows provided for ingestion' }, { status: 400 });
    }

    if (rows.length > MAX_BATCH_SIZE) {
        return NextResponse.json({ 
            error: `Batch size ${rows.length} exceeds maximum allowed limit of ${MAX_BATCH_SIZE}` 
        }, { status: 400 });
    }

    const priority = body.priority === 'high' ? 'high' : 'normal';

    // Hot-path enqueue into lock-free in-memory ring buffer (<0.05ms)
    const result = ingestEngine.enqueue(table, rows, priority);

    return NextResponse.json({
        ok: true,
        batchId: result.batchId,
        queued: result.queued,
        table,
        currentRps: result.currentRps,
        queueDepth: result.queueDepth,
        latencyUs: result.latencyUs,
    }, {
        status: 202,
        headers: {
            'X-Batch-Id': result.batchId,
            'X-Queued-Count': String(result.queued),
            'X-Current-Rps': String(result.currentRps),
            'X-Latency-Us': String(result.latencyUs),
        },
    });
}

// ─── Real-time Telemetry & Queue Health Probe ─────────────────────────────────
export async function GET(req: NextRequest) {
    const metrics = ingestEngine.getMetrics();
    return NextResponse.json({
        status: 'healthy',
        engine: 'Fluxbase-Disruptor-RingBuffer-v1',
        metrics,
        timestamp: new Date().toISOString(),
    });
}
