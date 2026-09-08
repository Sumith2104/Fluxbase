'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/merchant/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
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
      <div className="w-full max-w-sm bg-[#121214] border border-[#27272a] rounded-lg p-6 shadow-2xl space-y-6">
        <div>
          <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
            FLUXPAY // MERCHANT PORTAL
          </div>
          <h1 className="text-lg font-bold text-[#f4f4f5] mt-1 tracking-tight">
            CLIENT LOGIN
          </h1>
          <p className="text-xs text-[#71717a] mt-1">
            Access your gateway dashboard, wallet balance, and API credentials.
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
              EMAIL ADDRESS
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
              PASSWORD
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

          <button
            type="submit"
            disabled={loading}
            style={{ backgroundColor: '#ff6600', color: '#000000' }}
            className="w-full py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition disabled:opacity-50"
          >
            {loading ? 'AUTHENTICATING...' : 'ACCESS DASHBOARD'}
          </button>
        </form>

        <div className="pt-3 border-t border-[#27272a] flex items-center justify-between text-[11px] font-mono text-[#71717a]">
          <span>NEW CLIENT?</span>
          <Link href="/signup" className="text-[#ff6600] hover:underline">
            REGISTER ACCOUNT →
          </Link>
        </div>
      </div>
    </div>
  );
}
