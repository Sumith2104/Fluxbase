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
    const amount = parseFloat(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Valid positive withdrawal amount is required' }, { status: 400 });
    }

    const currentBalance = parseFloat(merchant.balance);
    if (amount > currentBalance) {
      return NextResponse.json({
        error: `Insufficient balance. Available withdrawable balance: ₹${currentBalance.toFixed(2)}`,
      }, { status: 400 });
    }

    const payoutMethod = body.payout_method || 'upi';
    const payoutAddress = body.payout_address || merchant.payout_upi_id || merchant.payout_bank_acc;

    if (!payoutAddress) {
      return NextResponse.json({
        error: 'Please provide a payout UPI ID or Bank Account to receive funds',
      }, { status: 400 });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const settlementId = 'stl_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);

      // Deduct balance from merchant
      await client.query(
        `UPDATE merchants SET balance = balance - $1 WHERE id = $2`,
        [amount, merchant.id]
      );

      // Insert settlement record
      const res = await client.query(
        `INSERT INTO settlements (id, merchant_id, amount, status, payout_method, payout_address, notes)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6)
         RETURNING *`,
        [
          settlementId,
          merchant.id,
          amount,
          payoutMethod,
          payoutAddress,
          body.notes || 'Monthly Withdrawal Request',
        ]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, settlement: res.rows[0] });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
