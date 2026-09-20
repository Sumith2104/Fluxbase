import { NextResponse } from 'next/server';
import { pool } from '@/lib/pg';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REDIS_KEY = 'system:maintenance_banner:active';
const CACHE_TTL_SECONDS = 30;

export interface MaintenanceAnnouncement {
    id: string;
    content: string;
    badge_text: string;
    bg_color: string;
    text_color: string;
    badge_color?: string;
    start_time: string | null;
    end_time: string | null;
    is_active: boolean;
    dismissible: boolean;
    link_url?: string | null;
    link_text?: string | null;
    priority: number;
    created_at: string;
    updated_at: string;
}

export async function GET() {
    try {
        // 1. Try Redis fast-path cache
        try {
            const cached = await redis.get(REDIS_KEY);
            if (cached !== null && cached !== undefined) {
                // If cached as the string 'null' or empty, no active banner exists
                if (cached === 'null' || cached === '') {
                    return NextResponse.json(
                        { success: true, banner: null },
                        { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
                    );
                }
                const banner = typeof cached === 'string' ? JSON.parse(cached) : cached;
                return NextResponse.json(
                    { success: true, banner },
                    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
                );
            }
        } catch (e) {
            logger.warn('[Maintenance API] Redis cache get failed, querying DB directly', e);
        }

        // 2. Query PostgreSQL RDS
        const query = `
            SELECT id, content, badge_text, bg_color, text_color, badge_color,
                   start_time, end_time, is_active, dismissible, link_url, link_text,
                   priority, created_at, updated_at
            FROM fluxbase_global.maintenance_announcements
            WHERE is_active = TRUE
              AND (start_time IS NULL OR start_time <= NOW())
              AND (end_time IS NULL OR end_time > NOW())
            ORDER BY priority DESC, created_at DESC
            LIMIT 1;
        `;

        const result = await pool.query(query);
        const banner: MaintenanceAnnouncement | null = result.rows.length > 0 ? result.rows[0] : null;

        // 3. Cache result in Redis
        try {
            let ttl = CACHE_TTL_SECONDS;
            if (banner && banner.end_time) {
                const msRemaining = new Date(banner.end_time).getTime() - Date.now();
                const secRemaining = Math.max(1, Math.floor(msRemaining / 1000));
                ttl = Math.min(CACHE_TTL_SECONDS, secRemaining);
            }
            await redis.set(REDIS_KEY, banner ? JSON.stringify(banner) : 'null', { ex: ttl });
        } catch (e) {
            logger.warn('[Maintenance API] Redis cache set failed:', e);
        }

        return NextResponse.json(
            { success: true, banner },
            {
                headers: {
                    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60'
                }
            }
        );
    } catch (error: any) {
        logger.error('[Maintenance API] Error fetching maintenance banner:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch maintenance status', banner: null },
            { status: 500 }
        );
    }
}

// Invalidate cache when an admin or webhook updates announcements
export async function DELETE() {
    try {
        await redis.del(REDIS_KEY);
        return NextResponse.json({ success: true, message: 'Maintenance cache invalidated' });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
