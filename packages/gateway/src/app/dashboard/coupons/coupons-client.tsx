'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CouponItem {
  id: string;
  code: string;
  discount_type: 'percentage' | 'flat';
  discount_value: string | number;
  min_order_amount: string | number;
  max_discount_amount: string | number | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export const CouponsClient: React.FC<{ initialCoupons: CouponItem[] }> = ({
  initialCoupons,
}) => {
  const router = useRouter();
  const [coupons, setCoupons] = useState<CouponItem[]>(initialCoupons);

  // Form State
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'flat'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState('0');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Metrics
  const totalCoupons = coupons.length;
  const activeCoupons = coupons.filter((c) => c.is_active).length;
  const totalRedemptions = coupons.reduce((sum, c) => sum + (c.used_count || 0), 0);

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await fetch('/api/v1/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          discount_type: discountType,
          discount_value: parseFloat(discountValue),
          min_order_amount: parseFloat(minOrderAmount || '0'),
          max_discount_amount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
          usage_limit: usageLimit ? parseInt(usageLimit, 10) : null,
          expires_at: expiresAt || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create coupon');

      setSuccess(`Coupon '${data.coupon.code}' created successfully.`);
      setCode('');
      setDiscountValue('');
      setMinOrderAmount('0');
      setMaxDiscountAmount('');
      setUsageLimit('');
      setExpiresAt('');

      setCoupons([data.coupon, ...coupons]);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (coupon: CouponItem) => {
    try {
      const res = await fetch(`/api/v1/coupons/${coupon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !coupon.is_active }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');

      setCoupons(
        coupons.map((c) => (c.id === coupon.id ? { ...c, is_active: !c.is_active } : c))
      );
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (couponId: string) => {
    if (!confirm('Are you sure you want to delete this coupon?')) return;

    try {
      const res = await fetch(`/api/v1/coupons/${couponId}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete coupon');

      setCoupons(coupons.filter((c) => c.id !== couponId));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const copyCode = (couponCode: string) => {
    navigator.clipboard.writeText(couponCode);
    setCopiedCode(couponCode);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-8">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
          <div className="text-[10px] font-mono text-[#71717a] uppercase">TOTAL COUPONS</div>
          <div className="text-2xl font-bold font-mono text-[#f4f4f5] mt-1">{totalCoupons}</div>
          <div className="text-[11px] text-[#a1a1aa] mt-0.5">Campaigns registered</div>
        </div>

        <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
          <div className="text-[10px] font-mono text-[#71717a] uppercase">ACTIVE COUPONS</div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{activeCoupons}</div>
          <div className="text-[11px] text-[#a1a1aa] mt-0.5">Available for customer checkout</div>
        </div>

        <div className="p-4 bg-[#121214] border border-[#27272a] rounded">
          <div className="text-[10px] font-mono text-[#71717a] uppercase">TOTAL REDEMPTIONS</div>
          <div className="text-2xl font-bold font-mono text-[#ff6600] mt-1">{totalRedemptions}</div>
          <div className="text-[11px] text-[#a1a1aa] mt-0.5">Successful orders discounted</div>
        </div>
      </div>

      {/* Create Coupon Form */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 max-w-3xl">
        <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5] mb-4">
          CREATE NEW DISCOUNT COUPON
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-rose-950/40 border border-rose-800/60 rounded text-xs font-mono text-rose-400">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs font-mono text-emerald-400">
            {success}
          </div>
        )}

        <form onSubmit={handleCreateCoupon} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                COUPON CODE (e.g. SAVE20, WELCOME50)
              </label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="DISCOUNT20"
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono uppercase focus:border-[#ff6600]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                DISCOUNT TYPE
              </label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as any)}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
              >
                <option value="percentage">PERCENTAGE DISCOUNT (%)</option>
                <option value="flat">FLAT RUPEES DISCOUNT (₹)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                DISCOUNT VALUE {discountType === 'percentage' ? '(%)' : '(₹)'}
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percentage' ? '20' : '50.00'}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                MIN ORDER AMOUNT (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                placeholder="0.00"
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                MAX DISCOUNT CAP (₹, OPTIONAL)
              </label>
              <input
                type="number"
                step="0.01"
                value={maxDiscountAmount}
                onChange={(e) => setMaxDiscountAmount(e.target.value)}
                placeholder="e.g. 200.00"
                disabled={discountType === 'flat'}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600] disabled:opacity-40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                TOTAL USAGE LIMIT (OPTIONAL)
              </label>
              <input
                type="number"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
                placeholder="e.g. 100"
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
                EXPIRATION DATE &amp; TIME (OPTIONAL)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ backgroundColor: '#ff6600', color: '#000000' }}
            className="px-6 py-2.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-mono font-bold text-xs rounded transition uppercase disabled:opacity-50"
          >
            {loading ? 'CREATING COUPON...' : '[+] SAVE COUPON'}
          </button>
        </form>
      </div>

      {/* Coupons Table */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-[#f4f4f5]">
          YOUR ACTIVE &amp; EXPIRED COUPONS
        </h2>

        {coupons.length === 0 ? (
          <div className="p-8 bg-[#121214] border border-[#27272a] rounded-lg text-center text-xs font-mono text-[#71717a]">
            NO COUPONS CONFIGURED YET. CREATE YOUR FIRST CAMPAIGN ABOVE.
          </div>
        ) : (
          <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#18181b] text-[#a1a1aa] border-b border-[#27272a]">
                <tr>
                  <th className="p-3">COUPON CODE</th>
                  <th className="p-3">DISCOUNT</th>
                  <th className="p-3">MIN ORDER</th>
                  <th className="p-3">USAGE</th>
                  <th className="p-3">EXPIRATION</th>
                  <th className="p-3">STATUS</th>
                  <th className="p-3 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a] text-[#d4d4d8]">
                {coupons.map((c) => {
                  const val = parseFloat(String(c.discount_value));
                  const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                  const isExhausted = c.usage_limit && c.used_count >= c.usage_limit;

                  return (
                    <tr key={c.id} className="hover:bg-[#18181b]/50 transition">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#ff6600] bg-[#0b0b0b] border border-[#27272a] px-2 py-0.5 rounded">
                            {c.code}
                          </span>
                          <button
                            onClick={() => copyCode(c.code)}
                            className="text-[10px] text-[#a1a1aa] hover:text-[#f4f4f5] uppercase"
                          >
                            {copiedCode === c.code ? '[COPIED]' : '[COPY]'}
                          </button>
                        </div>
                      </td>
                      <td className="p-3">
                        {c.discount_type === 'percentage' ? (
                          <span>
                            {val}% OFF
                            {c.max_discount_amount && (
                              <span className="text-[10px] text-[#71717a] ml-1">
                                (Max ₹{parseFloat(String(c.max_discount_amount)).toFixed(2)})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span>₹{val.toFixed(2)} FLAT</span>
                        )}
                      </td>
                      <td className="p-3 text-[#a1a1aa]">
                        ₹{parseFloat(String(c.min_order_amount || '0')).toFixed(2)}
                      </td>
                      <td className="p-3">
                        <span>{c.used_count}</span>
                        <span className="text-[#71717a]">
                          {' / '}
                          {c.usage_limit ? c.usage_limit : 'Unlimited'}
                        </span>
                      </td>
                      <td className="p-3 text-[#a1a1aa]">
                        {c.expires_at ? (
                          <span className={isExpired ? 'text-rose-400' : ''}>
                            {new Date(c.expires_at).toLocaleDateString()}{' '}
                            {new Date(c.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          'No Expiry'
                        )}
                      </td>
                      <td className="p-3">
                        {isExpired ? (
                          <span className="px-2 py-0.5 bg-rose-950 text-rose-400 border border-rose-800 rounded text-[10px] font-bold">
                            EXPIRED
                          </span>
                        ) : isExhausted ? (
                          <span className="px-2 py-0.5 bg-amber-950 text-amber-400 border border-amber-800 rounded text-[10px] font-bold">
                            LIMIT REACHED
                          </span>
                        ) : c.is_active ? (
                          <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded text-[10px] font-bold">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700 rounded text-[10px] font-bold">
                            DISABLED
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleActive(c)}
                            className="px-2 py-1 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[10px] uppercase rounded text-[#a1a1aa] hover:text-[#f4f4f5]"
                          >
                            {c.is_active ? 'DISABLE' : 'ENABLE'}
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="px-2 py-1 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/80 text-[10px] uppercase rounded text-rose-400"
                          >
                            DELETE
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
