import { getPgPool } from '@/lib/pg';
import { randomBytes, createHash } from 'crypto';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';

export interface ApiKey {
    id: string; // The document ID (which is the hash of the key)
    userId: string; // Stored as user_id
    name: string;
    projectId?: string; // Stored as project_id
    projectName?: string; // Stored as project_name
    scopes: string[]; // Stored as scopes (JSONB)
    preview: string;
    createdAt: string; // Stored as created_at
    lastUsedAt?: string; // Stored as last_used_at
}

export interface CreateApiKeyResult {
    key: string;
    apiKeyData: ApiKey;
}

export async function generateApiKey(userId: string, name: string, projectId?: string, projectName?: string, scopes: string[] = ['read']): Promise<CreateApiKeyResult> {
    const rawKey = 'fl_' + randomBytes(24).toString('hex');
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const preview = `${rawKey.substring(0, 7)}...${rawKey.substring(rawKey.length - 4)}`;

    const pool = getPgPool();
    await pool.query(
        `INSERT INTO fluxbase_global.api_keys (id, user_id, name, project_id, project_name, preview, scopes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hash, userId, name, projectId || null, projectName || null, preview, JSON.stringify(scopes)]
    );

    const apiKeyData: ApiKey = {
        id: hash,
        userId,
        name,
        preview,
        createdAt: new Date().toISOString(),
        projectId,
        projectName,
        scopes
    };

    return { key: rawKey, apiKeyData };
}

export async function validateApiKey(rawKey: string): Promise<{ userId: string, projectId?: string, scopes: string[] } | null> {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const redisKey = `val_api_key:${hash}`;

    try {
        const cached = await redis.get<any>(redisKey);
        if (cached) {
            // Async update last used (non-blocking)
            const pool = getPgPool();
            pool.query('UPDATE fluxbase_global.api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [hash]).catch(err =>
                logger.error('Failed to update API key stats:', err)
            );
            return cached;
        }
    } catch (e) {
        logger.warn('[Redis Error] validateApiKey cache read failed:', e);
    }

    const pool = getPgPool();
    const result = await pool.query('SELECT user_id, project_id, scopes FROM fluxbase_global.api_keys WHERE id = $1', [hash]);

    if (result.rows.length === 0) return null;

    const apiKeyInfo = {
        userId: result.rows[0].user_id,
        projectId: result.rows[0].project_id || undefined,
        scopes: result.rows[0].scopes || ['read']
    };

    try {
        await redis.set(redisKey, apiKeyInfo, { ex: 300 }); // Cache in Redis for 5 minutes
    } catch (e) {
        logger.warn('[Redis Error] validateApiKey cache write failed:', e);
    }

    // Async update last used
    pool.query('UPDATE fluxbase_global.api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [hash]).catch(err =>
        logger.error('Failed to update API key stats:', err)
    );

    return apiKeyInfo;
}

export async function listApiKeys(userId: string, projectId?: string): Promise<ApiKey[]> {
    const pool = getPgPool();
    let query = 'SELECT * FROM fluxbase_global.api_keys WHERE user_id = $1';
    const params: any[] = [userId];

    if (projectId && projectId !== 'global') {
        query += ' AND (project_id = $2 OR project_id IS NULL OR project_id = \'global\')';
        params.push(projectId);
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);

    return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        projectId: row.project_id,
        projectName: row.project_name,
        scopes: row.scopes || ['read'],
        preview: row.preview,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined
    }));
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
    const pool = getPgPool();
    const result = await pool.query('DELETE FROM fluxbase_global.api_keys WHERE id = $1 AND user_id = $2 RETURNING id', [keyId, userId]);

    if (result.rowCount === 0) {
        throw new Error("Key not found or unauthorized");
    }

    // Invalidate Redis cache
    const redisKey = `val_api_key:${keyId}`;
    try {
        await redis.del(redisKey);
    } catch (e) {
        logger.warn('[Redis Error] revokeApiKey cache delete failed:', e);
    }
}
