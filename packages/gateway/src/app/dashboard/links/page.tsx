import React from 'react';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { LinksClient } from './links-client';

export const revalidate = 0;

export default async function PaymentLinksPage() {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  const pool = getPool();
  const linksRes = await pool.query(
    `SELECT * FROM payment_links
     WHERE merchant_id = $1
     ORDER BY created_at DESC`,
    [merchant.id]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5]">
          INSTANT PAYMENT LINKS
        </h1>
        <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
          Generate no-code payment links to share with customers via WhatsApp, email, or chat.
        </p>
      </div>

      <LinksClient initialLinks={linksRes.rows} />
    </div>
  );
}
