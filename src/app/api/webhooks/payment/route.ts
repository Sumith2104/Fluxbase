import { NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import realtimeManager from '@/lib/realtime-manager';
import logger from '@/lib/logger';

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get('authorization') || req.headers.get('x-webhook-secret') || '';
        const token = authHeader.replace('Bearer ', '').trim();
        const validSecrets = [
            process.env.PAYMENT_WEBHOOK_SECRET,
            process.env.SMS_WEBHOOK_SECRET,
            'sumith@fluxbase',
            'whsec_de4e5ac069b1e05aebb098ee343e396a'
        ].filter(Boolean);

        if (token && validSecrets.length > 0 && !validSecrets.includes(token)) {
            return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
        }

        let body: any = {};
        let rawBodyString = '';
        try {
            rawBodyString = await req.text();
            body = JSON.parse(rawBodyString);
        } catch (e) {
            // If raw text or malformed JSON was sent by MacroDroid, treat the full string as SMS text!
            body = { utr: rawBodyString, text: rawBodyString, message: rawBodyString };
        }

        let { utr, amount, source, rawTimestamp, projectId } = body;

        const rawText = (String(utr || '') + ' ' + String(body.message || body.sms_body || body.text || rawBodyString || '')).trim();

        // Server-side Smart Regex Parser: Extract 12-digit UTR if present (optional)
        if (!utr || String(utr).length > 12 || isNaN(Number(utr))) {
            const utrMatch = rawText.match(/(?:UPI\s*Ref\s*No\.?|Ref\s*No\.?|UPI|IMPS|Ref|UTR|Txn)[:\s;\.#]*(\d{12})/i) || rawText.match(/\b(\d{12})\b/);
            if (utrMatch) {
                utr = utrMatch[1];
            } else {
                utr = null;
            }
        }

        // Server-side Smart Regex Parser: Extract Exact Decimal Amount
        if (!amount || isNaN(parseFloat(amount))) {
            const amtMatch = 
                rawText.match(/(?:sent|amount of|credited with|credited|received|payment\s+of|deposited)\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                rawText.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                rawText.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i) ||
                rawText.match(/([\d,]+(?:\.\d{1,2})?)\s*[^0-9]*?(?:credited|received|deposited|sent)/i) ||
                rawText.match(/([\d]+\.\d{2})/);
            if (amtMatch) {
                amount = amtMatch[1].replace(/,/g, '');
            }
        }

        if (!amount) {
            return NextResponse.json({ error: 'Could not extract amount from SMS body' }, { status: 400 });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 });
        }

        const validSources = ['mobile_notification', 'sms', 'email'];
        const finalSource = validSources.includes(source) ? source : 'mobile_notification';

        // Redundantly forward alert directly to FluxPay Gateway matching engine
        fetch('https://payments.fluxbasedb.me/api/v1/webhook/incoming', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer sumith@fluxbase'
            },
            body: JSON.stringify({
                message: rawText,
                sender: finalSource,
                utr: utr || undefined,
                amount: parsedAmount
            })
        }).catch(err => logger.warn('[Payment Webhook] Gateway forward error:', err?.message));

        const pool = getPgPool();
        
        // Ensure tables exist before handling payment transaction
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
            CREATE TABLE IF NOT EXISTS fluxbase_global.pending_orders (
                order_id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                utr_number VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                fulfilled_at TIMESTAMP WITH TIME ZONE
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
        `).catch(err => logger.error('[Schema Init Warning]:', err.message));

        // Always log every mobile/SMS notification hit into scraped_sms
        const scrapedInsert = await pool.query(`
            INSERT INTO fluxbase_global.scraped_sms (sms_body, sender, utr, amount)
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        `, [rawText, finalSource, utr || null, parsedAmount]).catch(err => {
            logger.error('[Scraped SMS Insert Error]:', err.message);
            return { rows: [] };
        });
        const scrapedId = scrapedInsert.rows[0]?.id;

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const now = rawTimestamp ? new Date(rawTimestamp) : new Date();
            const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
            const paymentDate = now.toISOString().split('T')[0];
            const paymentTime = now.toTimeString().split(' ')[0];

            logger.info(`[SCRAPER RECEIVE] Channel: ${finalSource.toUpperCase()} | Amount: ₹${parsedAmount} | UTR: ${utr || 'N/A'} | Time: ${paymentTime}`);

            // 1. If UTR exists, record into bank_payments table (idempotent FCFS)
            if (utr) {
                const insertRes = await client.query(`
                    INSERT INTO fluxbase_global.bank_payments (utr, amount, day_name, payment_date, payment_time, source)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (utr) DO NOTHING
                    RETURNING utr;
                `, [utr, parsedAmount, dayName, paymentDate, paymentTime, finalSource]);

                if (insertRes.rows.length === 0) {
                    const existingRes = await client.query('SELECT source FROM fluxbase_global.bank_payments WHERE utr = $1', [utr]);
                    const winningSource = existingRes.rows[0]?.source || 'another channel';
                    await client.query(`
                        INSERT INTO fluxbase_global.payment_scraper_logs (utr, amount, source, is_winner, winning_source)
                        VALUES ($1, $2, $3, false, $4);
                    `, [utr, parsedAmount, finalSource, winningSource]);
                } else {
                    await client.query(`
                        INSERT INTO fluxbase_global.payment_scraper_logs (utr, amount, source, is_winner, winning_source)
                        VALUES ($1, $2, $3, true, $3);
                    `, [utr, parsedAmount, finalSource]);
                }
            }

            // 2. Fractional Amount Matching (e.g. ₹100.02) against Active Pending Orders
            const orderRes = await client.query(`
                SELECT order_id, user_id 
                FROM fluxbase_global.pending_orders 
                WHERE status = 'pending' 
                  AND amount = $1 
                  AND created_at >= NOW() - INTERVAL '15 minutes'
                ORDER BY created_at ASC 
                LIMIT 1 
                FOR UPDATE SKIP LOCKED;
            `, [parsedAmount]);

            let matchedOrderId: string | null = null;
            let matchedUserId: string | null = null;
            let matchedSessionId: number | null = null;
            let matchedProjectData: any = null;
            let matchedPlanType: string | null = null;

            if (orderRes.rows.length > 0) {
                matchedOrderId = orderRes.rows[0].order_id;
                matchedUserId = orderRes.rows[0].user_id;

                // Mark pending order as paid
                await client.query(`
                    UPDATE fluxbase_global.pending_orders 
                    SET status = 'paid', utr_number = $1, fulfilled_at = NOW() 
                    WHERE order_id = $2;
                `, [utr, matchedOrderId]);

                // Link bank payment record to order
                await client.query(`
                    UPDATE fluxbase_global.bank_payments 
                    SET order_id = $1 
                    WHERE utr = $2;
                `, [matchedOrderId, utr]);

                logger.info(`[ORDER MATCHED] Order ID '${matchedOrderId}' for User '${matchedUserId}' verified and marked PAID!`);
            } else {
                // Check pending web checkout sessions matching the exact decimal amount
                const sessionRes = await client.query(`
                    SELECT id, user_id, plan_type, project_data 
                    FROM fluxbase_global.payment_sessions 
                    WHERE amount = $1 
                      AND status = 'pending' 
                      AND expires_at > NOW()
                    ORDER BY created_at DESC LIMIT 1;
                `, [parsedAmount]);

                let session: any = sessionRes.rows[0];
                if (!session) {
                    // Also check matching FluxPay orders (handles orders with coupons where final_amount differed from base)
                    const fpOrder = await client.query(`
                        SELECT * FROM "flux_tenant_0e3d63b989b94d08".orders 
                        WHERE final_amount = $1 
                          AND (status = 'pending' OR (status = 'expired' AND expires_at > NOW() - INTERVAL '30 minutes'))
                        ORDER BY created_at DESC LIMIT 1;
                    `, [parsedAmount]).catch(() => ({ rows: [] }));

                    if (fpOrder.rows.length > 0) {
                        const o = fpOrder.rows[0];
                        const meta = typeof o.metadata === 'string' ? JSON.parse(o.metadata) : (o.metadata || {});
                        if (meta.sessionId) {
                            const sRes = await client.query(
                                'SELECT id, user_id, plan_type, project_data FROM fluxbase_global.payment_sessions WHERE id = $1',
                                [meta.sessionId]
                            );
                            if (sRes.rows.length > 0) session = sRes.rows[0];
                        }
                        await client.query(
                            `UPDATE "flux_tenant_0e3d63b989b94d08".orders SET status = 'paid', paid_at = NOW(), utr = $1 WHERE id = $2`,
                            [utr, o.id]
                        ).catch(() => {});
                    }
                }

                if (session) {
                    matchedSessionId = session.id;
                    matchedUserId = session.user_id;
                    matchedProjectData = session.project_data;
                    const planType = session.plan_type;
                    matchedPlanType = planType;

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
                        [matchedUserId, parsedAmount, utr ? `utr_${utr}` : `upi_session_${session.id}`]
                    );

                    await client.query(
                        `UPDATE fluxbase_global.users 
                         SET plan_type = $1, user_role = $1, billing_cycle_end = NOW() + INTERVAL '1 month', status = 'active'
                         WHERE id = $2`,
                        [planType, matchedUserId]
                    );

                    // Auto-provisioning project will be handled outside the transaction if session.project_data exists

                    // Realtime notify via Postgres
                    try {
                        const notifyPayload = JSON.stringify({
                            type: 'db_event',
                            payload: {
                                table: 'payment_sessions',
                                record: { id: session.id, status: 'completed', amount: parsedAmount }
                            }
                        });
                        await client.query(`NOTIFY fluxbase_live, '${notifyPayload.replace(/'/g, "''")}'`);
                    } catch (wsErr) {
                        logger.warn('[Payment Webhook] NOTIFY warning:', wsErr);
                    }

                    logger.info(`[SESSION MATCHED] Checkout Session '${session.id}' for User '${matchedUserId}' verified and completed via decimal amount ₹${parsedAmount}!`);
                }
            }

            await client.query('COMMIT');

            // 2.3 Instant Slot Recycling: delete Redis slot keys for this offset so another user gets assigned immediately
            try {
                const { redis } = await import('@/lib/redis');
                const vpaAddr = '918310870493@waaxis';
                const offsetCents = Math.round((parsedAmount % 1) * 100);
                if (offsetCents > 0) {
                    const keys = await redis.keys(`slot:${vpaAddr}:*:${offsetCents}`);
                    for (const k of keys) {
                        await redis.del(k).catch(() => {});
                    }
                    logger.info(`[Payment Webhook] Instant Slot Recycled for offset .${offsetCents.toString().padStart(2, '0')}`);
                }
            } catch (rErr) {
                logger.warn('[Payment Webhook] Redis slot release warning:', rErr);
            }

            // 2.5 Auto-provision project outside transaction if project_data exists
            if (matchedProjectData && matchedUserId) {
                try {
                    const pData = typeof matchedProjectData === 'string' ? JSON.parse(matchedProjectData) : matchedProjectData;
                    const projName = pData.projectName || 'My Project';

                    const existingCheck = await pool.query(
                        `SELECT project_id, schema_name FROM fluxbase_global.projects 
                         WHERE user_id = $1 AND display_name = $2 AND created_at > NOW() - INTERVAL '30 minutes'
                         ORDER BY created_at DESC LIMIT 1`,
                        [matchedUserId, projName]
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
                            pData.userRole || matchedPlanType,
                            matchedUserId
                        );

                        const tenantRes = await TenantProvisioner.createTenantSchema(newProject.project_id, pData.dialect || 'postgresql');
                        const isPayg = (pData.billingPreference === 'pay_as_you_go' || matchedPlanType === 'pay_as_you_go');
                        await pool.query(
                            'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1, creator_role = $2, billing_preference = $3 WHERE project_id = $4',
                            [tenantRes.schemaName, pData.userRole || matchedPlanType, isPayg ? 'pay_as_you_go' : (pData.billingPreference || 'monthly'), newProject.project_id]
                        );
                        if (isPayg) {
                            try {
                                const { getOrCreateCurrentCycle } = await import('@/lib/payg-engine');
                                await getOrCreateCurrentCycle(newProject.project_id, matchedUserId);
                            } catch (cycleErr) {
                                logger.warn('[Payment Webhook] PAYG cycle init warning:', cycleErr);
                            }
                        }
                        logger.info(`[Payment Webhook] Auto-provisioned project ${newProject.project_id} (${newProject.display_name}) for user ${matchedUserId}`);
                    } else if (!existingCheck.rows[0].schema_name) {
                        const { TenantProvisioner } = await import('@/lib/tenant-engine');
                        const tenantRes = await TenantProvisioner.createTenantSchema(existingCheck.rows[0].project_id, pData.dialect || 'postgresql');
                        await pool.query(
                            'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
                            [tenantRes.schemaName, existingCheck.rows[0].project_id]
                        );
                    }
                } catch (provErr) {
                    logger.error('[Payment Webhook] Project auto-provision error:', provErr);
                }
            }

            // 3. Trigger Realtime WebSocket event to unlock user UI instantly
            if (matchedOrderId) {
                realtimeManager.emit(`order_${matchedOrderId}`, JSON.stringify({
                    status: 'paid',
                    utr,
                    amount: parsedAmount,
                    userId: matchedUserId
                }));
            }

            if (projectId) {
                realtimeManager.emit(`project:${projectId}`, JSON.stringify({
                    type: 'payment_received',
                    utr,
                    amount: parsedAmount,
                    source: finalSource
                }));
            }

            return NextResponse.json({
                success: true,
                duplicate: false,
                utr,
                dayName,
                paymentDate,
                paymentTime,
                source: finalSource,
                orderMatched: !!matchedOrderId || !!matchedSessionId,
                matchedOrderId,
                matchedSessionId
            });

        } catch (txError) {
            await client.query('ROLLBACK');
            throw txError;
        } finally {
            client.release();
        }

    } catch (error: any) {
        logger.error('[Webhook Ingestion Error]:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
