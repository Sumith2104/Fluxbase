import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';

export async function POST(req: NextRequest) {
  try {
    const merchant = await getSessionMerchant();
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { title, amount, description } = await req.json();
    const numAmount = parseFloat(amount);

    if (!title || isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Title and positive amount are required' }, { status: 400 });
    }

    const pool = getPool();
    const linkId = 'plink_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

    const res = await pool.query(
      `INSERT INTO payment_links (id, merchant_id, title, description, amount, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [linkId, merchant.id, title.trim(), description || null, numAmount]
    );

    return NextResponse.json({ success: true, link: res.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
