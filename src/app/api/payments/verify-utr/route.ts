import { NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getCurrentUserId } from '@/lib/auth';
import logger from '@/lib/logger';

export async function POST(req: Request) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { utr, plan, sessionId } = await req.json();

        const cleanPlan = (plan || '').toLowerCase();
        const cleanUtr = utr ? String(utr).trim() : null;

        const pool = getPgPool();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Fetch checkout session
            let sessionRecord: any = null;
            if (sessionId) {
                const sessRes = await client.query(
                    `SELECT id, amount, project_data, plan_type, status, created_at 
                     FROM fluxbase_global.payment_sessions 
                     WHERE id = $1 AND user_id = $2`,
                    [parseInt(sessionId, 10), userId]
                );
                if (sessRes.rows.length > 0) {
                    sessionRecord = sessRes.rows[0];
                }
            }

            if (!sessionRecord) {
                const sessRes = await client.query(
                    `SELECT id, amount, project_data, plan_type, status, created_at 
                     FROM fluxbase_global.payment_sessions 
                     WHERE user_id = $1 AND (status = 'pending' OR (status = 'expired' AND created_at >= NOW() - INTERVAL '30 minutes'))
                     ORDER BY created_at DESC LIMIT 1`,
                    [userId]
                );
                if (sessRes.rows.length > 0) {
                    sessionRecord = sessRes.rows[0];
                }
            }

            if (!sessionRecord) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'No active checkout session found.' }, { status: 404 });
            }

            const activeSessionId = sessionRecord.id;
            const sessionAmount = parseFloat(sessionRecord.amount);
            const targetPlan = sessionRecord.plan_type || cleanPlan || 'employee';

            // If session is already completed, return success immediately
            if (sessionRecord.status === 'completed') {
                await client.query('COMMIT');
                return NextResponse.json({
                    success: true,
                    message: 'Payment has already been confirmed and completed.',
                    sessionId: activeSessionId
                });
            }

            // 2. Check if a payment matching this exact decimal amount has arrived!
            // Priority 1: Check scraped_sms by exact decimal amount received AFTER session was created
            const scrapedQuery = await client.query(
                `SELECT id, amount, utr, sender, created_at 
                 FROM fluxbase_global.scraped_sms 
                 WHERE amount = $1 
                   AND (is_used IS FALSE OR is_used IS NULL)
                   AND created_at >= $2
                 ORDER BY created_at DESC LIMIT 1`,
                [sessionAmount, sessionRecord.created_at]
            );

            // Priority 2: If UTR was optionally provided, check bank_payments by UTR
            let bankQueryRows: any[] = [];
            if (cleanUtr) {
                const bRes = await client.query(
                    `SELECT utr, amount FROM fluxbase_global.bank_payments WHERE utr = $1`,
                    [cleanUtr]
                );
                bankQueryRows = bRes.rows;
            }

            const isMatched = scrapedQuery.rows.length > 0 || bankQueryRows.length > 0;

            if (!isMatched) {
                await client.query('ROLLBACK');
                return NextResponse.json({
                    error: `No payment of exact amount ₹${sessionAmount} detected yet. Please ensure you sent ₹${sessionAmount} and allow 15-30 seconds for SMS sync.`,
                    pending: true,
                    sessionAmount
                }, { status: 404 });
            }

            const matchedSms = scrapedQuery.rows[0];
            const finalUtr = cleanUtr || matchedSms?.utr || null;

            // 3. Complete payment session
            await client.query(
                `UPDATE fluxbase_global.payment_sessions 
                 SET status = 'completed' 
                 WHERE id = $1`,
                [activeSessionId]
            );

            if (matchedSms?.id) {
                await client.query(
                    `UPDATE fluxbase_global.scraped_sms SET is_used = true WHERE id = $1`,
                    [matchedSms.id]
                );
            }

            // 4. Record payment in fluxbase_global.payments
            await client.query(
                `INSERT INTO fluxbase_global.payments (user_id, amount, currency, status, razorpay_payment_id)
                 VALUES ($1, $2, 'INR', 'completed', $3)
                 ON CONFLICT DO NOTHING`,
                [userId, sessionAmount, finalUtr ? `utr_${finalUtr}` : `upi_session_${activeSessionId}`]
            );

            // 5. Upgrade user plan
            await client.query(
                `UPDATE fluxbase_global.users 
                 SET plan_type = $1, user_role = $1, billing_cycle_end = NOW() + INTERVAL '1 month', status = 'active'
                 WHERE id = $2`,
                [targetPlan, userId]
            );

            // 6. Auto-provision project if project_data was provided
            if (sessionRecord.project_data) {
                try {
                    const { createProject } = await import('@/lib/data');
                    const { TenantProvisioner } = await import('@/lib/tenant-engine');
                    const pData = typeof sessionRecord.project_data === 'string' ? JSON.parse(sessionRecord.project_data) : sessionRecord.project_data;
                    
                    const existingProjects = await client.query(
                        "SELECT project_id FROM fluxbase_global.projects WHERE user_id = $1::text AND display_name = $2",
                        [userId, pData.projectName || 'My Project']
                    );

                    if (existingProjects.rows.length === 0) {
                        const newProject = await createProject(
                            pData.projectName || 'My Project',
                            pData.workDescription || 'Provisioned upon payment confirmation',
                            pData.dialect || 'postgresql',
                            pData.timezone || 'UTC',
                            'internal',
                            {},
                            pData.userRole || targetPlan,
                            userId
                        );

                        await TenantProvisioner.createTenantSchema(newProject.project_id, pData.dialect || 'postgresql');
                        await client.query(
                            'UPDATE fluxbase_global.projects SET creator_role = $1 WHERE project_id = $2',
                            [pData.userRole || targetPlan, newProject.project_id]
                        );
                        logger.info(`[Verify Payment] Provisioned project ${newProject.project_id} for user ${userId}`);
                    }
                } catch (projErr) {
                    logger.error('[Verify Payment] Project provisioning error:', projErr);
                }
            }

            // 7. Live broadcast via Postgres NOTIFY
            try {
                const notifyPayload = JSON.stringify({
                    type: 'db_event',
                    payload: {
                        table: 'payment_sessions',
                        record: { id: activeSessionId, status: 'completed', amount: sessionAmount }
                    }
                });
                await client.query(`NOTIFY fluxbase_live, '${notifyPayload.replace(/'/g, "''")}'`);
            } catch (notifyErr) {
                logger.warn('[Verify Payment] NOTIFY warning:', notifyErr);
            }

            await client.query('COMMIT');
            logger.info(`[Verify Payment] Successfully verified payment for session ${activeSessionId} (₹${sessionAmount})!`);

            return NextResponse.json({
                success: true,
                message: 'Payment verified and confirmed successfully!',
                sessionId: activeSessionId,
                amount: sessionAmount,
                plan: targetPlan
            });

        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

    } catch (error: any) {
        logger.error('[Verify Payment Error]:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
