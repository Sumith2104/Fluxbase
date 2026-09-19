import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { sendFeedbackEmail } from '@/lib/email';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const auth = await getAuthContextFromRequest(req);
        const body = await req.json();
        const { mood, message } = body;

        if (!message) {
            return NextResponse.json({ success: false, error: 'Message is required' }, { status: 400 });
        }

        // Direct persistence to AWS RDS PostgreSQL
        const pool = getPgPool();
        
        // Ensure local client_queries table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fluxbase_global.client_queries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                message TEXT NOT NULL,
                mood TEXT,
                user_id TEXT,
                processed BOOLEAN DEFAULT FALSE
            );
        `);

        await pool.query(
            `INSERT INTO fluxbase_global.client_queries (message, mood, user_id, processed) VALUES ($1, $2, $3, false)`,
            [message, mood || null, auth?.userId || null]
        );
        logger.info('[Feedback] Saved query to AWS RDS client_queries.');

        // 3. Send email notification (keeps SMTP notification intact as requested)
        if (process.env.SMTP_USER) {
            try {
                await sendFeedbackEmail(
                    process.env.SMTP_USER,
                    mood,
                    message,
                    req.headers.get('referer'),
                    auth?.userId || 'Anonymous'
                );
            } catch (emailErr) {
                logger.error('Failed to send feedback email:', emailErr);
                // Don't fail the client request if email fails
            }
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        logger.error('Feedback API error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
