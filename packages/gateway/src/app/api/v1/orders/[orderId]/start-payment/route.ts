import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { redis } from '@/lib/redis';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const pool = getPool();

    // Fetch order
    const orderRes = await pool.query(
      `SELECT o.id, o.status, o.base_amount, o.offset_cents, o.vpa_id, o.metadata, v.vpa_address
       FROM orders o
       JOIN vpas v ON o.vpa_id = v.id
       WHERE o.id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const order = orderRes.rows[0];
    if (order.status !== 'pending') {
      return NextResponse.json({ success: true, status: order.status });
    }

    // Set a fresh 3-minute (180-second) window from the moment user begins payment
    const expiresAt = new Date(Date.now() + 180 * 1000);

    await pool.query(
      `UPDATE orders 
       SET expires_at = $1 
       WHERE id = $2`,
      [expiresAt, orderId]
    );

    // Refresh Redis slot TTL to 180 seconds
    const slotKey = `slot:${order.vpa_address}:${order.base_amount}:${order.offset_cents}`;
    await redis.expire(slotKey, 180).catch(() => {});

    // Sync session in fluxbase_global if sessionId present
    const meta = typeof order.metadata === 'string' ? JSON.parse(order.metadata) : (order.metadata || {});
    if (meta?.sessionId) {
      await pool.query(
        `UPDATE fluxbase_global.payment_sessions 
         SET expires_at = $1 
         WHERE id = $2`,
        [expiresAt, parseInt(meta.sessionId, 10)]
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      expires_at: expiresAt.toISOString(),
      remaining_seconds: 180,
    });
  } catch (err: any) {
    console.error('[Start Payment Error]:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to start payment window' },
      { status: 500 }
    );
  }
}
