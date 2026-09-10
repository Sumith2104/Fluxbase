import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export const maxDuration = 60; // 1 minute max for cron execution

export async function GET(request: Request) {
    try {
        // Only allow manual local exec or secure production cron triggers
        const authHeader = request.headers.get('authorization');
        if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const keys = await redis.smembers('analytics_keys_to_flush');
        if (!keys || keys.length === 0) {
            return NextResponse.json({ success: true, processed: 0 });
        }

        const pool = getPgPool();
        let inserted = 0;

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const parts = key.split(':');
            // Format: analytics_rollup:{projectId}:{periodStartMs}:{type}
            const projectId = parts[1];
            const periodStartMs = parseInt(parts[2], 10);
            const periodStartISO = new Date(periodStartMs).toISOString();
            const eventType = parts[3];

            let val = 0;
            if (eventType === 'sessions') {
                // For sessions, we count the number of unique members in the set
                val = await redis.scard(key);
            } else {
                // For counters, we just read the number
                const rawVal = await redis.get(key);
                val = parseInt(rawVal as string || '0', 10);
            }

            if (val === 0) {
                await redis.srem('analytics_keys_to_flush', key);
                continue;
            }

            const query = `
                INSERT INTO fluxbase_global.analytics_rollups (project_id, period_start, event_type, count)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (project_id, period_start, event_type)
                DO UPDATE SET count = CASE 
                    WHEN EXCLUDED.event_type = 'sessions' THEN EXCLUDED.count -- Sessions are unique per hour, overwrite/max is better than sum if multiple flushes
                    ELSE fluxbase_global.analytics_rollups.count + EXCLUDED.count 
                END;
            `;

            try {
                await pool.query(query, [projectId, periodStartISO, eventType, val]);
            } catch {
                // Silently skip if project doesn't exist anymore
            }
            
            await redis.del(key);
            await redis.srem('analytics_keys_to_flush', key);
            inserted++;
        }

        return NextResponse.json({ success: true, processed: inserted });

    } catch (e: any) {
        logger.error('Flush Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
