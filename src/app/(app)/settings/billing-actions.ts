'use server';

import { getCurrentUserId } from '@/lib/auth';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';
import { LRUCache } from 'lru-cache';

const _billingCache = new LRUCache<string, BillingDetails>({ max: 500, ttl: 2 * 60 * 1000 }); // 2-min cache

export interface BillingDetails {
    plan: string;
    role?: string;
    billing_cycle_end: string | null;
    status: string;
    queriesUsed: number;
    queriesLimit: number;
    storageUsedGb: number;
    storageLimitGb: number;
    unbilledAmount: number;
    invoices: Array<{
        id: string;
        amount: number;
        plan: string;
        status: string;
        date: string;
        transactionId: string;
    }>;
}

export async function getUserPlanAction() {
    const userId = await getCurrentUserId();
    if (!userId) return { plan: 'free', role: 'student', billing_cycle_end: null, status: 'active' };

    try {
        const pool = getPgPool();
        const { rows } = await pool.query(
            'SELECT plan_type as "planType", billing_cycle_end as "billingCycleEnd", status, user_role as "userRole" FROM fluxbase_global.users WHERE id = $1::text',
            [userId]
        );

        if (rows.length > 0) {
            return {
                plan: rows[0].planType || 'free',
                role: rows[0].userRole || rows[0].planType || 'student',
                billing_cycle_end: rows[0].billingCycleEnd,
                status: rows[0].status || 'active'
            };
        }
        return { plan: 'free', role: 'student', billing_cycle_end: null, status: 'active' };
    } catch (error) {
        logger.error('[Billing] Failed to fetch user plan:', error);
        return { plan: 'free', role: 'student', billing_cycle_end: null, status: 'active' };
    }
}

