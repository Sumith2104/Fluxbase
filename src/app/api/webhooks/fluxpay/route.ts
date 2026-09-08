import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { verifyFluxPayWebhookSignature } from '@/lib/fluxpay-client';
import realtimeManager from '@/lib/realtime-manager';
import logger from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-fluxpay-signature');

    // 1. Verify HMAC Signature
    const isValid = verifyFluxPayWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn('[FluxPay Webhook] Invalid signature rejected');
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    logger.info(`[FluxPay Webhook] Received event: ${event.event} for order: ${event.order_id}`);

    if (event.event !== 'payment.succeeded') {
      return NextResponse.json({ received: true, ignored: true });
    }

    const { order_id, amount, utr, metadata } = event;
    const pool = getPgPool();

    const sessionId = metadata?.sessionId;
    const userId = metadata?.userId;
    const plan = metadata?.plan || 'pro';
    const projectData = metadata?.projectData;

    // 2. Mark payment session as completed in fluxbase_global.payment_sessions
    if (sessionId) {
      await pool.query(
        `UPDATE fluxbase_global.payment_sessions 
         SET status = 'completed', utr = $1, fluxpay_order_id = $2 
         WHERE id = $3`,
        [utr || null, order_id, parseInt(sessionId, 10)]
      );
    } else if (order_id) {
      await pool.query(
        `UPDATE fluxbase_global.payment_sessions 
         SET status = 'completed', utr = $1 
         WHERE fluxpay_order_id = $2`,
        [utr || null, order_id]
      );
    }

    // 3. Upgrade User Plan in fluxbase_global.users
    if (userId) {
      const cleanPlan = plan === 'student_max' ? 'max' : plan === 'student_pro' ? 'pro' : plan;
      await pool.query(
        `UPDATE fluxbase_global.users 
         SET plan_type = $1, updated_at = NOW() 
         WHERE id = $2`,
        [cleanPlan, userId]
      );
      logger.info(`[FluxPay Webhook] User ${userId} upgraded to plan: ${cleanPlan}`);
    }

    // 4. Record bank payment into fluxbase_global.bank_payments
    if (utr) {
      try {
        await pool.query(
          `INSERT INTO fluxbase_global.bank_payments (
              utr, amount, day_name, payment_date, payment_time, source, order_id
           ) VALUES (
              $1, $2, TO_CHAR(NOW(), 'Day'), CURRENT_DATE, CURRENT_TIME, 'fluxpay_gateway', $3
           ) ON CONFLICT (utr) DO NOTHING`,
          [utr, amount, order_id]
        );
      } catch (err) {
        logger.warn('[FluxPay Webhook] Bank payment recording skipped:', err);
      }
    }

    // 5. Broadcast real-time completion event to active browser clients
    try {
      realtimeManager.emit('payment_completed', {
        sessionId,
        orderId: order_id,
        amount,
        utr,
        plan,
        projectData,
      });
    } catch (wsErr) {
      logger.warn('[FluxPay Webhook] Realtime broadcast error:', wsErr);
    }

    return NextResponse.json({
      success: true,
      message: `Payment for order ${order_id} reconciled and user upgraded.`,
    });
  } catch (err: any) {
    logger.error('[FluxPay Webhook Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
