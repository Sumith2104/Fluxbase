'use server';

import { getPgPool } from '@/lib/pg';
import { getCurrentUserId } from '@/lib/auth';
import { redis } from '@/lib/redis';
import { getDashboardWidgets } from '@/lib/dashboards';
import logger from '@/lib/logger';
import { LRUCache } from 'lru-cache';

const _analyticsStatsCache = new LRUCache<string, any>({ max: 200, ttl: 30_000 });
const _realtimeHistoryCache = new LRUCache<string, any>({ max: 200, ttl: 15_000 });
const _projectHistoryCache = new LRUCache<string, any>({ max: 200, ttl: 60_000 });

export async function getAnalyticsStatsAction(projectId: string) {
    if (!projectId) return null;
    const cachedLocal = _analyticsStatsCache.get(projectId);
    if (cachedLocal) return cachedLocal;

    const userId = await getCurrentUserId();
    if (!userId) return null;

    const cacheKey = `analytics_stats_${projectId}`;
    try {
        const cached = await redis.get(cacheKey) as any;
        if (cached) {
            _analyticsStatsCache.set(projectId, cached);
            return cached;
        }
    } catch (e) {
        logger.warn('Redis read error for analytics stats:', e);
    }

    try {
        const pool = getPgPool();
        const stats = {
            total_requests: 0,
            all_time_requests: 0,
            type_api_call: 0,
            type_sql_execution: 0,
            type_storage_read: 0,
            type_storage_write: 0,
            type_sql_select: 0,
            type_sql_insert: 0,
            type_sql_update: 0,
            type_sql_delete: 0,
            type_sql_alter: 0
        };

        // 1. Fetch real queries from audit_logs for the last 24 hours
        try {
            const auditRes = await pool.query(`
                SELECT action, statement, COUNT(*) as count
                FROM fluxbase_global.audit_logs
                WHERE project_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY action, statement
            `, [projectId]);

            for (const row of auditRes.rows) {
                const count = parseInt(row.count, 10) || 0;
                stats.total_requests += count;
                stats.type_sql_execution += count;

                const stmt = (row.statement || '').trim().toUpperCase();
                if (stmt.startsWith('SELECT') || stmt.startsWith('WITH')) {
                    stats.type_sql_select += count;
                } else if (stmt.startsWith('INSERT')) {
                    stats.type_sql_insert += count;
                } else if (stmt.startsWith('UPDATE')) {
                    stats.type_sql_update += count;
                } else if (stmt.startsWith('DELETE')) {
                    stats.type_sql_delete += count;
                } else if (stmt.startsWith('ALTER') || stmt.startsWith('CREATE') || stmt.startsWith('DROP')) {
                    stats.type_sql_alter += count;
                } else {
                    stats.type_sql_select += count;
                }
            }
        } catch (auditErr) {
            logger.warn('Audit logs stats error:', auditErr);
        }

        // 2. Fetch rollups
        try {
            const result = await pool.query(`
                SELECT event_type, SUM(count) as total
                FROM fluxbase_global.analytics_rollups
                WHERE project_id = $1 AND period_start >= NOW() - INTERVAL '24 hours'
                GROUP BY event_type
            `, [projectId]);

            for (const row of result.rows) {
                const type = row.event_type;
                const count = parseInt(row.total, 10) || 0;
                
                if (type === 'api_call') stats.type_api_call += count;
                if (type === 'storage_read') stats.type_storage_read += count;
                if (type === 'storage_write') stats.type_storage_write += count;
            }
        } catch {}

        // 3. Merge "In-Flight" data from Redis (Unsynced - strictly last 24 hours only)
        try {
            const now = Date.now();
            const last24hCutoff = now - 24 * 60 * 60 * 1000;
            const allFlushKeys = await redis.smembers('analytics_keys_to_flush');
            const projectKeys = (allFlushKeys || []).filter(k => {
                if (!k.startsWith(`analytics_rollup:${projectId}:`)) return false;
                const periodMs = parseInt(k.split(':')[2], 10);
                return !isNaN(periodMs) && periodMs >= last24hCutoff;
            });
            
            if (projectKeys.length > 0) {
                const values = await redis.mget(...projectKeys);
                for (let i = 0; i < projectKeys.length; i++) {
                    const key = projectKeys[i];
                    const val = parseInt(values[i] as string || '0', 10);
                    const type = key.split(':')[3];

                    if (type === 'api_call') stats.type_api_call += val;
                    if (type === 'storage_read') stats.type_storage_read += val;
                    if (type === 'storage_write') stats.type_storage_write += val;
                    if (type === 'sql_execution') stats.type_sql_execution += val;
                    if (type?.startsWith('sql_')) {
                        const sqlAction = `type_${type}` as keyof typeof stats;
                        if (stats[sqlAction] !== undefined) (stats as any)[sqlAction] += val;
                    }
                }
            }
        } catch {}

        // Ensure total_requests reflects real distinct interactions without double-counting
        stats.total_requests = Math.max(stats.total_requests, stats.type_api_call, stats.type_sql_execution);
        stats.type_api_call = Math.max(stats.type_api_call, stats.total_requests);

        // Fetch cumulative all-time total requests from audit_logs
        let allTimeRequests = 0;
        try {
            const allTimeRes = await pool.query(
                'SELECT COUNT(*) as total FROM fluxbase_global.audit_logs WHERE project_id = $1',
                [projectId]
            );
            allTimeRequests = parseInt(allTimeRes.rows[0]?.total || '0', 10);
        } catch (allTimeErr) {
            logger.warn('All-time stats error:', allTimeErr);
        }
        (stats as any).all_time_requests = Math.max(allTimeRequests, stats.total_requests);

        // 4. Fetch Live Sessions directly from active real-time subscribers
        try {
            const realtimeManager = (await import('@/lib/realtime-manager')).default;
            const activeLocal = realtimeManager.getSubscriberCount(projectId);
            (stats as any).live_sessions = activeLocal;
        } catch {
            (stats as any).live_sessions = 0;
        }

        _analyticsStatsCache.set(projectId, stats);
        try {
            await redis.set(cacheKey, stats, { ex: 30 }); 
        } catch {}

        return stats;
    } catch (e) {
        logger.error('getAnalyticsStatsAction error:', e);
        return null;
    }
}

