import { NextResponse } from 'next/server';
import { getRazorpayWebhookSecret, validateRazorpaySignature } from '@/lib/razorpay';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export async function POST(req: Request) {
    const bodyText = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const secret = getRazorpayWebhookSecret();

    if (!signature || !validateRazorpaySignature(bodyText, signature, secret)) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    try {
        const event = JSON.parse(bodyText);

        if (event.event === 'subscription.charged' || event.event === 'subscription.authenticated') {
            const subscription = event.payload.subscription.entity;
            const customerId = subscription.customer_id;
            const status = subscription.status;

            // Razorpay uses UNIX timestamps in seconds
            const currentEnd = new Date(subscription.current_end * 1000);

            // Map plan ID to Free/Pro/Max
            const razorpayPlanId = subscription.plan_id;
            let planType = 'free';
            if (razorpayPlanId === process.env.RAZORPAY_PRO_PLAN_ID) planType = 'pro';
            if (razorpayPlanId === process.env.RAZORPAY_MAX_PLAN_ID) planType = 'max';

            const pool = getPgPool();

            // The metadata User ID MUST be embedded in 'notes' during frontend checkout creation
            const userId = subscription.notes?.user_id;

            if (userId && (status === 'active' || status === 'authenticated')) {
                await pool.query(`
                    UPDATE fluxbase_global.users 
                    SET plan_type = $1, user_role = $1, razorpay_customer_id = $2, razorpay_subscription_id = $3, billing_cycle_end = $4
                    WHERE id = $5
                `, [planType, customerId, subscription.id, currentEnd.toISOString(), userId]);

                logger.info(`[Billing] Upgrade successful. User: ${userId} -> ${planType.toUpperCase()} Tier.`);
            }
        }

        return NextResponse.json({ success: true, received: true });
    } catch (err: any) {
        logger.error('[Billing] Webhook processing failed:', err);
        return NextResponse.json({ error: 'Internal server error processing webhook' }, { status: 500 });
    }
}
