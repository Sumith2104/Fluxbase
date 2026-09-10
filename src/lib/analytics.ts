import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

type AnalyticsType = 'api_call' | 'sql_execution' | 'storage_read' | 'storage_write' | 'sql_select' | 'sql_insert' | 'sql_update' | 'sql_delete' | 'sql_alter';

export async function trackApiRequest(projectId: string, type: AnalyticsType) {
    if (!projectId) return;

    try {
        const now = Date.now();
        const minuteStartMs = Math.floor(now / 60000) * 60000;
        const hourStartMs = Math.floor(now / 3600000) * 3600000;
        
        // 1. Minute-level key for realtime line chart (TTL 2 hours)
        const minuteKey = `analytics_minute:${projectId}:${minuteStartMs}:${type}`;
        
        // 2. Rollup key for hourly aggregation in postgres
        const hourKey = `analytics_rollup:${projectId}:${hourStartMs}:${type}`;

        const p = redis.pipeline();
        p.incr(minuteKey);
        p.expire(minuteKey, 7200);
        p.incr(hourKey);
        p.expire(hourKey, 172800); // 48 hours TTL
        p.sadd('analytics_keys_to_flush', hourKey);
        await p.exec();

    } catch (error) {
        // We don't want to fail the actual user request just because analytics failed
        logger.error(`Failed to track analytics in Redis for project ${projectId}:`, error);
    }
}
