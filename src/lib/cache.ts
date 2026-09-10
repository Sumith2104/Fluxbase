// Distributed Upstash Redis cache for table rows to speed up GET/SELECT requests.
// In a serverless environment like Vercel, this correctly persists state across all isolated instances.

import type { Row } from '@/lib/data';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

export interface PaginatedCachePayload {
    rows: Row[];
    totalRows: number;
    nextCursorId: string | null;
    hasMore: boolean;
}

interface CacheEntry {
    lastUpdated: number;
    data: PaginatedCachePayload;
}

const CACHE_TTL_SECONDS = 60; // 60 seconds

export async function getCachedTableRows(projectId: string, tableId: string, page: number): Promise<PaginatedCachePayload | null> {
    const key = `fluxTable_${projectId}_${tableId}_p${page}`;
    try {
        const entry = await redis.get<CacheEntry>(key);
        if (entry) {
            return entry.data;
        }
    } catch (e) {
        logger.warn(`[Redis Cache Error] get: ${key}`, e);
    }
    return null;
}

export async function setCachedTableRows(projectId: string, tableId: string, page: number, data: PaginatedCachePayload): Promise<void> {
    const key = `fluxTable_${projectId}_${tableId}_p${page}`;
    try {
        await redis.set(key, {
            lastUpdated: Date.now(),
            data
        }, { ex: CACHE_TTL_SECONDS });
    } catch (e) {
        logger.warn(`[Redis Cache Error] set: ${key}`, e);
    }
}

export async function invalidateTableCache(projectId: string, tableId: string): Promise<void> {
    try {
        const { invalidateTableCountCache, invalidateProjectAnalyticsCache } = await import('@/lib/data');
        invalidateTableCountCache(tableId);
        if (invalidateProjectAnalyticsCache) {
            invalidateProjectAnalyticsCache(projectId);
        }
    } catch { /* ignore */ }

    // Invalidate enough pages to cover what the UI would request after a large import.
    // Each page = 50 rows; 20 pages = first 1000 rows — enough for most initial infinite-scroll
    // views. Beyond that, stale pages expire via their 60s TTL.
    // (Full pattern-delete would require Redis SCAN which Upstash REST doesn't support inline.)
    try {
        const keys = Array.from({ length: 20 }, (_, p) => `fluxTable_${projectId}_${tableId}_p${p}`);
        await redis.del(...keys);
    } catch (e) {
        logger.warn(`[Redis Cache Error] invalidate: fluxTable_${projectId}_${tableId}`, e);
    }
}

export async function invalidateProjectCache(projectId: string): Promise<void> {
    try {
        const { invalidateProjectAnalyticsCache } = await import('@/lib/data');
        if (invalidateProjectAnalyticsCache) {
            invalidateProjectAnalyticsCache(projectId);
        }
    } catch { /* ignore */ }
    logger.info(`[Redis Cache] Project ${projectId} tables will naturally expire.`);
}
