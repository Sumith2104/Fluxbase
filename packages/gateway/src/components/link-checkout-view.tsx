'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface LinkCheckoutProps {
  link: {
    id: string;
    merchantId: string;
    merchantName: string;
    title: string;
    description: string | null;
    amount: number;
  };
}

export const LinkCheckoutView: React.FC<LinkCheckoutProps> = ({ link }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryUserId = searchParams.get('userId') || '';
  const queryEmail = searchParams.get('email') || '';
  const queryName = searchParams.get('name') || '';
  const queryCallbackUrl = searchParams.get('callbackUrl') || '';
  const queryPlan = searchParams.get('plan') || '';

  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount_amount: number;
    final_amount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  const [customerName, setCustomerName] = useState(queryName);
  const [customerPhone, setCustomerPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const currentAmount = appliedCoupon ? appliedCoupon.final_amount : link.amount;

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;

    setCouponError('');
    setValidatingCoupon(true);

    try {
      const res = await fetch('/api/v1/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponCode.trim(),
          amount: link.amount,
          merchant_id: link.merchantId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error(data.error || 'Invalid or expired coupon code');
      }

      setAppliedCoupon({
        code: data.coupon.code,
        discount_amount: data.discount_amount,
        final_amount: data.final_amount,
      });
      setCouponCode('');
    } catch (err: any) {
      setCouponError(err.message);
      setAppliedCoupon(null);
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError('');
  };

  const handleProceedToPay = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/links/${link.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coupon_code: appliedCoupon ? appliedCoupon.code : undefined,
          customer_name: customerName.trim() || queryName || undefined,
          customer_phone: customerPhone.trim() || undefined,
          customer_email: queryEmail || undefined,
          callback_url: queryCallbackUrl || undefined,
          user_id: queryUserId || undefined,
          plan: queryPlan || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate payment');

      router.push(data.checkout_url);
    } catch (err: any) {
      alert(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 selection:bg-[#ff6600] selection:text-black">
      <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-lg p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="border-b border-[#27272a] pb-4">
          <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
            FLUXPAY // SECURE CHECKOUT
          </div>
          <h1 className="text-xl font-bold text-[#f4f4f5] mt-1 tracking-tight">
            {link.title}
          </h1>
          <div className="text-xs text-[#a1a1aa] mt-1 flex items-center gap-2">
            <span>BY:</span>
            <span className="text-[#f4f4f5] font-semibold">{link.merchantName}</span>
          </div>
          {link.description && (
            <p className="text-xs text-[#71717a] mt-2 leading-relaxed">
              {link.description}
            </p>
          )}
        </div>

        {/* Amount & Price Breakdown */}
        <div className="bg-[#0b0b0b] border border-[#27272a] rounded p-4 space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between text-[#a1a1aa]">
            <span>SUBTOTAL:</span>
            <span>₹{link.amount.toFixed(2)}</span>
          </div>

          {appliedCoupon && (
            <div className="flex items-center justify-between text-emerald-400">
              <div className="flex items-center gap-2">
                <span>COUPON [{appliedCoupon.code}]:</span>
                <button
                  onClick={handleRemoveCoupon}
                  className="text-[10px] text-rose-400 hover:underline uppercase"
                >
                  [REMOVE]
                </button>
              </div>
              <span>-₹{appliedCoupon.discount_amount.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t border-[#27272a] pt-2 flex items-center justify-between font-bold text-sm">
            <span className="text-[#f4f4f5]">TOTAL PAYABLE:</span>
            <span className="text-[#ff6600] text-base">₹{currentAmount.toFixed(2)}</span>
          </div>
        </div>

        {/* Coupon Code Box */}
        <div className="space-y-2">
          <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase">
            HAVE A DISCOUNT COUPON?
          </label>
          {appliedCoupon ? (
            <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded flex items-center justify-between text-xs font-mono text-emerald-400">
              <span>COUPON {appliedCoupon.code} APPLIED (-₹{appliedCoupon.discount_amount.toFixed(2)})</span>
              <button
                onClick={handleRemoveCoupon}
                className="text-rose-400 hover:underline text-[10px] uppercase font-bold"
              >
                REMOVE
              </button>
            </div>
          ) : (
            <form onSubmit={handleApplyCoupon} className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="ENTER COUPON (e.g. SAVE20)"
                style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                className="flex-1 bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono uppercase focus:border-[#ff6600]"
              />
              <button
                type="submit"
                disabled={validatingCoupon || !couponCode.trim()}
                className="px-4 py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] hover:border-[#ff6600] text-xs font-mono font-bold text-[#f4f4f5] rounded transition disabled:opacity-50 uppercase"
              >
                {validatingCoupon ? 'CHECKING...' : 'APPLY'}
              </button>
            </form>
          )}

          {couponError && (
            <div className="text-[11px] font-mono text-rose-400">
              {couponError}
            </div>
          )}
        </div>

        {/* Customer Info (Optional) */}
        <div className="space-y-3 pt-2 border-t border-[#27272a]">
          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              YOUR NAME (OPTIONAL)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Rajesh Kumar"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase mb-1">
              PHONE NUMBER (OPTIONAL)
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
              className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono focus:border-[#ff6600]"
            />
          </div>
        </div>

        {/* Proceed Button */}
        <button
          onClick={handleProceedToPay}
          disabled={loading}
          style={{ backgroundColor: '#ff6600', color: '#000000' }}
          className="w-full py-3 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold text-xs font-mono rounded uppercase transition disabled:opacity-50 shadow-lg"
        >
          {loading ? 'INITIALIZING UPI PAYMENT...' : `PROCEED TO PAY ₹${currentAmount.toFixed(2)} ->`}
        </button>

        <div className="text-center text-[10px] font-mono text-[#71717a]">
          POWERED BY FLUXPAY // DIRECT STATE BANK UPI
        </div>
      </div>
    </div>
  );
};