export async function getBillingDetailsAction(showTestPayments: boolean = false): Promise<{ success: boolean; data?: BillingDetails; error?: string }> {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: 'Unauthorized' };

    const cacheKey = `${userId}:${showTestPayments ? 'all' : 'live'}`;
    const cached = _billingCache.get(cacheKey);
    if (cached) {
        return { success: true, data: cached };
    }

    try {
        const pool = getPgPool();
        
        // 1. Fetch user & subscription info
        const userRes = await pool.query(
            'SELECT plan_type as "planType", billing_cycle_end as "billingCycleEnd", status, user_role as "userRole" FROM fluxbase_global.users WHERE id = $1::text',
            [userId]
        );
        const userRow = userRes.rows[0] || {};
        const plan = (userRow.planType || 'free').toLowerCase();
        const role = userRow.userRole || userRow.planType || 'student';

        // 2. Fetch payments history
        let invoices: BillingDetails['invoices'] = [];
        try {
            const filterClause = showTestPayments
                ? ''
                : "AND NOT (p.amount <= 2.5 AND (p.razorpay_payment_id LIKE 'upi_session_%' OR p.razorpay_payment_id LIKE 'upi_utr_%' OR p.razorpay_payment_id LIKE 'utr_%'))";

            const paymentsRes = await pool.query(
                `SELECT 
                    p.id, 
                    p.amount, 
                    p.currency, 
                    p.status, 
                    p.created_at as "createdAt", 
                    p.razorpay_payment_id as "paymentId",
                    ps.plan_type as "sessionPlan"
                 FROM fluxbase_global.payments p
                 LEFT JOIN fluxbase_global.payment_sessions ps 
                    ON p.razorpay_payment_id = CONCAT('upi_session_', ps.id::text)
                 WHERE p.user_id = $1::text 
                 ${filterClause}
                 ORDER BY p.created_at DESC LIMIT 50`,
                [userId]
            );
            invoices = paymentsRes.rows.map(r => {
                const amt = parseFloat(r.amount) || 0;
                let label = r.sessionPlan 
                    ? `${r.sessionPlan.replace(/_/g, ' ').toUpperCase()} Plan` 
                    : 'Payment';
                if (amt <= 2.5 && (r.paymentId || '').match(/^(upi_session_|upi_utr_|utr_)/)) {
                    label = 'UPI Test / Verification';
                }
                return {
                    id: r.id.toString(),
                    amount: amt,
                    plan: label,
                    status: r.status || 'paid',
                    date: new Date(r.createdAt).toLocaleDateString(),
                    transactionId: r.paymentId || `TXN_${r.id}`
                };
            });
        } catch (payErr) {
            logger.warn('[Billing] Error fetching payments history:', payErr);
        }

        // 3. Auto-initialize any active projects missing an active PAYG cycle
        try {
            const missingCycles = await pool.query(`
                SELECT p.project_id 
                FROM fluxbase_global.projects p
                LEFT JOIN fluxbase_global.payg_usage_cycles c 
                    ON p.project_id = c.project_id AND c.status = 'active'
                WHERE p.user_id = $1::text AND p.status = 'active' AND c.id IS NULL
            `, [userId]);

            if (missingCycles.rows.length > 0) {
                const { getOrCreateCurrentCycle } = await import('@/lib/payg-engine');
                for (const mRow of missingCycles.rows) {
                    try {
                        await getOrCreateCurrentCycle(mRow.project_id, userId);
                    } catch (mErr) {
                        logger.warn(`[Billing] Auto-init cycle failed for ${mRow.project_id}:`, mErr);
                    }
                }
            }
        } catch (missingErr) {
            logger.warn('[Billing] Error checking missing project cycles:', missingErr);
        }

        // 4. Compute limits based on active tier / plan
        let queriesLimit = 50000;
        let storageLimitGb = 0.5;

        if (role === 'org_owner' || plan === 'org_owner' || plan === 'org') {
            queriesLimit = 5000000;
            storageLimitGb = 100;
        } else if (role === 'employee' || plan === 'employee') {
            queriesLimit = 500000;
            storageLimitGb = 10;
        } else if (plan === 'max') {
            queriesLimit = 1000000;
            storageLimitGb = 20;
        } else if (plan === 'pro') {
            queriesLimit = 250000;
            storageLimitGb = 5;
        } else if (plan === 'pay_as_you_go' || plan === 'payg') {
            queriesLimit = 50000;
            storageLimitGb = 0.1;
        }

        // 5. Fetch aggregated real usage from indexed payg_usage_cycles (instant, avoids multi-million audit_logs scan)
        let queriesUsed = 0;
        let storageUsedGb = 0;
        let unbilledAmount = 0;

        try {
            const paygRes = await pool.query(`
                SELECT 
                    COALESCE(SUM(total_requests::bigint), 0) as total_requests,
                    COALESCE(SUM(storage_mb::numeric), 0) as total_storage_mb,
                    COALESCE(SUM(calculated_amount::numeric), 0) as unbilled_amount
                FROM fluxbase_global.payg_usage_cycles 
                WHERE user_id = $1::text AND status = 'active'
            `, [userId]);

            if (paygRes.rows.length > 0) {
                queriesUsed = parseInt(paygRes.rows[0].total_requests, 10) || 0;
                const totalMb = parseFloat(paygRes.rows[0].total_storage_mb) || 0;
                storageUsedGb = Number((totalMb / 1024).toFixed(3));

                const isPayg = plan === 'pay_as_you_go' || plan === 'payg';
                const queryRatePer10k = (role === 'org_owner' || plan === 'org_owner') ? 2.00 : 0.50;
                const storageRatePerGb = (role === 'org_owner' || plan === 'org_owner') ? 15.00 : 5.00;

                if (isPayg) {
                    // For PAYG users, bill comes directly from the calculated amounts of active cycles
                    unbilledAmount = Number(parseFloat(paygRes.rows[0].unbilled_amount || '0').toFixed(2));
                } else {
                    // For subscription tiers (org_owner, employee, max, pro, free), the base plan
                    // includes full quota up to queriesLimit and storageLimitGb.
                    // Overage is ONLY billed when total usage strictly exceeds their plan limit.
                    unbilledAmount = 0;
                    if (queriesUsed > queriesLimit) {
                        const excessQueries = queriesUsed - queriesLimit;
                        unbilledAmount += Math.ceil(excessQueries / 10000) * queryRatePer10k;
                    }
                    if (storageUsedGb > storageLimitGb) {
                        const excessStorage = storageUsedGb - storageLimitGb;
                        unbilledAmount += excessStorage * storageRatePerGb;
                    }
                    unbilledAmount = Number(unbilledAmount.toFixed(2));
                }
            }
        } catch (paygErr) {
            logger.warn('[Billing] Error reading payg_usage_cycles:', paygErr);
        }

        const resultData: BillingDetails = {
            plan,
            role,
            billing_cycle_end: userRow.billingCycleEnd || null,
            status: userRow.status || 'active',
            queriesUsed,
            queriesLimit,
            storageUsedGb,
            storageLimitGb,
            unbilledAmount,
            invoices
        };

        _billingCache.set(cacheKey, resultData);

        return {
            success: true,
            data: resultData
        };

    } catch (err: any) {
        logger.error('[Billing] Error fetching billing details:', err);
        return { success: false, error: err.message };
    }
}