export async function getRealtimeHistoryAction(projectId: string) {
    if (!projectId) return [];
    const cachedLocal = _realtimeHistoryCache.get(projectId);
    if (cachedLocal) return cachedLocal;

    try {
        const now = Date.now();
        const currentMinute = Math.floor(now / 60000) * 60000;
        
        const historyPoints: {
            timestamp: number;
            timeLabel: string;
            requests: number;
            api: number;
            sql: number;
            deltaRequests: number;
            deltaApi: number;
            deltaSql: number;
        }[] = [];

        const minuteKeysToFetch: string[] = [];
        const minutesList: number[] = [];

        for (let i = 59; i >= 0; i--) {
            const time = currentMinute - (i * 60000);
            minutesList.push(time);
            minuteKeysToFetch.push(
                `analytics_minute:${projectId}:${time}:api_call`,
                `analytics_minute:${projectId}:${time}:sql_execution`
            );
        }

        let redisValues: (string | null)[] = [];
        try {
            if (minuteKeysToFetch.length > 0) {
                redisValues = await redis.mget(...minuteKeysToFetch);
            }
        } catch (e) {
            logger.warn('Redis mget error in getRealtimeHistoryAction:', e);
        }

        const pool = getPgPool();
        const minuteCounts = new Map<number, number>();
        try {
            const pgRes = await pool.query(`
                SELECT date_trunc('minute', created_at) as min_ts, COUNT(*) as count
                FROM fluxbase_global.audit_logs
                WHERE project_id = $1 AND created_at >= NOW() - INTERVAL '60 minutes'
                GROUP BY 1
            `, [projectId]);
            for (const row of pgRes.rows) {
                const ts = new Date(row.min_ts).getTime();
                minuteCounts.set(ts, parseInt(row.count, 10) || 0);
            }
        } catch {}

        for (let i = 0; i < minutesList.length; i++) {
            const time = minutesList[i];
            const date = new Date(time);
            const timeLabel = date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });

            let apiVal = parseInt((redisValues[i * 2] as string) || '0', 10);
            let sqlVal = parseInt((redisValues[i * 2 + 1] as string) || '0', 10);

            const pgCount = minuteCounts.get(time) || 0;
            if (pgCount > 0) {
                sqlVal += pgCount;
                apiVal = Math.max(apiVal, sqlVal);
            }

            const totalVal = Math.max(apiVal, sqlVal);

            historyPoints.push({
                timestamp: time,
                timeLabel,
                requests: totalVal,
                api: apiVal,
                sql: sqlVal,
                deltaRequests: totalVal,
                deltaApi: apiVal,
                deltaSql: sqlVal
            });
        }

        _realtimeHistoryCache.set(projectId, historyPoints);
        return historyPoints;
    } catch (e) {
        logger.error('getRealtimeHistoryAction error:', e);
        return [];
    }
}

