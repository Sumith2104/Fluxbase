import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export async function POST(req: NextRequest) {
    try {
        const { code, planKey, orderAmount } = await req.json();

        if (!code || typeof code !== 'string' || !code.trim()) {
            return NextResponse.json({
                success: false,
                error: 'Please enter a coupon code.'
            }, { status: 400 });
        }

        const pool = getPgPool();
        const cleanCode = code.trim().toUpperCase();
        const cleanPlan = (planKey || '').toLowerCase();
        const numericAmount = typeof orderAmount === 'number' ? orderAmount : parseFloat(orderAmount || '0');

        // 1. Query coupon directly from fluxbase_global.discounts
        let result = await pool.query(
            `SELECT id, code, description, discount_type, discount_value, applicable_plans, 
                    min_order_amount, max_discount_amount, is_active, expires_at
             FROM fluxbase_global.discounts 
             WHERE UPPER(code) = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1`,
            [cleanCode]
        );

        let discount: any = null;

        if (result.rows.length > 0) {
            discount = result.rows[0];
        } else {
            // 2. Fallback: Check coupons table in Payments app (FluxPay merchant schema)
            const tenantCouponRes = await pool.query(
                `SELECT id, code, discount_type, discount_value, min_order_amount, 
                        max_discount_amount, is_active, expires_at, usage_limit, used_count
                 FROM "flux_tenant_0e3d63b989b94d08".coupons 
                 WHERE UPPER(code) = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())
                   AND (usage_limit IS NULL OR used_count < usage_limit)
                 LIMIT 1`,
                [cleanCode]
            );

            if (tenantCouponRes.rows.length > 0) {
                const tc = tenantCouponRes.rows[0];
                discount = {
                    id: tc.id,
                    code: tc.code,
                    description: `${tc.code} Promotional Discount`,
                    discount_type: tc.discount_type === 'flat' ? 'fixed_amount' : tc.discount_type,
                    discount_value: tc.discount_value,
                    applicable_plans: ['all'],
                    min_order_amount: tc.min_order_amount || '0',
                    max_discount_amount: tc.max_discount_amount || '999999',
                    is_active: tc.is_active,
                    expires_at: tc.expires_at,
                };
            }
        }

        if (!discount) {
            return NextResponse.json({
                success: false,
                error: 'The coupon code entered is invalid or inactive.'
            }, { status: 404 });
        }

        const applicablePlans: string[] = Array.isArray(discount.applicable_plans) 
            ? discount.applicable_plans 
            : JSON.parse(discount.applicable_plans || '["all"]');

        const normalizedPlan = cleanPlan === 'student_pro' ? 'pro' : 
                               cleanPlan === 'student_max' ? 'max' : 
                               cleanPlan === 'org' ? 'org_owner' : 
                               cleanPlan;

        // Check if applicable to current plan
        if (!applicablePlans.includes('all') && cleanPlan && !applicablePlans.includes(cleanPlan) && !applicablePlans.includes(normalizedPlan)) {
            return NextResponse.json({
                success: false,
                error: `This coupon is not valid for the ${cleanPlan.toUpperCase()} plan.`
            }, { status: 400 });
        }

        const minOrder = parseFloat(discount.min_order_amount || '0');
        if (numericAmount > 0 && numericAmount < minOrder) {
            return NextResponse.json({
                success: false,
                error: `This coupon requires a minimum order amount of Rs.${minOrder}.`
            }, { status: 400 });
        }

        const discountVal = parseFloat(discount.discount_value);
        const maxDiscount = parseFloat(discount.max_discount_amount || '999999');

        let calculatedDiscount = 0;
        if (discount.discount_type === 'percentage') {
            calculatedDiscount = Math.round((numericAmount * discountVal) / 100);
            calculatedDiscount = Math.min(calculatedDiscount, maxDiscount);
        } else if (discount.discount_type === 'fixed_amount') {
            calculatedDiscount = Math.min(discountVal, numericAmount);
        }

        const finalPrice = Math.max(1, numericAmount - calculatedDiscount);

        return NextResponse.json({
            success: true,
            discount: {
                id: discount.id,
                code: discount.code,
                description: discount.description,
                discountType: discount.discount_type,
                discountValue: discountVal,
                discountAmount: calculatedDiscount,
                finalPrice
            }
        });

    } catch (err: any) {
        logger.error('[Verify Coupon API Error]:', err);
        return NextResponse.json({
            success: false,
            error: 'Server error verifying coupon.'
        }, { status: 500 });
    }
}
export const dynamic = 'force-dynamic';
