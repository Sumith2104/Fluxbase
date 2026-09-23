import { getPgPool } from '@/lib/pg';
import { redis } from '@/lib/redis';
import logger from '@/lib/logger';
import type { Modality, Provider } from './config';

export interface AiUsageRecord {
  userId: string;
  projectId?: string;
  modelId: string;
  modality: Modality;
  provider: Provider;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  status?: 'success' | 'error' | 'rate_limited';
  costEstimate?: number;
  metadata?: Record<string, any>;
}

let _tableEnsured = false;

/**
 * Ensures the ai_usage_log and ai_media tables exist in fluxbase_global schema
 */
export async function ensureAiTablesExist(): Promise<void> {
  if (_tableEnsured) return;
  try {
    const pool = getPgPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fluxbase_global.ai_usage_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       TEXT NOT NULL,
        project_id    TEXT,
        model_id      TEXT NOT NULL,
        modality      TEXT NOT NULL,
        provider      TEXT NOT NULL,
        input_tokens  INT DEFAULT 0,
        output_tokens INT DEFAULT 0,
        latency_ms    INT DEFAULT 0,
        status        TEXT DEFAULT 'success',
        cost_estimate DECIMAL(10,6) DEFAULT 0,
        metadata      JSONB DEFAULT '{}',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON fluxbase_global.ai_usage_log (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_modality ON fluxbase_global.ai_usage_log (modality, created_at DESC);

      CREATE TABLE IF NOT EXISTS fluxbase_global.ai_media (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        project_id  TEXT,
        media_type  TEXT NOT NULL,
        s3_key      TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        file_size   BIGINT DEFAULT 0,
        model_id    TEXT NOT NULL,
        prompt      TEXT,
        metadata    JSONB DEFAULT '{}',
        expires_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ai_media_user ON fluxbase_global.ai_media (user_id, created_at DESC);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    logger.warn('[AiLedger] Ensure AI tables warning:', err?.message || err);
  }
}

/**
 * Calculates estimated cost for analytics
 */
export function estimateCost(
  modality: Modality, 
  inputTokens: number = 0, 
  outputTokens: number = 0,
  modelId?: string
): number {
  if (modality === 'embedding' || (modality as string) === 'embeddings') {
    // Amazon Titan Embeddings V2: $0.02 per 1M tokens ($0.00002 / 1k tokens)
    return Number(((inputTokens / 1_000_000) * 0.02).toFixed(6));
  }
  if (modality === 'image') return 0.02; // $0.02 per generated image
  if (modality === 'video') return 0.10; // $0.10 per video clip
  if (modality === 'audio-stt') return 0.006; // $0.006 per minute
  if (modality === 'audio-tts') return 0.015; // $0.015 per 1000 chars

  // Text models pricing
  const m = (modelId || '').toLowerCase();
  let promptPer1M = 0.15;
  let completionPer1M = 0.60;

  if (m.includes('nova-pro') || m.includes('ultra') || m.includes('gpt-4o')) {
    promptPer1M = 0.80;
    completionPer1M = 3.20;
  } else if (m.includes('nova-micro')) {
    promptPer1M = 0.035;
    completionPer1M = 0.14;
  } else if (m.includes('nova-lite')) {
    promptPer1M = 0.06;
    completionPer1M = 0.24;
  } else if (m.includes('titan-embed') || m.includes('embed')) {
    return Number(((inputTokens / 1_000_000) * 0.02).toFixed(6));
  }

  const promptCost = (inputTokens / 1_000_000) * promptPer1M;
  const completionCost = (outputTokens / 1_000_000) * completionPer1M;
  const total = promptCost + completionCost;

  if (total === 0 && (inputTokens > 0 || outputTokens > 0)) {
    return 0.000001;
  }
  return Number(total.toFixed(6));
}

/**
 * Persists an AI request record to PostgreSQL and updates live Redis meters
 */
export async function recordAiUsage(record: AiUsageRecord): Promise<void> {
  // Fire and forget asynchronously so client response latency is not blocked
  setImmediate(async () => {
    try {
      await ensureAiTablesExist();
      const pool = getPgPool();
      const cost = record.costEstimate ?? estimateCost(record.modality, record.inputTokens, record.outputTokens, record.modelId);

      await pool.query(
        `INSERT INTO fluxbase_global.ai_usage_log 
         (user_id, project_id, model_id, modality, provider, input_tokens, output_tokens, latency_ms, status, cost_estimate, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          record.userId,
          record.projectId || null,
          record.modelId,
          record.modality,
          record.provider,
          record.inputTokens || 0,
          record.outputTokens || 0,
          record.latencyMs || 0,
          record.status || 'success',
          cost,
          JSON.stringify(record.metadata || {}),
        ]
      );

      // Hourly Redis rollup for real-time dashboards
      const hourKey = `ai_stats:${record.userId}:${new Date().toISOString().slice(0, 13)}`;
      try {
        await (redis as any).hincrby(hourKey, 'total_requests', 1);
        await (redis as any).hincrby(hourKey, `${record.modality}_requests`, 1);
        await (redis as any).hincrby(hourKey, 'total_tokens', (record.inputTokens || 0) + (record.outputTokens || 0));
        await (redis as any).expire(hourKey, 86400 * 7); // 7-day retention
      } catch {}
    } catch (err: any) {
      logger.error('[AiLedger] Failed to persist AI usage record:', err?.message || err);
    }
  });
}
