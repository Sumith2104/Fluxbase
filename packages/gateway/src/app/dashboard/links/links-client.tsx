'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PaymentLinkItem {
  id: string;
  title: string;
  amount: number;
  description: string | null;
  created_at: string;
}

export const LinksClient: React.FC<{ initialLinks: PaymentLinkItem[] }> = ({
  initialLinks,
}) => {
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/v1/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          amount: parseFloat(amount),
          description,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create payment link');

      setTitle('');
      setAmount('');
      setDescription('');
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (linkId: string) => {
    const url = `${window.location.origin}/pay/link/${linkId}`;
    navigator.clipboard.writeText(url);
    setCopiedId(linkId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-8">
      {/* Create Link Form */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 max-w-2xl">
        <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5] mb-4">
          GENERATE SHAREABLE PAYMENT LINK
        </h2>

        <form onSubmit={handleCreateLink} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                ITEM / SERVICE TITLE
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Pro Monthly Plan"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                AMOUNT (INR)
              </label>
              <input
                type="number"
                step="1"
                required
                placeholder="499"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              NOTE / DESCRIPTION (OPTIONAL)
            </label>
            <input
              type="text"
              placeholder="Immediate access to platform features"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ backgroundColor: '#ff6600', color: '#000000' }}
            className="px-6 py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition disabled:opacity-50"
          >
            {loading ? 'CREATING...' : '+ CREATE PAYMENT LINK'}
          </button>
        </form>
      </div>

      {/* Links List */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#27272a]">
          <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5]">
            ACTIVE PAYMENT LINKS
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0b0b0b] text-[#a1a1aa] border-b border-[#27272a] uppercase">
              <tr>
                <th className="px-6 py-3">TITLE</th>
                <th className="px-6 py-3">AMOUNT</th>
                <th className="px-6 py-3">DESCRIPTION</th>
                <th className="px-6 py-3">CREATED DATE</th>
                <th className="px-6 py-3">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272a]">
              {links.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[#71717a]">
                    No payment links generated yet.
                  </td>
                </tr>
              ) : (
                links.map((l) => (
                  <tr key={l.id} className="hover:bg-[#18181b]/60 transition">
                    <td className="px-6 py-3.5 text-[#f4f4f5] font-bold">
                      {l.title}
                    </td>
                    <td className="px-6 py-3.5 text-[#f4f4f5] font-bold">
                      ₹{parseFloat(l.amount.toString()).toFixed(2)}
                    </td>
                    <td className="px-6 py-3.5 text-[#a1a1aa]">
                      {l.description || '—'}
                    </td>
                    <td className="px-6 py-3.5 text-[#71717a]">
                      {new Date(l.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3.5">
                      <button
                        type="button"
                        onClick={() => copyLink(l.id)}
                        className="px-3 py-1 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-[#f4f4f5] rounded text-[11px] font-mono transition"
                      >
                        {copiedId === l.id ? 'COPIED LINK' : 'COPY LINK'}
                      </button>
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
