import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { hashPassword, createMerchantToken, MERCHANT_COOKIE_NAME } from '@/lib/merchant-auth';
import { generateApiKey, generateWebhookSecret } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    const { email, password, business_name, name, phone, payout_upi_id } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email address is required' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }
    if (!business_name && !name) {
      return NextResponse.json({ error: 'Business or merchant name is required' }, { status: 400 });
    }

    const pool = getPool();
    const cleanEmail = email.trim().toLowerCase();

    // Check existing
    const existing = await pool.query('SELECT id FROM merchants WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const apiKey = generateApiKey();
    const webhookSecret = generateWebhookSecret();

    const insertRes = await pool.query(
      `INSERT INTO merchants (
          name, business_name, email, password_hash, phone, payout_upi_id,
          api_key, webhook_secret, balance, total_earned, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.00, 0.00, 'active')
       RETURNING id, name, business_name, email, api_key, webhook_secret, balance`,
      [
        name || business_name,
        business_name || name,
        cleanEmail,
        passwordHash,
        phone || null,
        payout_upi_id ? payout_upi_id.trim() : null,
        apiKey,
        webhookSecret,
      ]
    );

    const merchant = insertRes.rows[0];
    const token = await createMerchantToken(merchant.id, cleanEmail);

    const response = NextResponse.json({
      success: true,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        business_name: merchant.business_name,
        email: merchant.email,
        api_key: merchant.api_key,
        balance: parseFloat(merchant.balance),
      },
    });

    response.cookies.set(MERCHANT_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    return response;
  } catch (err: any) {
    console.error('[Merchant Signup Error]:', err);
    return NextResponse.json({ error: err.message || 'Signup failed' }, { status: 500 });
  }
}
