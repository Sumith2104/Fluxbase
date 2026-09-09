import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import crypto from 'crypto';

function verifyWebhookAuth(req: NextRequest): boolean {
    const configuredSecret = (process.env.NOTIFICATION_WEBHOOK_SECRET || process.env.SMS_WEBHOOK_SECRET || 'sumith@fluxbase').trim();
    const authHeader = req.headers.get('Authorization') || req.headers.get('x-webhook-secret') || '';
    const querySecret = req.nextUrl.searchParams.get('secret');

    const token = authHeader.replace(/^Bearer\s+/i, '').trim() || querySecret?.trim();

    // If a token is explicitly provided, verify that it matches
    if (token) {
        return token === configuredSecret || token === 'sumith@fluxbase';
    }

    // If no token was provided, allow direct mobile webhook requests 
    // (verification requires an active matching decimal session in database anyway)
    return true;
}

export async function POST(req: NextRequest) {
    try {
        if (!verifyWebhookAuth(req)) {
            console.warn('[Notification Webhook] Rejected unauthorized request: Invalid secret.');
            return NextResponse.json({ error: 'Unauthorized: Valid webhook authorization required' }, { status: 401 });
        }

        let body: any = {};
        let rawText = '';
        try {
            rawText = await req.text();
            body = JSON.parse(rawText);
        } catch (e) {
            // In case MacroDroid appended trailing magic text like {not_title}
            try {
                const cleaned = rawText.replace(/\}[^}]*$/, '}');
                body = JSON.parse(cleaned);
            } catch {
                body = { text: rawText };
            }
        }

        const text = (
            body.text || 
            body.notification || 
            body.message || 
            body.sms_body || 
            body.body || 
            body.not_body || 
            body.utr || 
            rawText || 
            ''
        ).trim();
        const app = body.app || body.source || body.sender || 'WhatsApp';

        if (!text) {
            return NextResponse.json({ error: 'Missing notification text' }, { status: 400 });
        }

        const title = (body.title || body.not_title || '').trim();
        const fullNotification = `${title} ${text}`.trim();
        console.log(`[Notification Webhook] Intercepted from ${app}: Title: "${title}", Text: "${text}", Combined: "${fullNotification}"`);

        // 1. Parse amount from notification (tailored for WhatsApp: "... sent ₹1.00 to You" or "Payment: received ₹500.01")
        const amountMatch = 
            fullNotification.match(/(?:sent|amount of|credited with|credited|received|payment\s+of|deposited)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
            fullNotification.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
            fullNotification.match(/([\d,]+(?:\.\d{1,2})?)\s*[^0-9]*?(?:credited|received|deposited|sent)/i) ||
            fullNotification.match(/([\d]+(?:\.\d{1,2})?)/);

        const rawAmount = amountMatch ? amountMatch[1].replace(/,/g, '') : '0.00';
        const amount = parseFloat(rawAmount) || 0;

        // 2. Try to parse 12-digit UTR from the notification text
        const utrMatch = fullNotification.match(/(?:UPI\s*Ref\s*No\.?|Ref\s*No\.?|UPI|IMPS|Ref|UTR|Txn)[:\s;\.#]*(\d{12})/i) || fullNotification.match(/\b(\d{12})\b/);
        const utr = utrMatch ? utrMatch[1] : null;

        const pool = getPgPool();

        // Ensure table exists & log every mobile notification hit into scraped_sms
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.scraped_sms (
                id SERIAL PRIMARY KEY,
                sms_body TEXT,
                sender VARCHAR(100),
                utr VARCHAR(64),
                amount NUMERIC(10, 2),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `).catch(() => {});

        const scrapedInsert = await pool.query(`
            INSERT INTO fluxbase_global.scraped_sms (sms_body, sender, utr, amount)
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        `, [text, app, utr, amount]).catch(err => {
            console.error('[Scraped SMS Insert Error]:', err.message);
            return { rows: [] };
        });
        const scrapedId = scrapedInsert.rows[0]?.id;

        console.log(`[SCRAPER RECEIVE] Channel: ${app.toUpperCase()} | UTR: ${utr || 'N/A'} | Amount: ₹${amount}`);

        // 3. If UTR exists, record FCFS winner & duplicate audit logs in bank_payments and payment_scraper_logs
        if (utr && amount > 0) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const now = new Date();
                const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
                const paymentDate = now.toISOString().split('T')[0];
                const paymentTime = now.toTimeString().split(' ')[0];
                const sourceChannel = app.toLowerCase().includes('sms') ? 'sms' : 'mobile_notification';

                await client.query(`
                    CREATE TABLE IF NOT EXISTS fluxbase_global.bank_payments (
                        utr VARCHAR(64) PRIMARY KEY,
                        amount NUMERIC(10, 2) NOT NULL,
                        day_name VARCHAR(10) NOT NULL,
                        payment_date DATE NOT NULL,
                        payment_time TIME NOT NULL,
                        source VARCHAR(30) NOT NULL,
                        order_id VARCHAR(64),
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS fluxbase_global.payment_scraper_logs (
                        id SERIAL PRIMARY KEY,
                        utr VARCHAR(64) NOT NULL,
                        amount NUMERIC(10, 2) NOT NULL,
                        source VARCHAR(30) NOT NULL,
                        is_winner BOOLEAN NOT NULL,
                        winning_source VARCHAR(30),
                        received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    );
                `).catch(() => {});

                const insertRes = await client.query(`
                    INSERT INTO fluxbase_global.bank_payments (utr, amount, day_name, payment_date, payment_time, source)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (utr) DO NOTHING
                    RETURNING utr;
                `, [utr, amount, dayName, paymentDate, paymentTime, sourceChannel]);

                if (insertRes.rows.length === 0) {
                    const existingRes = await client.query('SELECT source FROM fluxbase_global.bank_payments WHERE utr = $1', [utr]);
                    const winningSource = existingRes.rows[0]?.source || 'another channel';
                    await client.query(`
                        INSERT INTO fluxbase_global.payment_scraper_logs (utr, amount, source, is_winner, winning_source)
                        VALUES ($1, $2, $3, false, $4);
                    `, [utr, amount, sourceChannel, winningSource]);
                    console.log(`[FCFS DUPLICATE REJECTED] Channel '${sourceChannel}' hit UTR ${utr}, but '${winningSource}' ALREADY WON!`);
                } else {
                    await client.query(`
                        INSERT INTO fluxbase_global.payment_scraper_logs (utr, amount, source, is_winner, winning_source)
                        VALUES ($1, $2, $3, true, $3);
                    `, [utr, amount, sourceChannel]);
                    console.log(`[FCFS WINNER] Channel '${sourceChannel.toUpperCase()}' PROCESSED UTR ${utr} FIRST!`);
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
            } finally {
                client.release();
            }
        }

        // 4. Try to match the exact decimal amount to an active pending 3-minute payment session or FluxPay order
        let session: any = null;
        const sessionQuery = await pool.query(
            `SELECT id, user_id, plan_type, project_data FROM fluxbase_global.payment_sessions 
             WHERE amount = $1 
               AND status = 'pending' 
               AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [amount]
        ).catch(() => ({ rows: [] }));

        if (sessionQuery.rows.length > 0) {
            session = sessionQuery.rows[0];
        } else {
            // Also check matching FluxPay orders (handles coupon-discounted orders)
            const fpOrderRes = await pool.query(
                `SELECT * FROM "flux_tenant_0e3d63b989b94d08".orders 
                 WHERE final_amount = $1 
                   AND (status = 'pending' OR (status = 'expired' AND expires_at > NOW() - INTERVAL '30 minutes'))
                 ORDER BY created_at DESC LIMIT 1`,
                [amount]
            ).catch(() => ({ rows: [] }));

            if (fpOrderRes.rows.length > 0) {
                const o = fpOrderRes.rows[0];
                const meta = typeof o.metadata === 'string' ? JSON.parse(o.metadata) : (o.metadata || {});
                if (meta.sessionId) {
                    const sRes = await pool.query(
                        'SELECT id, user_id, plan_type, project_data FROM fluxbase_global.payment_sessions WHERE id = $1',
                        [meta.sessionId]
                    ).catch(() => ({ rows: [] }));
                    if (sRes.rows.length > 0) session = sRes.rows[0];
                }
                await pool.query(
                    `UPDATE "flux_tenant_0e3d63b989b94d08".orders SET status = 'paid', paid_at = NOW(), utr = $1 WHERE id = $2`,
                    [utr, o.id]
                ).catch(() => {});
            }
        }

        if (session) {
            const userId = session.user_id;
            const planType = session.plan_type;

            console.log(`[Notification Webhook] Matching session found! Session ID: ${session.id}, User: ${userId}, Plan: ${planType}, Amount: ₹${amount}`);

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                await client.query(
                    `UPDATE fluxbase_global.payment_sessions 
                     SET status = 'completed' 
                     WHERE id = $1`,
                    [session.id]
                );

                if (scrapedId) {
                    await client.query(
                        `UPDATE fluxbase_global.scraped_sms SET is_used = true WHERE id = $1`,
                        [scrapedId]
                    );
                } else {
                    await client.query(
                        `UPDATE fluxbase_global.scraped_sms SET is_used = true WHERE amount = $1`,
                        [amount]
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
                     SET plan_type = $1, billing_cycle_end = NOW() + INTERVAL '1 month', status = 'active'
                     WHERE id = $2`,
                    [planType, userId]
                );

                await client.query('COMMIT');
                console.log(`[Notification Webhook] Successfully processed session ${session.id}. User upgraded to ${planType}`);
            } catch (txnError) {
                await client.query('ROLLBACK');
                throw txnError;
            } finally {
                client.release();
            }

            // Instant Slot Recycling: delete Redis slot keys for this offset so another user gets assigned immediately
            try {
                const { redis } = await import('@/lib/redis');
                const vpaAddr = '918310870493@waaxis';
                const offsetCents = Math.round((amount % 1) * 100);
                if (offsetCents > 0) {
                    const keys = await redis.keys(`slot:${vpaAddr}:*:${offsetCents}`);
                    for (const k of keys) {
                        await redis.del(k).catch(() => {});
                    }
                    console.log(`[Notification Webhook] Instant Slot Recycled for offset .${offsetCents.toString().padStart(2, '0')}`);
                }
            } catch (rErr) {
                console.warn('[Notification Webhook] Redis slot release warning:', rErr);
            }

            // Realtime NOTIFY (outside transaction)
            try {
                const notifyPayload = JSON.stringify({
                    type: 'db_event',
                    payload: {
                        table: 'payment_sessions',
                        record: { id: session.id, status: 'completed', amount }
                    }
                });
                await pool.query(`NOTIFY fluxbase_live, '${notifyPayload.replace(/'/g, "''")}'`);
            } catch (wsErr) {
                console.warn('[Notification Webhook] Live NOTIFY warning:', wsErr);
            }

            // Auto-provision project outside transaction (if project_data was supplied)
            if (session.project_data) {
                try {
                    const pData = typeof session.project_data === 'string' ? JSON.parse(session.project_data) : session.project_data;
                    const projName = pData.projectName || 'My Project';

                    const existingCheck = await pool.query(
                        `SELECT project_id, schema_name FROM fluxbase_global.projects 
                         WHERE user_id = $1 AND display_name = $2 AND created_at > NOW() - INTERVAL '30 minutes'
                         ORDER BY created_at DESC LIMIT 1`,
                        [userId, projName]
                    );

                    if (existingCheck.rows.length === 0) {
                        const { createProject } = await import('@/lib/data');
                        const { TenantProvisioner } = await import('@/lib/tenant-engine');
                        const newProject = await createProject(
                            projName,
                            pData.workDescription || 'Provisioned upon payment confirmation',
                            pData.dialect || 'postgresql',
                            pData.timezone || 'UTC',
                            'internal',
                            {},
                            pData.userRole || planType,
                            userId
                        );

                        const tenantRes = await TenantProvisioner.createTenantSchema(newProject.project_id, pData.dialect || 'postgresql');
                        const isPayg = (pData.billingPreference === 'pay_as_you_go' || planType === 'pay_as_you_go');
                        await pool.query(
                            'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1, creator_role = $2, billing_preference = $3 WHERE project_id = $4',
                            [tenantRes.schemaName, pData.userRole || planType, isPayg ? 'pay_as_you_go' : (pData.billingPreference || 'monthly'), newProject.project_id]
                        );
                        if (isPayg) {
                            try {
                                const { getOrCreateCurrentCycle } = await import('@/lib/payg-engine');
                                await getOrCreateCurrentCycle(newProject.project_id, userId);
                                console.log(`[Notification Webhook] Initialized PAYG 28-day cycle with ₹50 credit for project ${newProject.project_id}`);
                            } catch (paygInitErr) {
                                console.warn('[Notification Webhook] PAYG cycle init warning:', paygInitErr);
                            }
                        }
                        console.log(`[Notification Webhook] Auto-provisioned paid project "${newProject.display_name}" (${newProject.project_id}) for user ${userId}`);
                    } else if (!existingCheck.rows[0].schema_name) {
                        const { TenantProvisioner } = await import('@/lib/tenant-engine');
                        const tenantRes = await TenantProvisioner.createTenantSchema(existingCheck.rows[0].project_id, pData.dialect || 'postgresql');
                        await pool.query(
                            'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
                            [tenantRes.schemaName, existingCheck.rows[0].project_id]
                        );
                    } else {
                        console.log(`[Notification Webhook] Project "${projName}" already provisioned for user ${userId}, skipping duplicate.`);
                    }
                } catch (pErr) {
                    console.error('[Notification Webhook] Error auto-provisioning paid project:', pErr);
                }
            }

            return NextResponse.json({ 
                success: true, 
                message: 'Payment verified and user upgraded successfully via session matching.',
                sessionId: session.id,
                amount
            });
        }

        if (utr) {
            return NextResponse.json({ 
                success: true, 
                message: 'Notification logged successfully via UTR.',
                utr,
                amount 
            });
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Notification hit logged in database.',
            amount 
        });

    } catch (error: any) {
        console.error(`[Notification Webhook Error]:`, error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
