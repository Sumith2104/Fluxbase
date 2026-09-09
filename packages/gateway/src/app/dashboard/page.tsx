import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { StatusBadge } from '@/components/status-badge';
import { TransactionsManager } from '@/components/transactions-manager';

export const revalidate = 0;

export default async function MerchantDashboardOverview() {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  const pool = getPool();

  // Query order stats for this merchant
  const statsRes = await pool.query(
    `SELECT
       COUNT(id) FILTER (WHERE status = 'paid') as paid_count,
       COUNT(id) FILTER (WHERE status = 'pending') as pending_count,
       COUNT(id) as total_count
     FROM orders
     WHERE merchant_id = $1`,
    [merchant.id]
  );

  // Recent 25 orders for this merchant
  const ordersRes = await pool.query(
    `SELECT o.id, o.base_amount, o.offset_cents, o.final_amount, o.status,
            o.customer_name, o.customer_email, o.utr, o.created_at, v.vpa_address
     FROM orders o
     JOIN vpas v ON o.vpa_id = v.id
     WHERE o.merchant_id = $1
     ORDER BY o.created_at DESC
     LIMIT 25`,
    [merchant.id]
  );

  const stats = statsRes.rows[0];
  const orders = ordersRes.rows;

  const balance = parseFloat(merchant.balance || '0');
  const totalEarned = parseFloat(merchant.total_earned || '0');
  const paidCount = parseInt(stats.paid_count || '0', 10);
  const pendingCount = parseInt(stats.pending_count || '0', 10);
  const totalCount = parseInt(stats.total_count || '0', 10);
  const successRate = totalCount > 0 ? ((paidCount / totalCount) * 100).toFixed(1) : '100.0';

  return (
    <div className="space-y-8">
      {/* Top Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#f4f4f5]">
            MERCHANT OVERVIEW // {merchant.business_name || merchant.name}
          </h1>
          <p className="text-xs text-[#a1a1aa] font-mono mt-0.5">
            Real-time wallet balance, incoming customer UPI transactions, and monthly settlements.
          </p>
        </div>
        <Link
          href="/dashboard/withdrawals"
          className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition"
        >
          WITHDRAW BALANCE →
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Withdrawable Balance Card */}
        <div className="bg-[#121214] border border-[#27272a] rounded-lg p-5 relative overflow-hidden">
          <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-wider font-bold">
            WITHDRAWABLE BALANCE
          </div>
          <div className="text-3xl font-mono font-bold text-[#f4f4f5] mt-2 tracking-tight">
            ₹{balance.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-[#a1a1aa] mt-2">
            Available for end-of-month payout
          </div>
        </div>

        {/* Lifetime Earnings */}
        <div className="bg-[#121214] border border-[#27272a] rounded-lg p-5">
          <div className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-wider">
            LIFETIME SETTLED VOLUME
          </div>
          <div className="text-3xl font-mono font-bold text-[#f4f4f5] mt-2 tracking-tight">
            ₹{totalEarned.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-emerald-400 mt-2">
            {paidCount} COMPLETED ORDERS
          </div>
        </div>

        {/* Pending Orders */}
        <div className="bg-[#121214] border border-[#27272a] rounded-lg p-5">
          <div className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-wider">
            PENDING ORDERS
          </div>
          <div className="text-3xl font-mono font-bold text-amber-400 mt-2 tracking-tight">
            {pendingCount}
          </div>
          <div className="text-[11px] font-mono text-[#71717a] mt-2">
            Awaiting customer payment
          </div>
        </div>

        {/* Success Rate */}
        <div className="bg-[#121214] border border-[#27272a] rounded-lg p-5">
          <div className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-wider">
            SETTLEMENT RATE
          </div>
          <div className="text-3xl font-mono font-bold text-[#f4f4f5] mt-2 tracking-tight">
            {successRate}%
          </div>
          <div className="text-[11px] font-mono text-[#a1a1aa] mt-2">
            Out of {totalCount} total orders
          </div>
        </div>
      </div>

      {/* Interactive Payment Records & Transactions Management Console */}
      <TransactionsManager initialOrders={orders} />
    </div>
  );
}
