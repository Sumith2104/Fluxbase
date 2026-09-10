import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

const SMS_WEBHOOK_SECRET = process.env.SMS_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET;

if (!SMS_WEBHOOK_SECRET) {
    console.error('[SMS Webhook] SMS_WEBHOOK_SECRET env var is not set. All requests will be rejected.');
}

export async function POST(req: NextRequest) {
    try {
        if (!SMS_WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
        }

        const authHeader = req.headers.get('Authorization');
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim();
        if (!token || (token !== SMS_WEBHOOK_SECRET && token !== process.env.PAYMENT_WEBHOOK_SECRET)) {
            logger.warn(`[SMS Webhook] Unauthorized request.`);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let bodyJson: any = {};
        try {
            bodyJson = await req.json();
        } catch {
            const raw = await req.text();
            bodyJson = { body: raw, sender: 'SMS/Notification' };
        }

        const body = (bodyJson.body || bodyJson.message || bodyJson.text || '').trim();
        const sender = bodyJson.sender || bodyJson.source || 'SMS';

        if (!body) {
            return NextResponse.json({ error: 'Missing body or message' }, { status: 400 });
        }

        const smsText = body.toLowerCase();
        
        // 1. Ensure it's an incoming credit/payment notification
        const isCredit = 
            smsText.includes('credited') || 
            smsText.includes('received') || 
            smsText.includes('deposited') || 
            smsText.includes('added to') || 
            smsText.includes('accepted') ||
            smsText.includes('sent') ||
            smsText.includes('paid');

        if (!isCredit) {
            logger.info(`[SMS Webhook] Ignored non-credit SMS: "${body}"`);
            return NextResponse.json({ success: false, message: 'Ignored non-credit notification' });
        }

        // 2. Extract Amount using robust multi-pattern fallback
        const amountMatch = 
            body.match(/(?:sent|amount of|credited with|credited|received|payment\s+of|deposited)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
            body.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
            body.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i) ||
            body.match(/([\d,]+(?:\.\d{1,2})?)\s*[^0-9]*?(?:credited|received|deposited|sent)/i) ||
            body.match(/([\d]+\.\d{2})/);

        if (!amountMatch) {
            logger.warn(`[SMS Webhook] Could not parse amount from SMS: "${body}"`);
            return NextResponse.json({ success: false, message: 'Could not parse amount' }, { status: 400 });
        }
        
        const rawAmount = amountMatch[1].replace(/,/g, '');
        const amount = parseFloat(rawAmount);

        // 3. Extract 12-digit UTR/Ref No if available (OPTIONAL)
        const utrMatch = body.match(/(?:UPI\s*Ref\s*No\.?|Ref\s*No\.?|UPI|IMPS|Ref|UTR|Txn)[:\s;\.#]*(\d{12})/i) || body.match(/\b(\d{12})\b/);
        const utr = utrMatch ? utrMatch[1] : null;

        const pool = getPgPool();

        // 4. Save into scraped_sms table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.scraped_sms (
                id SERIAL PRIMARY KEY,
                sms_body TEXT,
                sender VARCHAR(100),
                utr VARCHAR(64),
                amount NUMERIC(10, 2),
                is_used BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `).catch(() => {});

        const scrapedRes = await pool.query(`
            INSERT INTO fluxbase_global.scraped_sms (sms_body, sender, utr, amount)
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        `, [body, sender, utr, amount]);
        const scrapedId = scrapedRes.rows[0]?.id;

        logger.info(`[SMS Webhook] Logged payment notification: Amount=₹${amount}, UTR=${utr || 'N/A'}, ID=${scrapedId}`);

        // 5. Check pending payment sessions by exact decimal amount
        const sessionRes = await pool.query(`
            SELECT id, user_id, plan_type, project_data 
            FROM fluxbase_global.payment_sessions 
            WHERE amount = $1 
              AND status = 'pending' 
              AND expires_at > NOW()
            ORDER BY created_at DESC LIMIT 1;
        `, [amount]);

        if (sessionRes.rows.length > 0) {
            const session = sessionRes.rows[0];
            const userId = session.user_id;
            const planType = session.plan_type;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                await client.query(
                    `UPDATE fluxbase_global.payment_sessions SET status = 'completed' WHERE id = $1`,
                    [session.id]
                );

                if (scrapedId) {
                    await client.query(
                        `UPDATE fluxbase_global.scraped_sms SET is_used = true WHERE id = $1`,
                        [scrapedId]
                    );
                }

                await client.query(
                    `INSERT INTO fluxbase_global.payments (user_id, amount, currency, status, razorpay_payment_id)
                     VALUES ($1, $2, 'INR', 'completed', $3)
                     ON CONFLICT DO NOTHING`,
                    [userId, amount, utr ? `utr_${utr}` : `upi_session_${session.id}`]
                );

                await client.query(
                    `UPDATE fluxbase_global.users 
                     SET plan_type = $1, user_role = $1, billing_cycle_end = NOW() + INTERVAL '1 month', status = 'active'
                     WHERE id = $2`,
                    [planType, userId]
                );

                // Auto-provision project if project_data was supplied
                if (session.project_data) {
                    try {
                        const { createProject } = await import('@/lib/data');
                        const { TenantProvisioner } = await import('@/lib/tenant-engine');
                        const pData = typeof session.project_data === 'string' ? JSON.parse(session.project_data) : session.project_data;
                        const existingProj = await client.query(
                            `SELECT project_id FROM fluxbase_global.projects WHERE user_id = $1 AND display_name = $2`,
                            [userId, pData.projectName || 'My Project']
                        );
                        if (existingProj.rows.length === 0) {
                            const newProject = await createProject(
                                pData.projectName || 'My Project',
                                pData.workDescription || 'Provisioned upon payment confirmation',
                                pData.dialect || 'postgresql',
                                pData.timezone || 'UTC',
                                'internal',
                                {},
                                pData.userRole || planType,
                                userId
                            );
                            await TenantProvisioner.createTenantSchema(newProject.project_id, pData.dialect || 'postgresql');
                            await client.query(
                                'UPDATE fluxbase_global.projects SET creator_role = $1 WHERE project_id = $2',
                                [pData.userRole || planType, newProject.project_id]
                            );
                        }
                    } catch (pErr) {
                        logger.error('[SMS Webhook] Error auto-provisioning paid project:', pErr);
                    }
                }

                // Realtime broadcast via Postgres NOTIFY
                try {
                    const notifyPayload = JSON.stringify({
                        type: 'db_event',
                        payload: {
                            table: 'payment_sessions',
                            record: { id: session.id, status: 'completed', amount }
                        }
                    });
                    await client.query(`NOTIFY fluxbase_live, '${notifyPayload.replace(/'/g, "''")}'`);
                } catch (wsErr) {
                    logger.warn('[SMS Webhook] NOTIFY warning:', wsErr);
                }

                await client.query('COMMIT');
                logger.info(`[SMS Webhook] Session ${session.id} matched by amount ₹${amount} and completed!`);

                return NextResponse.json({
                    success: true,
                    matchedSessionId: session.id,
                    amount,
                    utr
                });
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }
        }

        return NextResponse.json({ success: true, utr, amount });

    } catch (error: any) {
        logger.error(`[SMS Webhook Error]:`, error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
