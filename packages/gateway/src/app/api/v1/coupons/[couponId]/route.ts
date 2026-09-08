import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';

async function getMerchant(req: NextRequest) {
  const sessionMerchant = await getSessionMerchant();
  if (sessionMerchant) return sessionMerchant;

  const authHeader = req.headers.get('authorization') || req.headers.get('x-api-key') || '';
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (apiKey.startsWith('sec_live_')) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM merchants WHERE api_key = $1 AND is_active = true`,
      [apiKey]
    );
    if (res.rows.length > 0) return res.rows[0];
  }

  return null;
}

// PATCH: Toggle active status or update coupon
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ couponId: string }> }
) {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { couponId } = await params;
    const body = await req.json();
    const pool = getPool();

    // Check ownership
    const existing = await pool.query(
      `SELECT * FROM coupons WHERE id = $1 AND merchant_id = $2`,
      [couponId, merchant.id]
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
    }

    let updatedIsActive = existing.rows[0].is_active;
    if (typeof body.is_active === 'boolean') {
      updatedIsActive = body.is_active;
    }

    const updateRes = await pool.query(
      `UPDATE coupons 
       SET is_active = $1 
       WHERE id = $2 AND merchant_id = $3
       RETURNING *`,
      [updatedIsActive, couponId, merchant.id]
    );

    return NextResponse.json({ success: true, coupon: updateRes.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Remove coupon
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ couponId: string }> }
) {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { couponId } = await params;
    const pool = getPool();

    const deleteRes = await pool.query(
      `DELETE FROM coupons WHERE id = $1 AND merchant_id = $2 RETURNING id`,
      [couponId, merchant.id]
    );

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Coupon deleted successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
