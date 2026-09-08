'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { StatusBadge } from './status-badge';

interface CheckoutViewProps {
  order: {
    id: string;
    merchantId?: string;
    merchant: string;
    title?: string;
    amount: number;
    final_amount: number;
    vpa: string;
    status: string;
    expires_at: string;
    callback_url?: string;
    utr?: string;
    coupon?: {
      code: string;
      discount: number;
      original_amount: number;
    } | null;
  };
function getCleanReturnUrl(rawCallback?: string | null, statusParam: string = 'paid', orderId?: string, utr?: string | null): string {
  let urlStr = rawCallback || 'https://www.fluxbasedb.me/dashboard/projects';
  // Strictly rewrite any vercel.app reference to the production domain https://www.fluxbasedb.me
  urlStr = urlStr.replace(/https?:\/\/[^\/]*vercel\.app/i, 'https://www.fluxbasedb.me');
  try {
    const u = new URL(urlStr);
    u.searchParams.set('status', statusParam);
    if (orderId) u.searchParams.set('order_id', orderId);
    if (utr) u.searchParams.set('utr', utr);
    return u.toString();
  } catch {
    const separator = urlStr.includes('?') ? '&' : '?';
    return `${urlStr}${separator}status=${statusParam}${orderId ? `&order_id=${orderId}` : ''}${utr ? `&utr=${utr}` : ''}`;
  }
}

export const CheckoutView: React.FC<CheckoutViewProps> = ({ order }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [utr, setUtr] = useState(order.utr || '');
  const [remainingSeconds, setRemainingSeconds] = useState(90);
  const [redirectCount, setRedirectCount] = useState<number | null>(null);

  // Dynamic pricing and coupon state
  const [baseAmount, setBaseAmount] = useState<number>(order.amount);
  const [finalAmount, setFinalAmount] = useState<number>(order.final_amount);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
    original_amount: number;
  } | null>(order.coupon || null);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');

