import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { getSessionMerchant } from '@/lib/merchant-session';
import { StatusBadge } from '@/components/status-badge';

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

      {/* Live Transactions Table */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#27272a] flex items-center justify-between">
          <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-[#f4f4f5]">
            TRANSACTION LEDGER ({orders.length} RECENT)
          </h2>
          <span className="text-xs font-mono text-[#a1a1aa]">
            AUTO-CREDITED VIA MACRODROID
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0b0b0b] text-[#a1a1aa] border-b border-[#27272a] uppercase">
              <tr>
                <th className="px-6 py-3">ORDER ID</th>
                <th className="px-6 py-3">CUSTOMER</th>
                <th className="px-6 py-3">BASE AMT</th>
                <th className="px-6 py-3">PAID AMT</th>
                <th className="px-6 py-3">OFFSET</th>
                <th className="px-6 py-3">UPI HANDLE</th>
                <th className="px-6 py-3">STATUS</th>
                <th className="px-6 py-3">BANK UTR</th>
                <th className="px-6 py-3">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272a]">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-[#71717a]">
                    No transactions recorded yet. Generate an order via API or create a Payment Link.
                  </td>
                </tr>
              ) : (
                orders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-[#18181b]/60 transition">
                    <td className="px-6 py-3.5 text-[#f4f4f5] font-bold">
                      {o.id}
                    </td>
                    <td className="px-6 py-3.5 text-[#a1a1aa]">
                      {o.customer_name || o.customer_email || 'Direct Buyer'}
                    </td>
                    <td className="px-6 py-3.5 text-[#a1a1aa]">
                      ₹{o.base_amount}
                    </td>
                    <td className="px-6 py-3.5 text-[#f4f4f5] font-bold">
                      ₹{parseFloat(o.final_amount).toFixed(2)}
                    </td>
                    <td className="px-6 py-3.5 text-[#ff6600]">
                      +{o.offset_cents}p
                    </td>
                    <td className="px-6 py-3.5 text-[#a1a1aa]">
                      {o.vpa_address}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-6 py-3.5 text-[#71717a]">
                      {o.utr || '—'}
                    </td>
                    <td className="px-6 py-3.5">
                      <Link
                        href={`/pay/${o.id}`}
                        target="_blank"
                        className="text-[11px] text-[#ff6600] hover:text-[#ff7a1a] underline"
                      >
                        CHECKOUT
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
