import { NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export async function GET() {
    try {
        const pool = getPgPool();

        // 1. Fetch active plans ordered by sort_order
        const plansRes = await pool.query(
            `SELECT plan_key, name, description, category, price, billing_interval, 
                    max_projects, storage_bytes, requests_limit, max_connections, features, is_active
             FROM fluxbase_global.plans 
             WHERE is_active = true 
             ORDER BY sort_order ASC`
        );

        // 2. Fetch active discounts / promo codes
        const discountsRes = await pool.query(
            `SELECT code, description, discount_type, discount_value, applicable_plans, 
                    min_order_amount, max_discount_amount, is_active, expires_at
             FROM fluxbase_global.discounts 
             WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY id ASC`
        );


        const plans = plansRes.rows.map(row => ({
            planKey: row.plan_key,
            name: row.name,
            description: row.description,
            category: row.category,
            price: parseFloat(row.price),
            billingInterval: row.billing_interval,
            maxProjects: row.max_projects,
            storageBytes: parseInt(row.storage_bytes, 10),
            requestsLimit: row.requests_limit,
            maxConnections: row.max_connections,
            features: Array.isArray(row.features) ? row.features : JSON.parse(row.features || '[]')
        }));

        const discounts = discountsRes.rows.map(row => ({
            code: row.code,
            description: row.description,
            discountType: row.discount_type,
            discountValue: parseFloat(row.discount_value),
            applicablePlans: Array.isArray(row.applicable_plans) ? row.applicable_plans : JSON.parse(row.applicable_plans || '["all"]'),
            minOrderAmount: parseFloat(row.min_order_amount || '0'),
            maxDiscountAmount: parseFloat(row.max_discount_amount || '1000')
        }));

        // Backwards compatibility mappings for older frontend consumers
        const proPlan = plans.find(p => p.planKey === 'pro');
        const maxPlan = plans.find(p => p.planKey === 'max');
        const primaryDiscount = discounts[0];

        const proPrice = proPlan ? proPlan.price : 499;
        const maxPrice = maxPlan ? maxPlan.price : 1499;
        const discountPercentage = primaryDiscount?.discountType === 'percentage' ? primaryDiscount.discountValue : 20;

        const discountProPrice = Math.round(proPrice * (1 - discountPercentage / 100));
        const discountMaxPrice = Math.round(maxPrice * (1 - discountPercentage / 100));

        return NextResponse.json({
            success: true,
            plans,
            discounts,
            pricing: {
                proPrice,
                maxPrice,
                discountProPrice,
                discountMaxPrice,
                enableDiscount: discounts.length > 0,
                discountCode: primaryDiscount?.code || 'FLUX20'
            }
        });
    } catch (err: any) {
        logger.error('[Pricing Config API Error]:', err);
        return NextResponse.json({
            success: false,
            error: 'Internal server error occurred while retrieving plans and discount configurations.'
        }, { status: 500 });
    }
}
export const dynamic = 'force-dynamic';
