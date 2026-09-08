import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { code, amount, merchant_id, link_id } = await req.json();
    const rawCode = String(code || '').trim().toUpperCase();
    const numAmount = parseFloat(amount);

    if (!rawCode) {
      return NextResponse.json({ valid: false, error: 'Coupon code is required' }, { status: 400 });
    }

    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ valid: false, error: 'Invalid order amount' }, { status: 400 });
    }

    const pool = getPool();
    let targetMerchantId = merchant_id;

    // If link_id provided, look up merchant_id
    if (!targetMerchantId && link_id) {
      const linkRes = await pool.query(
        `SELECT merchant_id FROM payment_links WHERE id = $1`,
        [link_id]
      );
      if (linkRes.rows.length > 0) {
        targetMerchantId = linkRes.rows[0].merchant_id;
      }
    }

    if (!targetMerchantId) {
      // Find coupon by code if only single merchant uses this code or default
      const anyRes = await pool.query(
        `SELECT * FROM coupons WHERE code = $1 AND is_active = true LIMIT 1`,
        [rawCode]
      );
      if (anyRes.rows.length === 0) {
        return NextResponse.json({ valid: false, error: 'Coupon not found or inactive' }, { status: 404 });
      }
      targetMerchantId = anyRes.rows[0].merchant_id;
    }

    const couponRes = await pool.query(
      `SELECT * FROM coupons 
       WHERE merchant_id = $1 AND code = $2 AND is_active = true`,
      [targetMerchantId, rawCode]
    );

    if (couponRes.rows.length === 0) {
      return NextResponse.json({ valid: false, error: 'Invalid or inactive coupon code' }, { status: 404 });
    }

    const coupon = couponRes.rows[0];

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: 'This coupon has expired' }, { status: 400 });
    }

    // Check usage limit
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return NextResponse.json({ valid: false, error: 'This coupon has reached its maximum usage limit' }, { status: 400 });
    }

    // Check minimum order amount
    const minAmount = parseFloat(coupon.min_order_amount || '0');
    if (numAmount < minAmount) {
      return NextResponse.json({
        valid: false,
        error: `Minimum order amount of ₹${minAmount.toFixed(2)} required for this coupon`,
      }, { status: 400 });
    }

    // Compute discount
    let discount = 0;
    const discountVal = parseFloat(coupon.discount_value);

    if (coupon.discount_type === 'percentage') {
      discount = (numAmount * discountVal) / 100;
      if (coupon.max_discount_amount) {
        const maxCap = parseFloat(coupon.max_discount_amount);
        if (discount > maxCap) {
          discount = maxCap;
        }
      }
    } else {
      // flat discount
      discount = Math.min(discountVal, numAmount);
    }

    // Round discount to 2 decimals
    discount = Math.round(discount * 100) / 100;
    const finalAmount = Math.max(1, Math.round((numAmount - discount) * 100) / 100);

    return NextResponse.json({
      valid: true,
      discount_amount: discount,
      final_amount: finalAmount,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: discountVal,
        min_order_amount: minAmount,
        max_discount_amount: coupon.max_discount_amount ? parseFloat(coupon.max_discount_amount) : null,
      },
    });
  } catch (err: any) {
    console.error('[Coupon Validation Error]:', err);
    return NextResponse.json({ valid: false, error: err.message }, { status: 500 });
  }
}
