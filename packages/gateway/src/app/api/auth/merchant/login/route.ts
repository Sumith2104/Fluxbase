import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { verifyPassword, createMerchantToken, MERCHANT_COOKIE_NAME } from '@/lib/merchant-auth';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const pool = getPool();
    const cleanEmail = email.trim().toLowerCase();

    const res = await pool.query(
      `SELECT id, name, business_name, email, password_hash, status, api_key, balance
       FROM merchants
       WHERE email = $1`,
      [cleanEmail]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const merchant = res.rows[0];

    if (merchant.status !== 'active') {
      return NextResponse.json({ error: 'Account has been disabled. Contact support.' }, { status: 403 });
    }

    const valid = await verifyPassword(password, merchant.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = await createMerchantToken(merchant.id, merchant.email);

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
    console.error('[Merchant Login Error]:', err);
    return NextResponse.json({ error: err.message || 'Login failed' }, { status: 500 });
  }
}
