import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getCurrentUserId } from '@/lib/auth';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(req.url);
        const sessionId = searchParams.get('sessionId');

        if (!sessionId) {
            return NextResponse.json({ error: 'Missing sessionId parameter' }, { status: 400 });
        }

        const pool = getPgPool();

        // Query status of the session, ensuring it belongs to the authenticated user
        const result = await pool.query(
            `SELECT status, expires_at, amount, plan_type, fluxpay_vpa, fluxpay_order_id, fluxpay_checkout_url 
             FROM fluxbase_global.payment_sessions 
             WHERE id = $1 AND user_id = $2`,
            [parseInt(sessionId, 10), userId]
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
        }

        const session = result.rows[0];
        let status = session.status;

        // If the session is still pending but has passed its expiration time, mark it expired
        if (status === 'pending' && new Date() > new Date(session.expires_at)) {
            status = 'expired';
            await pool.query(
                `UPDATE fluxbase_global.payment_sessions 
                 SET status = 'expired' 
                 WHERE id = $1`,
                [parseInt(sessionId, 10)]
            );
        }

        const upiMerchantVpa = session.fluxpay_vpa || '918310870493@waaxis';

        return NextResponse.json({
            success: true,
            status,
            amount: parseFloat(session.amount),
            planType: session.plan_type,
            expiresAt: session.expires_at,
            upiMerchantVpa,
            orderId: session.fluxpay_order_id,
            checkoutUrl: session.fluxpay_checkout_url
        });

    } catch (error: any) {
        logger.error('[Check Session Error]:', error);
        return NextResponse.json({ error: 'Internal server error occurred while checking status.' }, { status: 500 });
    }
}