export async function getProjectHistoryAction(projectId: string) {
    if (!projectId) return null;
    const cachedLocal = _projectHistoryCache.get(projectId);
    if (cachedLocal) return cachedLocal;

    const cacheKey = `project_history_${projectId}`;
    try {
        const cached = await redis.get(cacheKey) as any;
        if (cached) {
            _projectHistoryCache.set(projectId, cached);
            return cached;
        }
    } catch (e) {
        logger.warn('Redis read error for project history:', e);
    }

    try {
        const pool = getPgPool();
        const now = Date.now();

        // 24 hourly buckets (initialized to 0)
        const requestsArr = Array(24).fill(0);
        const apiCallsArr = Array(24).fill(0);
        const sessionsArr = Array(24).fill(0);

        // 1. Fetch aggregated hourly distribution from audit_logs for the last 24 hours
        try {
            const auditRes = await pool.query(`
                SELECT date_trunc('hour', created_at) as hr_ts, COUNT(*) as count
                FROM fluxbase_global.audit_logs
                WHERE project_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY 1
            `, [projectId]);

            for (const row of auditRes.rows) {
                const rowTime = new Date(row.hr_ts).getTime();
                const hoursAgo = Math.floor((now - rowTime) / (1000 * 60 * 60));
                if (hoursAgo >= 0 && hoursAgo < 24) {
                    const index = 23 - hoursAgo;
                    const cnt = parseInt(row.count, 10) || 0;
                    requestsArr[index] += cnt;
                    apiCallsArr[index] += cnt;
                }
            }
        } catch (auditErr) {
            logger.warn('Audit logs history error:', auditErr);
        }

        // 2. Fetch from rollups (last 24 hours only)
        try {
            const rollupRes = await pool.query(`
                SELECT period_start, event_type, SUM(count) as total
                FROM fluxbase_global.analytics_rollups
                WHERE project_id = $1 AND period_start >= NOW() - INTERVAL '24 hours'
                GROUP BY period_start, event_type
                ORDER BY period_start ASC
            `, [projectId]);

            for (const row of rollupRes.rows) {
                const rowTime = new Date(row.period_start).getTime();
                const hoursAgo = Math.floor((now - rowTime) / (1000 * 60 * 60));
                if (hoursAgo >= 0 && hoursAgo < 24) {
                    const index = 23 - hoursAgo;
                    const count = parseInt(row.total, 10) || 0;
                    if (row.event_type === 'api_call' || row.event_type === 'sql_execution') {
                        requestsArr[index] = Math.max(requestsArr[index], count);
                    }
                    if (row.event_type === 'api_call') {
                        apiCallsArr[index] = Math.max(apiCallsArr[index], count);
                    }
                    if (row.event_type === 'sessions') {
                        sessionsArr[index] = Math.max(sessionsArr[index], count);
                    }
                }
            }
        } catch {}

        // 3. Merge in-flight Redis metrics (strictly last 24 hours only)
        try {
            const last24hCutoff = now - 24 * 60 * 60 * 1000;
            const allFlushKeys = await redis.smembers('analytics_keys_to_flush');
            const projectKeys = (allFlushKeys || []).filter(k => {
                if (!k.startsWith(`analytics_rollup:${projectId}:`)) return false;
                const periodMs = parseInt(k.split(':')[2], 10);
                return !isNaN(periodMs) && periodMs >= last24hCutoff;
            });
            
            if (projectKeys.length > 0) {
                const values = await redis.mget(...projectKeys);
                for (let i = 0; i < projectKeys.length; i++) {
                    const key = projectKeys[i];
                    const val = parseInt(values[i] as string || '0', 10);
                    const rowTime = parseInt(key.split(':')[2], 10);
                    const type = key.split(':')[3];
                    const hoursAgo = Math.floor((now - rowTime) / (1000 * 60 * 60));

                    if (hoursAgo >= 0 && hoursAgo < 24) {
                        const index = 23 - hoursAgo;
                        if (type === 'api_call' || type === 'sql_execution') {
                            requestsArr[index] = Math.max(requestsArr[index], val);
                        }
                        if (type === 'api_call') {
                            apiCallsArr[index] = Math.max(apiCallsArr[index], val);
                        }
                    }
                }
            }
        } catch {}

        // Real-time active subscribers for the current hour
        try {
            const realtimeManager = (await import('@/lib/realtime-manager')).default;
            sessionsArr[23] = realtimeManager.getSubscriberCount(projectId);
        } catch {}

        // 4. Fetch 30-day daily distribution for Total Requests bar chart
        const totalHistoryArr: { val: number; timeLabel: string }[] = [];
        try {
            const dailyRes = await pool.query(`
                SELECT date_trunc('day', created_at) as day_ts, COUNT(*) as count 
                FROM fluxbase_global.audit_logs 
                WHERE project_id = $1 AND created_at >= NOW() - INTERVAL '30 days' 
                GROUP BY 1 
                ORDER BY 1 ASC
            `, [projectId]);

            const dayMap = new Map<string, number>();
            for (let i = 29; i >= 0; i--) {
                const d = new Date(now - i * 24 * 60 * 60 * 1000);
                const key = d.toISOString().slice(0, 10);
                dayMap.set(key, 0);
            }

            for (const row of dailyRes.rows) {
                const key = new Date(row.day_ts).toISOString().slice(0, 10);
                if (dayMap.has(key)) {
                    dayMap.set(key, parseInt(row.count, 10) || 0);
                }
            }

            for (let i = 29; i >= 0; i--) {
                const d = new Date(now - i * 24 * 60 * 60 * 1000);
                const key = d.toISOString().slice(0, 10);
                const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                totalHistoryArr.push({
                    val: dayMap.get(key) || 0,
                    timeLabel: label
                });
            }
        } catch (dailyErr) {
            logger.warn('Daily history error:', dailyErr);
        }

        const payload = {
            daily: { 'today': requestsArr[23] || 0 },
            monthly: {},
            yearly: {},
            requests: requestsArr.map(val => ({ val })),
            apiCalls: apiCallsArr.map(val => ({ val })),
            sessions: sessionsArr.map(val => ({ val })),
            totalHistory: totalHistoryArr.length > 0 ? totalHistoryArr : requestsArr.map(val => ({ val }))
        };

        _projectHistoryCache.set(projectId, payload);
        try {
            await redis.set(cacheKey, payload, { ex: 60 });
        } catch {}

        return payload;
    } catch (e) {
        logger.error('getProjectHistoryAction error:', e);
        return {
            daily: {}, monthly: {}, yearly: {},
            requests: Array(24).fill({ val: 0 }),
            apiCalls: Array(24).fill({ val: 0 }),
            sessions: Array(24).fill({ val: 0 }),
            totalHistory: Array(30).fill({ val: 0 })
        };
    }
}


export async function getDashboardWidgetsAction(projectId: string) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error("Unauthorized");
    return await getDashboardWidgets(projectId, userId);
}

