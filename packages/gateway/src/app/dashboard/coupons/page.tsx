import React from 'react';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { CouponsClient } from './coupons-client';

export const revalidate = 0;

export default async function CouponsPage() {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  const pool = getPool();
  const couponsRes = await pool.query(
    `SELECT * FROM coupons 
     WHERE merchant_id = $1 
     ORDER BY created_at DESC`,
    [merchant.id]
  );

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
          FLUXPAY // MARKETING &amp; PROMOTIONS
        </div>
        <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5] mt-1">
          DISCOUNT COUPONS
        </h1>
        <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
          Create and manage percentage or flat discount codes for checkout orders and shareable payment links.
        </p>
      </div>

      <CouponsClient initialCoupons={couponsRes.rows} />
    </div>
  );
}
