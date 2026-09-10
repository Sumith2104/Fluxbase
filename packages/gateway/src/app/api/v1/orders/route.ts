import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { allocateSlot, CapacityError } from '@/lib/slot-engine';
import { checkRateLimit } from '@/lib/rate-limiter';
import { generateOrderId } from '@/lib/utils';
import { redis } from '@/lib/redis';
import { logGatewayAudit } from '@/lib/audit';

function getGatewayBaseUrl(): string {
  let raw = process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.VERCEL_URL || 'https://payments.fluxbasedb.me';
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  return raw.replace(/\/+$/, '');
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate Merchant via API Key
    const authHeader = req.headers.get('authorization') || '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const apiKey = (apiKeyHeader || authHeader.replace(/^Bearer\s+/i, '')).trim();

    if (!apiKey.startsWith('sec_live_')) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing API key format (must start with sec_live_)' },
        { status: 401 }
      );
    }

    const pool = getPool();
    const merchantRes = await pool.query(
      `SELECT id, name, rate_limit_per_min, is_active 
       FROM merchants 
       WHERE api_key = $1`,
      [apiKey]
    );

    if (merchantRes.rows.length === 0 || !merchantRes.rows[0].is_active) {
      return NextResponse.json(
        { error: 'Unauthorized: Merchant not found or account is inactive' },
        { status: 401 }
      );
    }

    const merchant = merchantRes.rows[0];

    // 2. Sliding Window Rate Limiting
    const rateLimit = await checkRateLimit(merchant.id, merchant.rate_limit_per_min || 30);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: Too many order requests per minute' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const body = await req.json();
    let rawAmount = parseFloat(body.amount);

    if (isNaN(rawAmount) || rawAmount <= 0) {
      return NextResponse.json(
        { error: 'Validation Error: amount must be a positive number' },
        { status: 400 }
      );
    }

    let appliedCoupon: { code: string; discount: number; original_amount: number } | null = null;
    if (body.coupon_code) {
      const code = String(body.coupon_code).trim().toUpperCase();
      const couponRes = await pool.query(
        `SELECT * FROM coupons WHERE merchant_id = $1 AND code = $2 AND is_active = true`,
        [merchant.id, code]
      );
      if (couponRes.rows.length > 0) {
        const c = couponRes.rows[0];
        const minAmt = parseFloat(c.min_order_amount || '0');
        const isNotExpired = !c.expires_at || new Date(c.expires_at) >= new Date();
        const underLimit = !c.usage_limit || c.used_count < c.usage_limit;

        if (rawAmount >= minAmt && isNotExpired && underLimit) {
          let discount = 0;
          const val = parseFloat(c.discount_value);
          if (c.discount_type === 'percentage') {
            discount = (rawAmount * val) / 100;
            if (c.max_discount_amount) {
              discount = Math.min(discount, parseFloat(c.max_discount_amount));
            }
          } else {
            discount = Math.min(val, rawAmount);
          }
          discount = Math.round(discount * 100) / 100;
          const originalAmt = rawAmount;
          rawAmount = Math.max(1, Math.round((rawAmount - discount) * 100) / 100);
          appliedCoupon = { code: c.code, discount, original_amount: originalAmt };

          // Increment coupon used_count
          await pool.query(
            `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
            [c.id]
          );
        }
      }
    }

    const idempotencyKey = req.headers.get('idempotency-key') || body.idempotency_key || null;

    // 3. Idempotency Check
    if (idempotencyKey) {
      // Check Redis fast cache first
      const cached = await redis.get(`idem:${merchant.id}:${idempotencyKey}`);
      if (cached) {
        return NextResponse.json(cached, { status: 200 });
      }

      // Check database
      const existingOrder = await pool.query(
        `SELECT o.*, v.vpa_address 
         FROM orders o
         JOIN vpas v ON o.vpa_id = v.id
         WHERE o.merchant_id = $1 AND o.idempotency_key = $2`,
        [merchant.id, idempotencyKey]
      );

      if (existingOrder.rows.length > 0) {
        const o = existingOrder.rows[0];
        const baseUrl = getGatewayBaseUrl();
        const responseData = {
          success: true,
          order_id: o.id,
          order: {
            id: o.id,
            amount: o.base_amount,
            final_amount: parseFloat(o.final_amount),
            vpa: o.vpa_address,
            status: o.status,
            expires_at: o.expires_at,
          },
          checkout_url: `${baseUrl}/pay/${o.id}`,
          amount: o.base_amount,
          final_amount: parseFloat(o.final_amount),
          vpa: o.vpa_address,
          status: o.status,
          expires_at: o.expires_at,
        };
        return NextResponse.json(responseData, { status: 200 });
      }
    }

    // 4. Base Rupee Amount Normalization
    const baseAmount = Math.floor(rawAmount);
    const orderId = generateOrderId();

    // 5. Atomic Slot Allocation
    let slot;
    try {
      slot = await allocateSlot(baseAmount, orderId);
    } catch (slotErr) {
      if (slotErr instanceof CapacityError) {
        return NextResponse.json(
          { error: slotErr.message },
          { status: 429 }
        );
      }
      throw slotErr;
    }

    // 6. Persistence in PostgreSQL
    const expiresAt = new Date(Date.now() + 180 * 1000); // 3-minute (180-second) payment window
    const insertRes = await pool.query(
      `INSERT INTO orders (
          id, merchant_id, idempotency_key, base_amount, offset_cents, final_amount,
          vpa_id, tier, status, customer_name, customer_email, customer_phone,
          metadata, callback_url, merchant_webhook_url, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, final_amount, expires_at, status`,
      [
        orderId,
        merchant.id,
        idempotencyKey,
        baseAmount,
        slot.offsetCents,
        slot.finalAmount,
        slot.vpaId,
        slot.tier,
        body.customer_name || null,
        body.customer_email || null,
        body.customer_phone || null,
        JSON.stringify({ ...(body.metadata || {}), coupon: appliedCoupon }),
        body.callback_url || null,
        body.webhook_url || null,
        expiresAt,
      ]
    );

    logGatewayAudit({
      action: 'INSERT',
      statement: `INSERT INTO orders (id, final_amount, status, customer_name) VALUES ('${orderId}', ${slot.finalAmount}, 'pending', '${(body.customer_name || 'Customer').replace(/'/g, "''")}')`,
      metadata: { order_id: orderId, amount: slot.finalAmount, type: 'gateway_order' },
    }).catch(() => {});

    const baseUrl = getGatewayBaseUrl();
    const payload = {
      success: true,
      order_id: orderId,
      order: {
        id: orderId,
        amount: baseAmount,
        final_amount: slot.finalAmount,
        vpa: slot.vpaAddress,
        status: 'pending',
        coupon: appliedCoupon,
        expires_at: expiresAt.toISOString(),
      },
      checkout_url: `${baseUrl}/pay/${orderId}`,
      amount: baseAmount,
      final_amount: slot.finalAmount,
      vpa: slot.vpaAddress,
      tier: slot.tier,
      coupon: appliedCoupon,
      expires_at: expiresAt.toISOString(),
      status: 'pending',
    };

    // Cache idempotency response for 24h
    if (idempotencyKey) {
      await redis.set(`idem:${merchant.id}:${idempotencyKey}`, payload, { ex: 86400 });
    }

    return NextResponse.json(payload, { status: 201 });
  } catch (err: any) {
    console.error('[API Orders POST Error]:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal gateway error' },
      { status: 500 }
    );
  }
}
