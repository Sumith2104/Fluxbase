'use server';

import { getPgPool } from '@/lib/pg';
import type { User } from '@/lib/auth';
import logger from '@/lib/logger';
import { LRUCache } from 'lru-cache';

const _userCache = new LRUCache<string, User>({ max: 500, ttl: 30_000 });

export async function findUserById(userId: string): Promise<User | null> {
    const cached = _userCache.get(userId);
    if (cached) return cached;

    try {
        const pool = getPgPool();
        const result = await pool.query('SELECT * FROM fluxbase_global.users WHERE id = $1', [userId]);
        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        const user = {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            photo_url: row.photo_url,
            user_role: row.user_role || 'student',
            plan_type: row.plan_type || 'free',
            status: row.status || 'active',
            created_at: row.created_at.toISOString(),
        } as User;

        _userCache.set(userId, user);
        return user;
    } catch (error) {
        logger.error("Failed to fetch user:", error);
        return null;
    }
}


export async function deleteUserAccount(userId: string) {
    const pool = getPgPool();
    // 1. Get all user projects
    const result = await pool.query('SELECT project_id FROM fluxbase_global.projects WHERE user_id = $1', [userId]);

    // 2. Delete each project natively (Drop schema)
    for (const row of result.rows) {
        await pool.query(`DROP SCHEMA IF EXISTS "project_${row.project_id}" CASCADE`);
        await pool.query(`DROP SCHEMA IF EXISTS "flux_tenant_${row.project_id}" CASCADE`);
    }

    // 3. Delete user profile (Also remove projects from metadata table)
    await pool.query('DELETE FROM fluxbase_global.projects WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM fluxbase_global.users WHERE id = $1', [userId]);
}
