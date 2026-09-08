import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';

export async function POST(req: NextRequest) {
  try {
    const merchant = await getSessionMerchant();
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const pool = getPool();

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.payout_upi_id !== undefined) {
      updates.push(`payout_upi_id = $${idx++}`);
      values.push(body.payout_upi_id ? body.payout_upi_id.trim() : null);
    }
    if (body.payout_bank_acc !== undefined) {
      updates.push(`payout_bank_acc = $${idx++}`);
      values.push(body.payout_bank_acc ? body.payout_bank_acc.trim() : null);
    }
    if (body.payout_ifsc !== undefined) {
      updates.push(`payout_ifsc = $${idx++}`);
      values.push(body.payout_ifsc ? body.payout_ifsc.trim().toUpperCase() : null);
    }
    if (body.payout_holder_name !== undefined) {
      updates.push(`payout_holder_name = $${idx++}`);
      values.push(body.payout_holder_name ? body.payout_holder_name.trim() : null);
    }
    if (body.webhook_url !== undefined) {
      updates.push(`webhook_url = $${idx++}`);
      values.push(body.webhook_url ? body.webhook_url.trim() : null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }

    values.push(merchant.id);
    await pool.query(
      `UPDATE merchants SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
