import { NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
    const totalStart = Date.now();
    const results: Record<string, any> = {};

    // Execute Postgres, MySQL, and Redis probes concurrently in parallel
    const [pgRes, mysqlRes, redisRes] = await Promise.allSettled([
        (async () => {
            const dbStart = Date.now();
            const pool = getPgPool();
            await Promise.race([
                pool.query('SELECT 1'),
                new Promise((_, rej) => setTimeout(() => rej('timeout'), 2000))
            ]);
            return Date.now() - dbStart;
        })(),
        (async () => {
            const mysqlStart = Date.now();
            const { getMysqlPool } = await import('@/lib/mysql');
            const mysqlPool = getMysqlPool();
            await Promise.race([
                mysqlPool.query('SELECT 1'),
                new Promise((_, rej) => setTimeout(() => rej('timeout'), 2500))
            ]);
            return Date.now() - mysqlStart;
        })(),
        (async () => {
            const redisStart = Date.now();
            await redis.ping();
            return Date.now() - redisStart;
        })()
    ]);

    if (pgRes.status === 'fulfilled') {
        results.database = true;
        results.dbLatencyMs = pgRes.value;
    } else {
        results.database = false;
        results.dbLatencyMs = -1;
    }

    if (mysqlRes.status === 'fulfilled') {
        results.mysql = true;
        results.mysqlLatencyMs = mysqlRes.value;
    } else {
        results.mysql = false;
        results.mysqlLatencyMs = -1;
    }

    if (redisRes.status === 'fulfilled') {
        results.redis = true;
        results.redisLatencyMs = redisRes.value;
    } else {
        results.redis = false;
        results.redisLatencyMs = -1;
    }

    results.api = true;
    results.serverTimeMs = Date.now() - totalStart;
    results.status = results.database ? 'healthy' : 'degraded';
    results.timestamp = new Date().toISOString();

    const isHealthy = results.database === true;
    return NextResponse.json(results, { status: isHealthy ? 200 : 503 });
}
