import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = await params;
    const { coupon_code } = await req.json();

    if (!coupon_code || typeof coupon_code !== 'string') {
      return NextResponse.json({ error: 'Coupon code is required' }, { status: 400 });
    }

    const pool = getPool();
    const orderRes = await pool.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const order = orderRes.rows[0];
    if (order.status !== 'pending') {
      return NextResponse.json({ error: `Cannot apply coupon: order is ${order.status}` }, { status: 400 });
    }

    const metadata = typeof order.metadata === 'string' ? JSON.parse(order.metadata) : (order.metadata || {});
    
    // Check if coupon already applied
    if (metadata.coupon) {
      return NextResponse.json({ error: `Coupon ${metadata.coupon.code} is already applied` }, { status: 400 });
    }

    // Original base amount before any discounts
    const originalBase = parseFloat(order.base_amount);
    const offsetCents = parseInt(order.offset_cents || '0', 10);

    // Look up coupon
    const code = coupon_code.trim().toUpperCase();
    const couponRes = await pool.query(
      `SELECT * FROM coupons 
       WHERE merchant_id = $1 AND code = $2 AND is_active = true`,
      [order.merchant_id, code]
    );

    if (couponRes.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or inactive coupon code' }, { status: 404 });
    }

    const coupon = couponRes.rows[0];
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Coupon has expired' }, { status: 400 });
    }

    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return NextResponse.json({ error: 'Coupon usage limit has been reached' }, { status: 400 });
    }

    const minAmount = parseFloat(coupon.min_order_amount || '0');
    if (originalBase < minAmount) {
      return NextResponse.json(
        { error: `Minimum order amount for this coupon is ₹${minAmount.toFixed(2)}` },
        { status: 400 }
      );
    }

    let discount = 0;
    const val = parseFloat(coupon.discount_value);
    if (coupon.discount_type === 'percentage') {
      discount = (originalBase * val) / 100;
      if (coupon.max_discount_amount) {
        discount = Math.min(discount, parseFloat(coupon.max_discount_amount));
      }
    } else {
      discount = Math.min(val, originalBase);
    }
    discount = Math.round(discount * 100) / 100;

    const newBase = Math.max(1, Math.round(originalBase - discount));
    const newFinal = parseFloat((newBase + offsetCents / 100).toFixed(2));

    const updatedMetadata = {
      ...metadata,
      coupon: {
        code: coupon.code,
        discount,
        original_amount: originalBase,
      }
    };

    // Update order
    await pool.query(
      `UPDATE orders 
       SET base_amount = $1, final_amount = $2, metadata = $3 
       WHERE id = $4`,
      [newBase, newFinal, JSON.stringify(updatedMetadata), orderId]
    );

    // Increment coupon used_count
    await pool.query(
      `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
      [coupon.id]
    );

    // Keep fluxbase_global.payment_sessions synchronized with the discounted amount
    if (metadata?.sessionId) {
      await pool.query(
        `UPDATE fluxbase_global.payment_sessions SET amount = $1 WHERE id = $2`,
        [newFinal, parseInt(metadata.sessionId, 10)]
      ).catch((err) => console.warn('[Apply Coupon] Failed to sync session amount:', err?.message));
    }

    return NextResponse.json({
      success: true,
      base_amount: newBase,
      final_amount: newFinal,
      discount_amount: discount,
      coupon: {
        code: coupon.code,
        discount,
        original_amount: originalBase,
      }
    });

  } catch (err: any) {
    console.error('[Apply Coupon Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to apply coupon' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { orderId } = await params;
    const pool = getPool();

    const orderRes = await pool.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const order = orderRes.rows[0];
    if (order.status !== 'pending') {
      return NextResponse.json({ error: 'Cannot remove coupon from non-pending order' }, { status: 400 });
    }

    const metadata = typeof order.metadata === 'string' ? JSON.parse(order.metadata) : (order.metadata || {});
    if (!metadata.coupon) {
      return NextResponse.json({ error: 'No coupon currently applied' }, { status: 400 });
    }

    const originalBase = Math.round(parseFloat(metadata.coupon.original_amount || order.base_amount));
    const offsetCents = parseInt(order.offset_cents || '0', 10);
    const couponCode = metadata.coupon.code;

    const restoredFinal = parseFloat((originalBase + offsetCents / 100).toFixed(2));

    const updatedMetadata = { ...metadata };
    delete updatedMetadata.coupon;

    await pool.query(
      `UPDATE orders 
       SET base_amount = $1, final_amount = $2, metadata = $3 
       WHERE id = $4`,
      [originalBase, restoredFinal, JSON.stringify(updatedMetadata), orderId]
    );

    // Decrement coupon used_count
    await pool.query(
      `UPDATE coupons SET used_count = GREATEST(0, used_count - 1) 
       WHERE merchant_id = $1 AND code = $2`,
      [order.merchant_id, couponCode]
    );

    // Restore fluxbase_global.payment_sessions amount
    if (metadata?.sessionId) {
      await pool.query(
        `UPDATE fluxbase_global.payment_sessions SET amount = $1 WHERE id = $2`,
        [restoredFinal, parseInt(metadata.sessionId, 10)]
      ).catch((err) => console.warn('[Remove Coupon] Failed to sync session amount:', err?.message));
    }

    return NextResponse.json({
      success: true,
      base_amount: originalBase,
      final_amount: restoredFinal,
    });
  } catch (err: any) {
    console.error('[Remove Coupon Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to remove coupon' }, { status: 500 });
  }
}
