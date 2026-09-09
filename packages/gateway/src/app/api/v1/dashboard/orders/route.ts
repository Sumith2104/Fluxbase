import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { generateOrderId } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const merchant = await getSessionMerchant();
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const status = (searchParams.get('status') || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    const pool = getPool();
    const params: any[] = [merchant.id];
    let queryStr = `
      SELECT o.id, o.base_amount, o.offset_cents, o.final_amount, o.status,
             o.customer_name, o.customer_email, o.customer_phone, o.utr,
             o.expires_at, o.paid_at, o.created_at, o.metadata,
             v.vpa_address
      FROM orders o
      LEFT JOIN vpas v ON o.vpa_id = v.id
      WHERE o.merchant_id = $1
    `;

    if (status && status !== 'all') {
      params.push(status);
      queryStr += ` AND o.status = $${params.length}`;
    }

    if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      queryStr += ` AND (
        LOWER(o.id) LIKE $${idx} OR
        LOWER(COALESCE(o.customer_name, '')) LIKE $${idx} OR
        LOWER(COALESCE(o.customer_email, '')) LIKE $${idx} OR
        LOWER(COALESCE(o.utr, '')) LIKE $${idx}
      )`;
    }

    queryStr += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const res = await pool.query(queryStr, params);

    return NextResponse.json({
      success: true,
      orders: res.rows,
    });
  } catch (err: any) {
    console.error('[Dashboard Orders GET Error]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchant = await getSessionMerchant();
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const baseAmount = parseFloat(body.base_amount || body.amount || '0');
    if (isNaN(baseAmount) || baseAmount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const finalAmount = parseFloat(body.final_amount || baseAmount.toFixed(2));
    const offsetCents = Math.round((finalAmount - baseAmount) * 100);
    const status = (body.status || 'pending').toLowerCase();
    const customerName = (body.customer_name || '').trim() || null;
    const customerEmail = (body.customer_email || '').trim() || null;
    const customerPhone = (body.customer_phone || '').trim() || null;
    const utr = (body.utr || '').trim() || null;

    const pool = getPool();

    // Get an active VPA
    let vpaRes = await pool.query(
      `SELECT id, vpa_address FROM vpas WHERE is_active = true ORDER BY current_load ASC LIMIT 1`
    );
    if (vpaRes.rows.length === 0) {
      vpaRes = await pool.query(`SELECT id, vpa_address FROM vpas LIMIT 1`);
    }
    const vpaId = vpaRes.rows[0]?.id;
    if (!vpaId) {
      return NextResponse.json({ error: 'No active UPI VPA configured' }, { status: 500 });
    }

    const orderId = (body.id || generateOrderId()).trim();
    const paidAt = status === 'paid' ? new Date().toISOString() : null;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const insertRes = await pool.query(
      `INSERT INTO orders (
        id, merchant_id, base_amount, offset_cents, final_amount,
        vpa_id, status, customer_name, customer_email, customer_phone,
        utr, expires_at, paid_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        orderId,
        merchant.id,
        Math.floor(baseAmount),
        offsetCents,
        finalAmount,
        vpaId,
        status,
        customerName,
        customerEmail,
        customerPhone,
        utr,
        expiresAt,
        paidAt,
        JSON.stringify({ source: 'manual_dashboard_record' }),
      ]
    );

    if (status === 'paid') {
      await pool.query(
        `UPDATE merchants
         SET balance = balance + $1,
             total_earned = total_earned + $1
         WHERE id = $2`,
        [baseAmount, merchant.id]
      );
    }

    return NextResponse.json({
      success: true,
      order: insertRes.rows[0],
    });
  } catch (err: any) {
    console.error('[Dashboard Orders POST Error]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
