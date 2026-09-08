import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const pool = getPool();

    const orderRes = await pool.query(
      `SELECT o.id, o.base_amount, o.offset_cents, o.final_amount, o.status,
              o.customer_name, o.customer_email, o.customer_phone, o.metadata,
              o.callback_url, o.utr, o.expires_at, o.paid_at, o.created_at,
              v.vpa_address, v.label as vpa_label, COALESCE(m.business_name, m.name) as merchant_name
       FROM orders o
       JOIN vpas v ON o.vpa_id = v.id
       JOIN merchants m ON o.merchant_id = m.id
       WHERE o.id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const o = orderRes.rows[0];

    // Check if expired
    let status = o.status;
    if (status === 'pending' && new Date(o.expires_at).getTime() < Date.now()) {
      status = 'expired';
    }

    const orderData = {
      id: o.id,
      order_id: o.id,
      merchant: o.merchant_name,
      amount: o.base_amount,
      final_amount: parseFloat(o.final_amount),
      vpa: o.vpa_address,
      status,
      utr: o.utr,
      expires_at: o.expires_at,
      paid_at: o.paid_at,
      callback_url: o.callback_url,
      metadata: o.metadata,
    };

    return NextResponse.json({
      ...orderData,
      order: orderData,
    });
  } catch (err: any) {
    console.error('[API Order GET Error]:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal server error', stack: err?.stack },
      { status: 500 }
    );
  }
}
