'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [payoutUpi, setPayoutUpi] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/merchant/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName,
          email,
          password,
          payout_upi_id: payoutUpi,
          phone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create merchant account');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-lg p-6 shadow-2xl space-y-6">
        <div>
          <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
            FLUXPAY // MERCHANT REGISTRATION
          </div>
          <h1 className="text-lg font-bold text-[#f4f4f5] mt-1 tracking-tight">
            CREATE PAYMENT GATEWAY ACCOUNT
          </h1>
          <p className="text-xs text-[#71717a] mt-1">
            Accept automated UPI payments in your web & mobile apps with monthly automated withdrawals.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded text-xs font-mono text-rose-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              BUSINESS OR APP NAME
            </label>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Acme SaaS / GameStore"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              EMAIL ADDRESS (LOGIN ID)
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="developer@example.com"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              PASSWORD (MIN 6 CHARACTERS)
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              WITHDRAWAL UPI ID (FOR MONTHLY SETTLEMENTS)
            </label>
            <input
              type="text"
              required
              value={payoutUpi}
              onChange={(e) => setPayoutUpi(e.target.value)}
              placeholder="yourname@okhdfcbank"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              MOBILE NUMBER (OPTIONAL)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9876543210"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ backgroundColor: '#ff6600', color: '#000000' }}
            className="w-full py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition disabled:opacity-50 mt-2"
          >
            {loading ? 'INITIALIZING ACCOUNT...' : 'CREATE MERCHANT ACCOUNT'}
          </button>
        </form>

        <div className="pt-2 border-t border-[#27272a] flex items-center justify-between text-[11px] font-mono text-[#71717a]">
          <span>ALREADY HAVE AN ACCOUNT?</span>
          <Link href="/login" className="text-[#ff6600] hover:underline">
            LOG IN HERE
          </Link>
        </div>
      </div>
    </div>
  );
}