  const finalAmountStr = finalAmount.toFixed(2);
  const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(order.vpa)}&pn=${encodeURIComponent(order.merchant || 'Merchant')}&am=${finalAmountStr}&cu=INR&tn=${encodeURIComponent(order.id)}`;

  // Render high-contrast QR Code on canvas (pure canvas, zero icons)
  useEffect(() => {
    if (canvasRef.current && status === 'pending') {
      QRCode.toCanvas(
        canvasRef.current,
        upiIntentUrl,
        {
          width: 220,
          margin: 1,
          color: {
            dark: '#f4f4f5',
            light: '#121214',
          },
        },
        (err) => {
          if (err) console.error('Failed to generate QR:', err);
        }
      );
    }
  }, [upiIntentUrl, status, finalAmount]);

  // Connect to SSE Live Status Stream
  useEffect(() => {
    if (status !== 'pending') return;

    const eventSource = new EventSource(`/api/v1/orders/${order.id}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status) {
          setStatus(data.status);
        }
        if (data.utr) {
          setUtr(data.utr);
        }
        if (typeof data.remaining_seconds === 'number') {
          setRemainingSeconds(data.remaining_seconds);
        }

        if (data.status === 'paid') {
          eventSource.close();
          if (order.callback_url) {
            setRedirectCount(2);
          }
        } else if (data.status === 'expired') {
          eventSource.close();
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [order.id, order.callback_url, status]);

  // Handle redirect countdown
  useEffect(() => {
    if (redirectCount === null) return;
    if (redirectCount <= 0) {
      if (order.callback_url) {
        window.location.href = getCleanReturnUrl(order.callback_url, 'paid', order.id, utr);
      }
      return;
    }

    const timer = setTimeout(() => {
      setRedirectCount((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [redirectCount, order.callback_url, order.id, utr]);

  // Apply Coupon Handler
  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCodeInput.trim()) return;

    setCouponError('');
    setCouponLoading(true);

    try {
      const res = await fetch(`/api/v1/orders/${order.id}/apply-coupon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupon_code: couponCodeInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to apply coupon');
      }

      setBaseAmount(data.base_amount);
      setFinalAmount(data.final_amount);
      setAppliedCoupon(data.coupon);
      setCouponCodeInput('');
    } catch (err: any) {
      setCouponError(err.message);
    } finally {
      setCouponLoading(false);
    }
  };

  // Remove Coupon Handler
  const handleRemoveCoupon = async () => {
    setCouponLoading(true);
    setCouponError('');
    try {
      const res = await fetch(`/api/v1/orders/${order.id}/apply-coupon`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to remove coupon');
      }
      setBaseAmount(data.base_amount);
      setFinalAmount(data.final_amount);
      setAppliedCoupon(null);
    } catch (err: any) {
      setCouponError(err.message);
    } finally {
      setCouponLoading(false);
    }
  };

  const copyVpa = () => {
    navigator.clipboard.writeText(order.vpa);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyAmount = () => {
    navigator.clipboard.writeText(finalAmountStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 selection:bg-[#ff6600] selection:text-black">
      <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden space-y-0">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-[#27272a] flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
              FLUXPAY // SECURE GATEWAY
            </div>
            <div className="text-sm font-semibold text-[#f4f4f5] tracking-tight">
              {order.merchant || 'Merchant Checkout'}
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Progress bar for slot countdown */}
        {status === 'pending' && (
          <div className="w-full bg-[#18181b] h-1">
            <div
              className="bg-[#ff6600] h-1 transition-all duration-1000 ease-linear"
              style={{ width: `${Math.max(0, Math.min(100, (remainingSeconds / 90) * 100))}%` }}
            />
          </div>
        )}

        {/* Content Body */}
        <div className="p-6">
          {status === 'paid' ? (
            <div className="py-8 text-center space-y-4 animate-in fade-in duration-500">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 font-mono text-2xl font-bold">
                ✓
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#f4f4f5] tracking-tight">
                  PAYMENT VERIFIED
                </h2>
                <p className="text-xs text-emerald-400 mt-1 font-mono">
                  VERIFIED BY PHONE NOTIFICATION ENGINE
                </p>
                <p className="text-xs text-[#a1a1aa] mt-1 font-mono">
                  {utr ? `BANK UTR: ${utr}` : 'INSTANT VERIFICATION CONFIRMED'}
                </p>
              </div>

              <div className="bg-[#18181b] border border-[#27272a] rounded p-3 text-xs font-mono text-zinc-400">
                Amount Paid: <span className="text-[#f4f4f5] font-bold">₹{finalAmountStr}</span>
              </div>

              <div className="p-3 bg-emerald-950/20 border border-emerald-800/40 rounded">
                <p className="text-xs text-[#ff6600] font-mono font-semibold">
                  {redirectCount !== null
                    ? `Payment confirmed! Redirecting to Fluxbase in ${redirectCount}s...`
                    : 'Payment complete! Ready to return.'}
                </p>
              </div>

              {order.callback_url && (
                <a
                  href={getCleanReturnUrl(order.callback_url, 'paid', order.id, utr)}
                  className="inline-block w-full py-2.5 bg-[#ff6600] text-black font-semibold text-xs rounded hover:bg-[#ff7a1a] transition font-mono uppercase"
                >
                  RETURN TO FLUXBASE NOW
                </a>
              )}
            </div>
          ) : status === 'expired' ? (
            <div className="py-8 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-400 font-mono text-xl">
                ✕
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#f4f4f5] tracking-tight">
                  PAYMENT WINDOW EXPIRED
                </h2>
                <p className="text-xs text-[#a1a1aa] mt-1">
                  The allocated payment slot timed out and was automatically released.
                </p>
              </div>
              <p className="text-xs text-zinc-500 font-mono">
                Please return to Fluxbase and initiate a fresh upgrade session.
              </p>
              {order.callback_url && (
                <a
                  href={getCleanReturnUrl(order.callback_url, 'expired', order.id)}
                  className="inline-block px-5 py-2.5 bg-[#ff6600] text-black font-semibold text-xs font-mono rounded hover:bg-[#ff7a1a] transition uppercase"
                >
                  RETURN TO FLUXBASE
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Order Review Section */}
              <div className="bg-[#0b0b0b] border border-[#27272a] rounded-lg p-4 space-y-2.5 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#a1a1aa] uppercase">ORDER ITEM:</span>
                  <span className="text-[#f4f4f5] font-bold">{order.title || 'SUBSCRIPTION TIER'}</span>
                </div>
                <div className="flex items-center justify-between text-[#a1a1aa]">
                  <span>BASE PLAN RATE:</span>
                  <span>₹{(appliedCoupon?.original_amount || baseAmount).toFixed(2)}</span>
                </div>

                {appliedCoupon && (
                  <div className="flex items-center justify-between text-emerald-400 font-semibold">
                    <div className="flex items-center gap-2">
                      <span>COUPON [{appliedCoupon.code}]:</span>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        disabled={couponLoading}
                        className="text-[10px] text-rose-400 hover:underline uppercase"
                      >
                        [REMOVE]
                      </button>
                    </div>
                    <span>-₹{appliedCoupon.discount.toFixed(2)}</span>
                  </div>
                )}

                <div className="border-t border-[#27272a] pt-2 flex items-center justify-between font-bold text-sm">
                  <span className="text-[#f4f4f5]">TOTAL PAYABLE:</span>
                  <span className="text-[#ff6600] text-base font-black">₹{finalAmountStr}</span>
                </div>
              </div>

              {/* Coupon Form */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-mono text-[#a1a1aa] uppercase">
                  HAVE A DISCOUNT COUPON?
                </label>
                {appliedCoupon ? (
                  <div className="p-2.5 bg-emerald-950/30 border border-emerald-800/60 rounded flex items-center justify-between text-xs font-mono text-emerald-400">
                    <span>COUPON {appliedCoupon.code} APPLIED (-₹{appliedCoupon.discount.toFixed(2)})</span>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      disabled={couponLoading}
                      className="text-rose-400 hover:underline text-[10px] uppercase font-bold"
                    >
                      REMOVE
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleApplyCoupon} className="flex gap-2">
                    <input
                      type="text"
                      value={couponCodeInput}
                      onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                      placeholder="ENTER COUPON (e.g. FLUX20)"
                      style={{ backgroundColor: '#0b0b0b', color: '#f4f4f5', borderColor: '#27272a' }}
                      className="flex-1 bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono uppercase focus:border-[#ff6600]"
                    />
                    <button
                      type="submit"
                      disabled={couponLoading || !couponCodeInput.trim()}
                      className="px-4 py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] hover:border-[#ff6600] text-xs font-mono font-bold text-[#f4f4f5] rounded transition disabled:opacity-50 uppercase"
                    >
                      {couponLoading ? 'CHECKING...' : 'APPLY'}
                    </button>
                  </form>
                )}
                {couponError && (
                  <div className="text-[11px] font-mono text-rose-400 pt-0.5">
                    {couponError}
                  </div>
                )}
              </div>

              {/* Amount Display with Decimal Slot */}
              <div className="text-center bg-[#0b0b0b] border border-primary/40 border-[#ff6600]/40 rounded-lg p-3.5 space-y-1">
                <div className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-wider">
                  PAY EXACT AMOUNT (INCL. RECONCILIATION SLOT)
                </div>
                <div className="text-2xl font-mono font-bold text-[#ff6600] tracking-tight flex items-center justify-center gap-2">
                  <span>₹{finalAmountStr}</span>
                  <button
                    type="button"
                    onClick={copyAmount}
                    className="text-[10px] font-mono uppercase px-2 py-0.5 border border-[#3f3f46] rounded text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#71717a]"
                  >
                    {copied ? 'COPIED' : 'COPY'}
                  </button>
                </div>
                <div className="text-[10px] font-mono text-zinc-400">
                  Transfer the exact amount for zero-typing instant automated verification.
                </div>
              </div>

              {/* High-Contrast QR Code */}
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="p-3 bg-[#121214] border border-[#27272a] rounded-lg shadow-inner">
                  <canvas ref={canvasRef} className="block rounded" />
                </div>
                <div className="text-[11px] font-mono text-[#71717a]">
                  Scan with any UPI app (GPay, PhonePe, Paytm, BHIM, CRED)
                </div>
              </div>

              {/* VPA Address Block */}
              <div className="bg-[#18181b] border border-[#27272a] rounded p-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono text-[#a1a1aa] uppercase">
                    UPI ID (STATE BANK OF INDIA POOL)
                  </div>
                  <div className="text-xs font-mono text-[#f4f4f5] mt-0.5 font-bold">
                    {order.vpa}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copyVpa}
                  className="text-xs font-mono uppercase px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded transition"
                >
                  {copied ? 'COPIED' : 'COPY ID'}
                </button>
              </div>

              {/* Mobile Deep Link Buttons */}
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-[#a1a1aa] uppercase text-center">
                  PAY VIA MOBILE APP (1-TAP INTENT)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
                  >
                    OPEN GPAY
                  </a>
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
                  >
                    OPEN PHONEPE
                  </a>
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
                  >
                    OPEN PAYTM
                  </a>
                  <a
                    href={upiIntentUrl}
                    style={{ backgroundColor: '#ff6600', color: '#000000' }}
                    className="text-center py-2 px-3 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold rounded text-xs font-mono transition"
                  >
                    DEFAULT UPI APP
                  </a>
                </div>
              </div>

              {/* Automated Listener Pulse */}
              <div className="border border-[#27272a] bg-[#0b0b0b] rounded p-2.5 text-center flex items-center justify-center gap-2 text-xs font-mono text-[#ff6600]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff6600] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff6600]"></span>
                </span>
                <span>LISTENING FOR INCOMING PHONE PAYMENT...</span>
              </div>

              {/* Cancel and Return */}
              <div className="text-center pt-1">
                <a
                  href={getCleanReturnUrl(order.callback_url, 'cancelled', order.id)}
                  className="text-[11px] font-mono text-[#71717a] hover:text-[#ff6600] transition"
                >
                  ← CANCEL AND RETURN TO FLUXBASE
                </a>
              </div>

              {/* Order Meta Footer */}
              <div className="pt-2 border-t border-[#27272a] flex items-center justify-between text-[10px] font-mono text-[#71717a]">
                <span>ORDER: {order.id}</span>
                <span>TIMEOUT: {remainingSeconds}s</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
