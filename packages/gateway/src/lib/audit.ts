import { getPool } from './db';
import { redis } from './redis';

const DEFAULT_PROJECT_ID = process.env.FLUXPAY_PROJECT_ID || '0e3d63b989b94d08';
const DEFAULT_USER_ID = process.env.FLUXPAY_USER_ID || '0b282f76-c6a7-45ec-bca2-aadf1a03622f';

export interface GatewayAuditParams {
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT' | 'POST';
  statement: string;
  durationMs?: number;
  metadata?: Record<string, any>;
  success?: boolean;
  error?: string | null;
  projectId?: string;
  userId?: string;
}

export async function logGatewayAudit({
  action,
  statement,
  durationMs = 12.0,
  metadata = {},
  success = true,
  error = null,
  projectId = DEFAULT_PROJECT_ID,
  userId = DEFAULT_USER_ID,
}: GatewayAuditParams): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO fluxbase_global.audit_logs 
       (project_id, user_id, action, statement, duration_ms, success, error, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [projectId, userId, action, statement, durationMs, success, error, JSON.stringify(metadata)]
    );

    // Invalidate Redis analytics caches for this project so the dashboard picks it up immediately
    try {
      await redis.del(`analytics_stats_${projectId}`);
      await redis.del(`project_history_${projectId}`);
    } catch {}
  } catch (err: any) {
    console.warn('[Gateway Audit Log Warning]:', err?.message || err);
  }
}
