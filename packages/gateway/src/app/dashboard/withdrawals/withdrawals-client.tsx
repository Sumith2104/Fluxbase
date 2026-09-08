'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';

interface SettlementItem {
  id: string;
  amount: number;
  status: string;
  payout_method: string;
  payout_address: string;
  utr_reference: string | null;
  requested_at: string;
  settled_at: string | null;
}

export const WithdrawalsClient: React.FC<{
  merchant: any;
  settlements: SettlementItem[];
}> = ({ merchant, settlements }) => {
  const router = useRouter();
  const balance = parseFloat(merchant.balance || '0');

  // Withdrawal Request States
  const [withdrawAmount, setWithdrawAmount] = useState(balance > 0 ? balance.toString() : '');
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestMsg, setRequestMsg] = useState('');
  const [requestErr, setRequestErr] = useState('');

  // Bank / UPI Details States
  const [payoutUpi, setPayoutUpi] = useState(merchant.payout_upi_id || '');
  const [bankAcc, setBankAcc] = useState(merchant.payout_bank_acc || '');
  const [ifsc, setIfsc] = useState(merchant.payout_ifsc || '');
  const [holderName, setHolderName] = useState(merchant.payout_holder_name || '');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestErr('');
    setRequestMsg('');
    setRequestLoading(true);

    try {
      const res = await fetch('/api/v1/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(withdrawAmount),
          payout_address: payoutUpi || bankAcc,
          payout_method: payoutUpi ? 'upi' : 'bank_transfer',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit withdrawal request');

      setRequestMsg('Withdrawal request submitted successfully! Funds will be disbursed at the end of the month.');
      setWithdrawAmount('');
      router.refresh();
    } catch (err: any) {
      setRequestErr(err.message);
    } finally {
      setRequestLoading(false);
    }
  };

  const handleSaveBankDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMsg('');
    setSettingsLoading(true);

    try {
      const res = await fetch('/api/v1/merchant/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payout_upi_id: payoutUpi,
          payout_bank_acc: bankAcc,
          payout_ifsc: ifsc,
          payout_holder_name: holderName,
        }),
      });

      if (!res.ok) throw new Error('Failed to update bank details');

      setSettingsMsg('Payout settings updated successfully.');
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Split: Balance & Request Payout vs Bank Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Request Payout Card */}
        <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 space-y-4">
          <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-wider font-bold">
            AVAILABLE FOR WITHDRAWAL
          </div>
          <div className="text-3xl font-mono font-bold text-[#f4f4f5]">
            ₹{balance.toFixed(2)}
          </div>
          <p className="text-xs text-[#a1a1aa]">
            All verified incoming payments are accumulated into your balance and disbursed at the end of the monthly billing cycle.
          </p>

          {requestMsg && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs font-mono text-emerald-400">
              {requestMsg}
            </div>
          )}

          {requestErr && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded text-xs font-mono text-rose-400">
              {requestErr}
            </div>
          )}

          <form onSubmit={handleRequestPayout} className="space-y-3 pt-2">
            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                WITHDRAWAL AMOUNT (INR)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  max={balance}
                  required
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                  className="flex-1 bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
                <button
                  type="button"
                  onClick={() => setWithdrawAmount(balance.toString())}
                  className="px-3 py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] rounded text-xs font-mono text-[#a1a1aa] hover:text-[#f4f4f5]"
                >
                  MAX
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={requestLoading || balance <= 0}
              style={{ backgroundColor: '#ff6600', color: '#000000' }}
              className="w-full py-2.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition disabled:opacity-40"
            >
              {requestLoading ? 'SUBMITTING...' : 'REQUEST MONTH-END SETTLEMENT'}
            </button>
          </form>
        </div>

        {/* Bank & UPI Settings Card */}
        <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 space-y-4">
          <div className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-wider font-bold">
            PAYOUT DESTINATION DETAILS
          </div>
          <p className="text-xs text-[#71717a]">
            Where you want your earnings transferred at month end (UPI ID or Direct Bank Transfer).
          </p>

          {settingsMsg && (
            <div className="p-2 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs font-mono text-emerald-400">
              {settingsMsg}
            </div>
          )}

          <form onSubmit={handleSaveBankDetails} className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                PAYOUT UPI ID (FASTEST)
              </label>
              <input
                type="text"
                placeholder="yourname@okhdfcbank"
                value={payoutUpi}
                onChange={(e) => setPayoutUpi(e.target.value)}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-1.5 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                  BANK ACCOUNT NO
                </label>
                <input
                  type="text"
                  placeholder="123456789012"
                  value={bankAcc}
                  onChange={(e) => setBankAcc(e.target.value)}
                  style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-1.5 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                  IFSC CODE
                </label>
                <input
                  type="text"
                  placeholder="HDFC0001234"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value)}
                  style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-1.5 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                ACCOUNT HOLDER NAME
              </label>
              <input
                type="text"
                placeholder="Sumith U"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-1.5 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
              />
            </div>

            <button
              type="submit"
              disabled={settingsLoading}
              className="w-full py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] font-semibold text-xs font-mono rounded transition disabled:opacity-50"
            >
              {settingsLoading ? 'SAVING...' : 'SAVE PAYOUT DETAILS'}
            </button>
          </form>
        </div>
      </div>

      {/* Settlement History Table */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#27272a] flex items-center justify-between">
          <h2 className="text-sm font-bold font-mono tracking-wider uppercase text-[#f4f4f5]">
            SETTLEMENT & WITHDRAWAL HISTORY
          </h2>
          <span className="text-xs font-mono text-[#a1a1aa]">
            {settlements.length} DISBURSEMENTS
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0b0b0b] text-[#a1a1aa] border-b border-[#27272a] uppercase">
              <tr>
                <th className="px-6 py-3">SETTLEMENT ID</th>
                <th className="px-6 py-3">AMOUNT</th>
                <th className="px-6 py-3">METHOD</th>
                <th className="px-6 py-3">DESTINATION</th>
                <th className="px-6 py-3">STATUS</th>
                <th className="px-6 py-3">DISBURSEMENT UTR</th>
                <th className="px-6 py-3">REQUESTED DATE</th>
                <th className="px-6 py-3">SETTLED DATE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272a]">
              {settlements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-[#71717a]">
                    No withdrawal requests submitted yet.
                  </td>
                </tr>
              ) : (
                settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-[#18181b]/60 transition">
                    <td className="px-6 py-3.5 text-[#f4f4f5] font-bold">
                      {s.id}
                    </td>
                    <td className="px-6 py-3.5 text-[#f4f4f5] font-bold">
                      ₹{parseFloat(s.amount.toString()).toFixed(2)}
                    </td>
                    <td className="px-6 py-3.5 uppercase text-zinc-400">
                      {s.payout_method}
                    </td>
                    <td className="px-6 py-3.5 text-zinc-300">
                      {s.payout_address}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-6 py-3.5 text-[#ff6600]">
                      {s.utr_reference || 'Awaiting Month-End Payout'}
                    </td>
                    <td className="px-6 py-3.5 text-[#71717a]">
                      {new Date(s.requested_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3.5 text-[#71717a]">
                      {s.settled_at ? new Date(s.settled_at).toLocaleDateString() : '—'}
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
};
