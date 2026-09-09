import React from 'react';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { TransactionsManager } from '@/components/transactions-manager';

export const revalidate = 0;

export default async function MerchantPaymentsPage() {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  const pool = getPool();

  // Fetch recent orders for this merchant
  const ordersRes = await pool.query(
    `SELECT o.id, o.base_amount, o.offset_cents, o.final_amount, o.status,
            o.customer_name, o.customer_email, o.customer_phone, o.utr,
            o.created_at, o.paid_at, o.expires_at, o.metadata,
            v.vpa_address
     FROM orders o
     LEFT JOIN vpas v ON o.vpa_id = v.id
     WHERE o.merchant_id = $1
     ORDER BY o.created_at DESC
     LIMIT 100`,
    [merchant.id]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5] font-mono">
            PAYMENT RECORDS // FULL DATA MANIPULATION
          </h1>
          <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
            Real-time ledger with inline status updates, UTR management, CSV export, and record creation.
          </p>
        </div>
      </div>

      <TransactionsManager initialOrders={ordersRes.rows} />
    </div>
  );
}
