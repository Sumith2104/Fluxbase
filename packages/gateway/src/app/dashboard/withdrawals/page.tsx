import React from 'react';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { WithdrawalsClient } from './withdrawals-client';

export const revalidate = 0;

export default async function WithdrawalsPage() {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  const pool = getPool();
  const settlementsRes = await pool.query(
    `SELECT * FROM settlements
     WHERE merchant_id = $1
     ORDER BY requested_at DESC
     LIMIT 50`,
    [merchant.id]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5]">
          WALLET BALANCE & MONTHLY SETTLEMENTS
        </h1>
        <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
          Earnings accumulated from automated customer payments. Settled directly into your bank account or UPI ID at the end of each calendar month.
        </p>
      </div>

      <WithdrawalsClient
        merchant={merchant}
        settlements={settlementsRes.rows}
      />
    </div>
  );
}
