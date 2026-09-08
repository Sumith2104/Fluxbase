import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';

async function getMerchant(req: NextRequest) {
  // Check session cookie first
  const sessionMerchant = await getSessionMerchant();
  if (sessionMerchant) return sessionMerchant;

  // Check API Key
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

// GET: List all coupons for merchant
export async function GET(req: NextRequest) {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM coupons 
       WHERE merchant_id = $1 
       ORDER BY created_at DESC`,
      [merchant.id]
    );

    return NextResponse.json({ success: true, coupons: res.rows });
  } catch (err: any) {
    console.error('[API Coupons GET Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Create a new coupon
export async function POST(req: NextRequest) {
  try {
    const merchant = await getMerchant(req);
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const rawCode = String(body.code || '').trim().toUpperCase();
    const discountType = body.discount_type === 'flat' ? 'flat' : 'percentage';
    const discountValue = parseFloat(body.discount_value);
    const minOrderAmount = parseFloat(body.min_order_amount || '0');
    const maxDiscountAmount = body.max_discount_amount ? parseFloat(body.max_discount_amount) : null;
    const usageLimit = body.usage_limit ? parseInt(body.usage_limit, 10) : null;
    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;

    if (!rawCode || rawCode.length < 2) {
      return NextResponse.json({ error: 'Coupon code must be at least 2 characters' }, { status: 400 });
    }

    if (isNaN(discountValue) || discountValue <= 0) {
      return NextResponse.json({ error: 'Discount value must be a positive number' }, { status: 400 });
    }

    if (discountType === 'percentage' && discountValue > 100) {
      return NextResponse.json({ error: 'Percentage discount cannot exceed 100%' }, { status: 400 });
    }

    const pool = getPool();

    // Check if code already exists for this merchant
    const existing = await pool.query(
      `SELECT id FROM coupons WHERE merchant_id = $1 AND code = $2`,
      [merchant.id, rawCode]
    );

    if (existing.rows.length > 0) {
      return NextResponse.json({ error: `Coupon code '${rawCode}' already exists` }, { status: 409 });
    }

    const insertRes = await pool.query(
      `INSERT INTO coupons (
        merchant_id, code, discount_type, discount_value,
        min_order_amount, max_discount_amount, usage_limit,
        is_active, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
      RETURNING *`,
      [
        merchant.id,
        rawCode,
        discountType,
        discountValue,
        minOrderAmount,
        maxDiscountAmount,
        usageLimit,
        expiresAt,
      ]
    );

    return NextResponse.json({ success: true, coupon: insertRes.rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error('[API Coupons POST Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
