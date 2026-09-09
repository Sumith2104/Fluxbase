import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getCurrentUserId } from '@/lib/auth';
import logger from '@/lib/logger';

function resolveAppUrl(req: NextRequest): string {
    const origin = req.headers.get('origin') || req.headers.get('referer') || '';
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        try {
            const u = new URL(origin);
            return `${u.protocol}//${u.host}`;
        } catch {}
    }
    return 'https://www.fluxbasedb.me';
}

export async function POST(req: NextRequest) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { 
            plan, 
            amount, 
            isDiscountApplied, 
            couponCode, 
            projectData,
            paymentLinkId,
            usePaymentLink,
            orderTitle,
            metadata
        } = body;
        
        let cleanPlan = 'pro';
        let basePrice = 500;
        const pool = getPgPool();

        // 1. If client app calculated the amount dynamically (e.g. Shopping App, custom tier, review page)
        let discountAlreadyDeducted = false;
        if (amount !== undefined && !isNaN(parseFloat(amount))) {
            basePrice = Math.max(1, Math.round(parseFloat(amount)));
            cleanPlan = plan ? String(plan).toLowerCase() : 'custom_order';
            discountAlreadyDeducted = true;
        } else {
            // Standard plan fallback
            const validPlans = ['pro', 'max', 'student_pro', 'student_max', 'employee', 'org_owner', 'org', 'pay_as_you_go'];
            if (!plan || !validPlans.includes(plan.toLowerCase())) {
                return NextResponse.json({ error: 'Invalid or missing plan type or amount' }, { status: 400 });
            }

            cleanPlan = plan.toLowerCase() === 'student_pro' ? 'pro' : 
                        plan.toLowerCase() === 'student_max' ? 'max' : 
                        plan.toLowerCase() === 'org' ? 'org_owner' : 
                        plan.toLowerCase();

            // Fetch exact plan from fluxbase_global.plans table
            const planRes = await pool.query(
                `SELECT plan_key, name, price 
                 FROM fluxbase_global.plans 
                 WHERE plan_key = $1 AND is_active = true 
                 LIMIT 1`,
                [cleanPlan]
            );

            if (cleanPlan === 'pay_as_you_go') {
                basePrice = 50; // Refundable verification fee
            } else if (planRes.rows.length > 0) {
                basePrice = parseFloat(planRes.rows[0].price);
            } else {
                if (cleanPlan === 'employee') basePrice = 500;
                if (cleanPlan === 'org_owner') basePrice = 5000;
                if (cleanPlan === 'pro') basePrice = 499;
                if (cleanPlan === 'max') basePrice = 1499;
            }
        }

        // 2. Fetch discount rate from fluxbase_global.discounts table if coupon was applied AND not already deducted
        if (isDiscountApplied && !discountAlreadyDeducted) {
            let discountPercentage = 20; // default 20%
            let flatDiscount = 0;

            if (couponCode) {
                const cleanCode = couponCode.trim().toUpperCase();
                let discRes = await pool.query(
                    `SELECT discount_type, discount_value, max_discount_amount 
                     FROM fluxbase_global.discounts 
                     WHERE UPPER(code) = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
                     LIMIT 1`,
                    [cleanCode]
                );

                if (discRes.rows.length > 0) {
                    const d = discRes.rows[0];
                    if (d.discount_type === 'percentage') {
                        discountPercentage = parseFloat(d.discount_value);
                    } else if (d.discount_type === 'fixed_amount') {
                        flatDiscount = parseFloat(d.discount_value);
                    }
                } else {
                    // Check Payments app merchant coupons
                    const tenantC = await pool.query(
                        `SELECT discount_type, discount_value, max_discount_amount 
                         FROM "flux_tenant_0e3d63b989b94d08".coupons 
                         WHERE UPPER(code) = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
                         LIMIT 1`,
                        [cleanCode]
                    );
                    if (tenantC.rows.length > 0) {
                        const tc = tenantC.rows[0];
                        if (tc.discount_type === 'percentage') {
                            discountPercentage = parseFloat(tc.discount_value);
                        } else if (tc.discount_type === 'flat' || tc.discount_type === 'fixed_amount') {
                            flatDiscount = parseFloat(tc.discount_value);
                        }
                    }
                }
            }

            if (flatDiscount > 0) {
                basePrice = Math.max(1, basePrice - flatDiscount);
            } else {
                basePrice = Math.max(1, Math.round(basePrice * (1 - discountPercentage / 100)));
            }
        }

        // Convert basePrice to integer to clear out any decimal parts
        basePrice = Math.floor(basePrice);

        // Fetch user information for order creation
        const userRes = await pool.query(
            `SELECT email, display_name FROM fluxbase_global.users WHERE id = $1 LIMIT 1`,
            [userId]
        );
        const user = userRes.rows[0] || {};

        // 3. Create placeholder session in database
        const insertSessionQuery = await pool.query(
            `INSERT INTO fluxbase_global.payment_sessions (user_id, plan_type, amount, status, expires_at, project_data)
             VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '3 minutes', $4)
             RETURNING id`,
            [userId, cleanPlan, basePrice, projectData ? JSON.stringify(projectData) : null]
        );
        const session = insertSessionQuery.rows[0];

        // 3.5. Payment Links are OPTIONAL:
        // Use a payment link ONLY if explicitly requested (e.g. paymentLinkId provided or usePaymentLink: true).
        // For shopping apps (1,000,000+ items) and dynamic tiers, calculations are done client-side.
        if (paymentLinkId || usePaymentLink) {
            try {
                let pLink: any = null;
                if (paymentLinkId) {
                    const linkRes = await pool.query(
                        `SELECT id, title, amount 
                         FROM flux_tenant_0e3d63b989b94d08.payment_links 
                         WHERE id = $1 AND is_active = true 
                         LIMIT 1`,
                        [paymentLinkId]
                    );
                    if (linkRes.rows.length > 0) pLink = linkRes.rows[0];
                } else if (usePaymentLink) {
                    const planKeyword = cleanPlan === 'pay_as_you_go' ? 'pay' : cleanPlan.replace('_', ' ');
                    const linkRes = await pool.query(
                        `SELECT id, title, amount 
                         FROM flux_tenant_0e3d63b989b94d08.payment_links 
                         WHERE is_active = true 
                           AND (
                             LOWER(title) LIKE '%' || $1 || '%' 
                             OR ROUND(amount) = ROUND($2::numeric)
                           )
                         ORDER BY created_at DESC 
                         LIMIT 1`,
                        [planKeyword, basePrice]
                    );
                    if (linkRes.rows.length > 0) pLink = linkRes.rows[0];
                }

                if (pLink) {
                    const gatewayUrl = process.env.FLUXPAY_GATEWAY_URL || 'https://payments.fluxbasedb.me';
                    const appUrl = resolveAppUrl(req);
                    const linkCheckoutUrl = `${gatewayUrl}/pay/link/${pLink.id}?userId=${userId}&email=${encodeURIComponent(user.email || '')}&name=${encodeURIComponent(user.display_name || '')}&plan=${cleanPlan}&callbackUrl=${encodeURIComponent(`${appUrl}/checkout?sessionId=${session.id}`)}`;

                    logger.info(`[Create Session] Explicit Payment Link routed: ${pLink.id} (₹${pLink.amount})`);

                    await pool.query(
                        `UPDATE fluxbase_global.payment_sessions 
                         SET amount = $1, fluxpay_checkout_url = $2 
                         WHERE id = $3`,
                        [parseFloat(pLink.amount), linkCheckoutUrl, session.id]
                    );

                    return NextResponse.json({
                        success: true,
                        sessionId: session.id,
                        paymentLinkId: pLink.id,
                        amount: parseFloat(pLink.amount),
                        checkoutUrl: linkCheckoutUrl,
                        planType: cleanPlan,
                        isPaymentLink: true
                    });
                }
            } catch (linkErr) {
                logger.warn('[Create Session] Error querying payment_links, falling back to dynamic order:', linkErr);
            }
        }

        // 4. Default / Dynamic Path: Calculate amount in client app & generate FluxPay order
        let fluxpayOrderId: string | null = null;
        let finalAmount = basePrice;
        let vpa = '918310870493@waaxis';
        let checkoutUrl: string | null = null;
        let expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();

        try {
            const { createFluxPayOrder } = await import('@/lib/fluxpay-client');
            const appUrl = resolveAppUrl(req);
            const orderLabel = orderTitle || `${cleanPlan.toUpperCase()} TIER`;
            const fluxpayRes = await createFluxPayOrder({
                amount: basePrice,
                couponCode: discountAlreadyDeducted ? undefined : (isDiscountApplied ? couponCode : undefined),
                customerName: user.display_name || 'Fluxbase Customer',
                customerEmail: user.email || undefined,
                callbackUrl: `${appUrl}/checkout?sessionId=${session.id}`,
                metadata: {
                    sessionId: session.id,
                    userId,
                    plan: cleanPlan,
                    plan_name: orderLabel,
                    projectData,
                    ...(metadata || {})
                }
            });

            fluxpayOrderId = fluxpayRes.orderId;
            finalAmount = fluxpayRes.finalAmount;
            vpa = fluxpayRes.vpa;
            checkoutUrl = fluxpayRes.checkoutUrl;
            expiresAt = fluxpayRes.expiresAt;

            logger.info(`[Create Session] FluxPay order created: ${fluxpayOrderId}, VPA: ${vpa}, Amount: ₹${finalAmount}`);
        } catch (fpErr: any) {
            logger.warn('[Create Session] FluxPay gateway call error, falling back to local allocation:', fpErr?.message);
            // Fallback: local decimal offset calculation
            finalAmount = parseFloat((basePrice + 0.14).toFixed(2));
        }

        if (checkoutUrl) {
            let normalized = String(checkoutUrl).trim();
            if (normalized.startsWith('//')) {
                normalized = `https:${normalized}`;
            } else if (normalized.startsWith('/')) {
                const gw = (process.env.FLUXPAY_GATEWAY_URL || 'https://payments.fluxbasedb.me').replace(/\/+$/, '');
                normalized = `${gw}${normalized}`;
            } else if (!/^https?:\/\//i.test(normalized)) {
                normalized = `https://${normalized}`;
            }
            checkoutUrl = normalized;
        }

        // 5. Update session with FluxPay details
        await pool.query(
            `UPDATE fluxbase_global.payment_sessions 
             SET amount = $1, fluxpay_order_id = $2, fluxpay_vpa = $3, fluxpay_checkout_url = $4 
             WHERE id = $5`,
            [finalAmount, fluxpayOrderId, vpa, checkoutUrl, session.id]
        );

        return NextResponse.json({
            success: true,
            sessionId: session.id,
            orderId: fluxpayOrderId,
            amount: finalAmount,
            vpa,
            checkoutUrl,
            expiresAt,
            planType: cleanPlan
        });

    } catch (err: any) {
        logger.error('[Create Payment Session API Error]:', err);
        return NextResponse.json({
            error: 'Failed to initialize payment session.'
        }, { status: 500 });
    }
}
export const dynamic = 'force-dynamic';
