import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionMerchant } from '@/lib/merchant-session';
import { MerchantNavClient } from './merchant-nav-client';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const merchant = await getSessionMerchant();
  if (!merchant) {
    redirect('/login');
  }

  const balanceNum = parseFloat(merchant.balance || '0');

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-[#27272a] bg-[#121214] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div>
            <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
              FLUXPAY // CLIENT
            </div>
            <div className="text-xs font-semibold text-[#f4f4f5] tracking-tight truncate max-w-[160px]">
              {merchant.business_name || merchant.name}
            </div>
          </div>

          <MerchantNavClient />
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/withdrawals"
            className="flex items-center gap-2 text-xs font-mono bg-[#0b0b0b] border border-[#27272a] hover:border-[#ff6600] px-3 py-1.5 rounded transition"
          >
            <span className="text-[#a1a1aa] uppercase text-[10px]">BALANCE:</span>
            <span className="text-[#f4f4f5] font-bold">₹{balanceNum.toFixed(2)}</span>
            <span className="text-[#ff6600] text-[10px] uppercase font-semibold">WITHDRAW</span>
          </Link>

          <form action="/api/auth/merchant/logout" method="POST">
            <button
              type="submit"
              className="px-3 py-1 text-xs font-mono uppercase bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] rounded transition"
            >
              LOGOUT
            </button>
          </form>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
    </div>
  );
}
