import { getPool } from './db';
import { computeHmac } from './utils';
import { logGatewayAudit } from './audit';

const RETRY_DELAYS_SECONDS = [0, 30, 120, 600, 3600]; // immediate, 30s, 2m, 10m, 1h

export async function dispatchWebhook(orderId: string): Promise<boolean> {
  const pool = getPool();

  const orderRes = await pool.query(
    `SELECT o.*, m.webhook_url as merchant_default_webhook, m.webhook_secret
     FROM orders o
     JOIN merchants m ON o.merchant_id = m.id
     WHERE o.id = $1`,
    [orderId]
  );

  if (orderRes.rows.length === 0) return false;
  const order = orderRes.rows[0];

  const destinationUrl = order.merchant_webhook_url || order.merchant_default_webhook;
  if (!destinationUrl) {
    console.log(`[Webhook Dispatcher] No webhook URL configured for order ${orderId}`);
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = {
    event: 'payment.succeeded',
    order_id: order.id,
    amount: parseFloat(order.final_amount),
    base_amount: order.base_amount,
    utr: order.utr,
    paid_at: order.paid_at,
    customer: {
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
    },
    metadata: order.metadata || {},
  };

  const payloadString = JSON.stringify(payload);
  const secret = order.webhook_secret || 'whsec_default';
  const signature = computeHmac(secret, `${timestamp}.${payloadString}`);

  // Insert initial delivery log
  const deliveryInsert = await pool.query(
    `INSERT INTO webhook_deliveries (
        order_id, merchant_id, url, payload, signature, status, attempts, next_retry_at
     ) VALUES ($1, $2, $3, $4, $5, 'pending', 0, NOW())
     RETURNING id`,
    [order.id, order.merchant_id, destinationUrl, payload, signature]
  );

  const deliveryId = deliveryInsert.rows[0].id;

  // Attempt immediate delivery
  return await executeDeliveryAttempt(deliveryId, destinationUrl, payload, signature, timestamp, 0);
}

export async function executeDeliveryAttempt(
  deliveryId: string,
  url: string,
  payload: any,
  signature: string,
  timestamp: number,
  currentAttempts: number
): Promise<boolean> {
  const pool = getPool();
  const nextAttempt = currentAttempts + 1;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FluxPay-Webhook/1.0',
        'X-FluxPay-Signature': `t=${timestamp},v1=${signature}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (response.ok) {
      await pool.query(
        `UPDATE webhook_deliveries 
         SET status = 'delivered', attempts = $1, last_attempt_at = NOW(), next_retry_at = NULL 
         WHERE id = $2`,
        [nextAttempt, deliveryId]
      );

      logGatewayAudit({
        action: 'POST',
        statement: `POST webhook delivery to merchant for order ${payload?.order_id}`,
        metadata: { delivery_id: deliveryId, order_id: payload?.order_id, type: 'gateway_webhook' },
      }).catch(() => {});

      return true;
    }

    throw new Error(`HTTP Status ${response.status}: ${response.statusText}`);
  } catch (err: any) {
    const isExhausted = nextAttempt >= 5;
    const nextDelay = RETRY_DELAYS_SECONDS[nextAttempt] || 3600;

    await pool.query(
      `UPDATE webhook_deliveries 
       SET status = $1, 
           attempts = $2, 
           last_attempt_at = NOW(), 
           next_retry_at = NOW() + ($3 || ' seconds')::INTERVAL, 
           last_error = $4 
       WHERE id = $5`,
      [
        isExhausted ? 'exhausted' : 'failed',
        nextAttempt,
        nextDelay,
        err?.message || 'Network error',
        deliveryId,
      ]
    );

    return false;
  }
}
