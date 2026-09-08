import { getPool } from './db';
import { releaseSlot } from './slot-engine';
import { executeDeliveryAttempt } from './webhook-dispatcher';

declare global {
  var _gatewayWorkersStarted: boolean | undefined;
}

export async function cleanupExpiredOrders(): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const expiredRes = await client.query(
      `UPDATE orders
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()
       RETURNING id, vpa_id, base_amount, offset_cents, (SELECT vpa_address FROM vpas WHERE id = vpa_id) as vpa_address`
    );

    for (const row of expiredRes.rows) {
      if (row.vpa_address) {
        await releaseSlot(row.vpa_address, row.base_amount, row.offset_cents, row.vpa_id);
      }
    }

    await client.query('COMMIT');
    return expiredRes.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Workers] Expiry cleanup error:', err);
    return 0;
  } finally {
    client.release();
  }
}

export async function retryPendingWebhooks(): Promise<number> {
  const pool = getPool();

  try {
    const pendingRes = await pool.query(
      `SELECT id, url, payload, signature, attempts
       FROM webhook_deliveries
       WHERE status IN ('pending', 'failed')
         AND next_retry_at <= NOW()
         AND attempts < max_attempts
       LIMIT 10
       FOR UPDATE SKIP LOCKED`
    );

    if (pendingRes.rows.length === 0) return 0;

    let processed = 0;
    for (const delivery of pendingRes.rows) {
      const timestamp = Math.floor(Date.now() / 1000);
      await executeDeliveryAttempt(
        delivery.id,
        delivery.url,
        delivery.payload,
        delivery.signature,
        timestamp,
        delivery.attempts
      );
      processed++;
    }

    return processed;
  } catch (err) {
    console.error('[Workers] Webhook retry worker error:', err);
    return 0;
  }
}

export function startWorkers(): void {
  if (global._gatewayWorkersStarted) return;
  global._gatewayWorkersStarted = true;

  console.log('[Gateway Workers] Starting background timers...');

  // 1. Expiry cleanup interval (every 10 seconds)
  setInterval(async () => {
    try {
      const cleaned = await cleanupExpiredOrders();
      if (cleaned > 0) {
        console.log(`[Gateway Workers] Cleaned ${cleaned} expired payment slots.`);
      }
    } catch (err) {
      console.error('[Gateway Workers] Expiry cycle warning:', err);
    }
  }, 10000);

  // 2. Webhook retry interval (every 15 seconds)
  setInterval(async () => {
    try {
      await retryPendingWebhooks();
    } catch (err) {
      console.error('[Gateway Workers] Retry cycle warning:', err);
    }
  }, 15000);
}
