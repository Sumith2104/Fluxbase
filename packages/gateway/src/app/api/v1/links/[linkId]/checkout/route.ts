import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { allocateSlot } from '@/lib/slot-engine';
import { generateOrderId } from '@/lib/utils';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
) {
  try {
    const { linkId } = await params;
    const body = await req.json().catch(() => ({}));
    const pool = getPool();

    const linkRes = await pool.query(
      `SELECT l.*, COALESCE(m.business_name, m.name) as merchant_name, m.webhook_url as merchant_webhook_url 
       FROM payment_links l
       JOIN merchants m ON l.merchant_id = m.id
       WHERE l.id = $1 AND l.is_active = true`,
      [linkId]
    );

    if (linkRes.rows.length === 0) {
      return NextResponse.json({ error: 'Payment link not found or inactive' }, { status: 404 });
    }

    const link = linkRes.rows[0];
    let orderAmount = parseFloat(link.amount);
    let appliedCoupon: any = null;

    // Check if coupon code provided
    if (body.coupon_code) {
      const code = String(body.coupon_code).trim().toUpperCase();
      const couponRes = await pool.query(
        `SELECT * FROM coupons 
         WHERE merchant_id = $1 AND code = $2 AND is_active = true`,
        [link.merchant_id, code]
      );

      if (couponRes.rows.length > 0) {
        const c = couponRes.rows[0];
        const minAmt = parseFloat(c.min_order_amount || '0');
        const isNotExpired = !c.expires_at || new Date(c.expires_at) >= new Date();
        const underLimit = !c.usage_limit || c.used_count < c.usage_limit;

        if (orderAmount >= minAmt && isNotExpired && underLimit) {
          let discount = 0;
          const val = parseFloat(c.discount_value);
          if (c.discount_type === 'percentage') {
            discount = (orderAmount * val) / 100;
            if (c.max_discount_amount) {
              discount = Math.min(discount, parseFloat(c.max_discount_amount));
            }
          } else {
            discount = Math.min(val, orderAmount);
          }
          discount = Math.round(discount * 100) / 100;
          const originalAmt = orderAmount;
          orderAmount = Math.max(1, Math.round((orderAmount - discount) * 100) / 100);
          appliedCoupon = { code: c.code, discount, original_amount: originalAmt };

          // Increment coupon used count
          await pool.query(
            `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
            [c.id]
          );
        }
      }
    }

    const baseAmount = Math.floor(orderAmount);
    const orderId = generateOrderId();
    const slot = await allocateSlot(baseAmount, orderId);
    const expiresAt = new Date(Date.now() + 90 * 1000);

    const callbackUrl = body.callback_url || null;
    const webhookUrl = body.webhook_url || link.merchant_webhook_url || null;
    const metadataObj = {
      ...(body.metadata || {}),
      link_id: link.id,
      title: link.title,
      coupon: appliedCoupon,
      userId: body.user_id || body.userId || undefined,
      plan: body.plan || (link.title?.toLowerCase().includes('pro') ? 'pro' : link.title?.toLowerCase().includes('employee') ? 'employee' : 'pro'),
    };

    await pool.query(
      `INSERT INTO orders (
          id, merchant_id, base_amount, offset_cents, final_amount,
          vpa_id, tier, status, customer_name, customer_email, customer_phone,
          metadata, callback_url, webhook_url, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14)`,
      [
        orderId,
        link.merchant_id,
        baseAmount,
        slot.offsetCents,
        slot.finalAmount,
        slot.vpaId,
        slot.tier,
        body.customer_name || null,
        body.customer_email || null,
        body.customer_phone || null,
        JSON.stringify(metadataObj),
        callbackUrl,
        webhookUrl,
        expiresAt,
      ]
    );

    let rawBase = process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.VERCEL_URL || 'https://payments.fluxbasedb.me';
    if (!/^https?:\/\//i.test(rawBase)) {
      rawBase = `https://${rawBase}`;
    }
    const baseUrl = rawBase.replace(/\/+$/, '');

    return NextResponse.json({
      success: true,
      order_id: orderId,
      checkout_url: `${baseUrl}/pay/${orderId}`,
    });
  } catch (err: any) {
    console.error('[Link Checkout Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
