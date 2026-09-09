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
    metadata?: any;
  };
}

interface PlanMeta {
  badge: string;
  name: string;
  category: string;
  interval: string;
  description: string;
  specs: string[];
}

const PLAN_SPECS: Record<string, PlanMeta> = {
  pay_as_you_go: {
    name: 'Pay As You Go Verification Deposit',
    badge: 'METERED BASE',
    category: 'Business & Developers',
    interval: 'One-Time Verification Deposit (Refundable / Credited)',
    description: 'Instant verification deposit that unlocks a dedicated 28-day active cycle with pay-per-query metered pricing.',
    specs: [
      'Dedicated 2 vCPU base compute resources',
      '10 GB High-Performance NVMe Database Storage',
      '10,000,000 requests / month baseline quota',
      'Low overage rate: ₹0.50 per 10k additional queries',
      'Automated daily snapshots and PITR recovery',
      'Serverless auto-scaling with zero sleep delays',
    ],
  },
  pro: {
    name: 'Student Pro Tier',
    badge: 'POPULAR',
    category: 'Students & Individuals',
    interval: 'Billed Monthly',
    description: 'Extra capacity and dedicated resources for academic thesis, production portfolios, and independent apps.',
    specs: [
      'Up to 3 Database Projects',
      '8 GB High-Speed Database Storage',
      '2,000,000 requests / month included',
      '500 Concurrent WebSocket Real-Time connections',
      'Priority Email Support (24h SLA)',
      'Automated daily schema backups',
    ],
  },
  student_pro: {
    name: 'Student Pro Tier',
    badge: 'POPULAR',
    category: 'Students & Individuals',
    interval: 'Billed Monthly',
    description: 'Extra capacity and dedicated resources for academic thesis, production portfolios, and independent apps.',
    specs: [
      'Up to 3 Database Projects',
      '8 GB High-Speed Database Storage',
      '2,000,000 requests / month included',
      '500 Concurrent WebSocket Real-Time connections',
      'Priority Email Support (24h SLA)',
      'Automated daily schema backups',
    ],
  },
  max: {
    name: 'Student Max Tier',
    badge: 'POWER USER',
    category: 'Students & Startups',
    interval: 'Billed Monthly',
    description: 'Unleashed limits for capstone projects, high-volume production APIs, and student startups.',
    specs: [
      'Unlimited Database Projects',
      '50 GB High-Speed NVMe Storage',
      '15,000,000 requests / month included',
      'Priority 24/7 Slack & Discord Support',
      'Realtime change data capture (CDC)',
      'Hourly automated backups with PITR',
    ],
  },
  student_max: {
    name: 'Student Max Tier',
    badge: 'POWER USER',
    category: 'Students & Startups',
    interval: 'Billed Monthly',
    description: 'Unleashed limits for capstone projects, high-volume production APIs, and student startups.',
    specs: [
      'Unlimited Database Projects',
      '50 GB High-Speed NVMe Storage',
      '15,000,000 requests / month included',
      'Priority 24/7 Slack & Discord Support',
      'Realtime change data capture (CDC)',
      'Hourly automated backups with PITR',
    ],
  },
  employee: {
    name: 'Employee Dedicated Tier',
    badge: 'TEAM DEDICATED',
    category: 'Corporate & Engineering Teams',
    interval: 'Billed Monthly',
    description: 'Dedicated infrastructure with isolated compute nodes for company workloads and team APIs.',
    specs: [
      '2 vCPU Dedicated Server (4 GB RAM)',
      '10 GB High-Speed SSD Storage',
      '100 Concurrent Connections',
      'Pay-As-You-Go overage: ₹0.50 / 10k queries',
      'Daily Automated Backups & Role-Based Access (RBAC)',
    ],
  },
  org_owner: {
    name: 'Org Owner Enterprise Tier',
    badge: 'ENTERPRISE',
    category: 'Organizations & High-Scale Production',
    interval: 'Billed Monthly',
    description: 'Dedicated Xeon/EPYC clusters with 99.99% SLA, high-IOPS storage, and enterprise compliance.',
    specs: [
      '8 vCPU Dedicated Xeon/EPYC (32 GB RAM)',
      '100 GB Gen4 NVMe High-IOPS Storage',
      '1,000+ Concurrent Connections',
      '99.99% Uptime SLA & Sub-millisecond Read Replicas',
      'Dedicated Account Manager & Priority Support',
    ],
  },
  org: {
    name: 'Org Owner Enterprise Tier',
    badge: 'ENTERPRISE',
    category: 'Organizations & High-Scale Production',
    interval: 'Billed Monthly',
    description: 'Dedicated Xeon/EPYC clusters with 99.99% SLA, high-IOPS storage, and enterprise compliance.',
    specs: [
      '8 vCPU Dedicated Xeon/EPYC (32 GB RAM)',
      '100 GB Gen4 NVMe High-IOPS Storage',
      '1,000+ Concurrent Connections',
      '99.99% Uptime SLA & Sub-millisecond Read Replicas',
      'Dedicated Account Manager & Priority Support',
    ],
  },
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
  const [copiedVpa, setCopiedVpa] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [utr, setUtr] = useState(order.utr || '');
  const [remainingSeconds, setRemainingSeconds] = useState(180);
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

  const metadata = order.metadata || {};
  const planKey = (metadata.plan || '').toLowerCase();
  const planMeta = PLAN_SPECS[planKey];
  const projectData = metadata.projectData;

  const finalAmountStr = finalAmount.toFixed(2);
  const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(order.vpa)}&pn=${encodeURIComponent(order.merchant || 'Fluxbase')}&am=${finalAmountStr}&cu=INR&tn=${encodeURIComponent(order.id)}`;

  const formatTime = (secs: number) => {
    const m = Math.floor(Math.max(0, secs) / 60);
    const s = Math.floor(Math.max(0, secs) % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Local ticker for smooth second-by-second countdown
  useEffect(() => {
    if (status !== 'pending' || remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          setStatus('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, remainingSeconds]);

  // Render high-contrast QR Code on canvas
  useEffect(() => {
    if (canvasRef.current && status === 'pending') {
      QRCode.toCanvas(
        canvasRef.current,
        upiIntentUrl,
        {
          width: 200,
          margin: 1,
          color: {
            dark: '#f4f4f5',
            light: '#0b0b0b',
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
    setCopiedVpa(true);
    setTimeout(() => setCopiedVpa(false), 2000);
  };

  const copyAmount = () => {
    navigator.clipboard.writeText(finalAmountStr);
    setCopiedAmount(true);
    setTimeout(() => setCopiedAmount(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 md:p-6 lg:p-8 selection:bg-[#ff6600] selection:text-black font-sans">
      <div className="w-full max-w-5xl bg-[#121214] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-[#27272a] flex flex-wrap items-center justify-between gap-3 bg-[#151518]">
          <div className="flex items-center gap-3">
            {order.callback_url && (
              <a
                href={getCleanReturnUrl(order.callback_url, 'cancelled', order.id)}
                className="p-1.5 rounded bg-[#1c1c20] border border-[#27272a] hover:border-[#ff6600] text-zinc-400 hover:text-[#f4f4f5] transition flex items-center justify-center"
                title="Cancel & Return to Fluxbase"
              >
                <span className="text-xs font-mono font-bold leading-none">←</span>
              </a>
            )}
            <div>
              <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
                FLUXPAY // ORDER REVIEW & SUMMARY
              </div>
              <h1 className="text-base font-bold text-[#f4f4f5] tracking-tight">
                Review Your Subscription Order
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <div className="hidden sm:flex items-center gap-1.5 text-zinc-400 text-xs">
              <span className="text-emerald-400">🛡️</span>
              <span>256-Bit SSL Encrypted</span>
            </div>
            {status === 'pending' && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1c1c20] border border-[#27272a] rounded text-[#a1a1aa] text-[11px]">
                <span className="text-zinc-500">EXPIRES:</span>
                <span className="text-[#ff6600] font-bold">{formatTime(remainingSeconds)}</span>
              </div>
            )}
            <StatusBadge status={status} />
          </div>
        </div>

        {/* Slot Expiry Countdown Progress Bar */}
        {status === 'pending' && (
          <div className="w-full bg-[#18181b] h-1">
            <div
              className="bg-[#ff6600] h-1 transition-all duration-1000 ease-linear"
              style={{ width: `${Math.max(0, Math.min(100, (remainingSeconds / 180) * 100))}%` }}
            />
          </div>
        )}

        {/* Provisioning Target Context Banner (if applicable) */}
        {projectData?.projectName && status === 'pending' && (
          <div className="mx-6 lg:mx-8 mt-6 p-3.5 bg-[#0b0b0b] border border-[#27272a] rounded-lg flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <span className="text-[#ff6600] font-bold text-sm">⛁</span>
              <span>
                PROVISIONING TARGET: <strong className="text-[#f4f4f5]">{projectData.projectName}</strong> (
                {(projectData.dialect || 'postgresql').toUpperCase()})
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 uppercase px-2 py-0.5 bg-[#18181b] rounded border border-[#27272a]">
              ACTIVATES UPON PAYMENT
            </span>
          </div>
        )}

        {/* Content Body */}
        <div>
          {status === 'paid' ? (
            <div className="max-w-md mx-auto py-12 px-6 text-center space-y-4 animate-in fade-in duration-500">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 font-mono text-2xl font-bold">
                ✓
              </div>
              <div>
                <h2 className="text-xl font-bold text-[#f4f4f5] tracking-tight">
                  PAYMENT VERIFIED
                </h2>
                <p className="text-xs text-emerald-400 mt-1 font-mono">
                  VERIFIED BY NOTIFICATION ENGINE
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
            <div className="max-w-md mx-auto py-12 px-6 text-center space-y-4">
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
                Please return to Fluxbase and initiate a fresh checkout session.
              </p>
              {order.callback_url && (
                <a
                  href={getCleanReturnUrl(order.callback_url, 'expired', order.id)}
                  className="inline-block px-6 py-2.5 bg-[#ff6600] text-black font-semibold text-xs font-mono rounded hover:bg-[#ff7a1a] transition uppercase"
                >
                  RETURN TO FLUXBASE
                </a>
              )}
            </div>
          ) : (
            <div className="p-6 lg:p-8">
              {/* Responsive 12-Column Grid: 7 Left (Review & Coupon), 5 Right (Bill & Pay) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
                
                {/* LEFT COLUMN: Plan Specs & Promo Code (7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                  
                  {/* Selected Plan Details Card */}
                  <div className="bg-[#0b0b0b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-xl">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-[#ff6600]/10 text-[#ff6600] border border-[#ff6600]/20">
                          {planMeta?.badge || 'SUBSCRIPTION TIER'}
                        </span>
                        <h2 className="text-lg font-bold text-[#f4f4f5] mt-2">
                          {planMeta?.name || order.title || 'Subscription Plan'}
                        </h2>
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                          {planMeta?.description || `Subscription package provided by ${order.merchant || 'Fluxbase'}.`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-black font-mono text-[#f4f4f5]">
                          ₹{(appliedCoupon?.original_amount || baseAmount).toFixed(2)}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                          {planMeta?.interval || 'Billed Monthly'}
                        </div>
                      </div>
                    </div>

                    {/* Specs & Quotas Included */}
                    {planMeta?.specs && (
                      <div className="pt-3 border-t border-[#1f1f23]">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                          INCLUDED QUOTAS & INFRASTRUCTURE SPECS
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-zinc-300">
                          {planMeta.specs.map((spec, idx) => (
                            <div key={idx} className="flex items-start gap-1.5">
                              <span className="text-emerald-400 font-bold shrink-0">✓</span>
                              <span className="leading-tight">{spec}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Promo Code / Coupon Box */}
                  <div className="bg-[#0b0b0b] border border-[#27272a] rounded-xl p-5 space-y-3 shadow-xl">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#f4f4f5]">
                        🏷️ HAVE A DISCOUNT PROMO CODE?
                      </span>
                    </div>

                    {appliedCoupon ? (
                      <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded-lg flex items-center justify-between text-xs font-mono text-emerald-400">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">✓ COUPON [{appliedCoupon.code}] APPLIED</span>
                          <span>(-₹{appliedCoupon.discount.toFixed(2)})</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          disabled={couponLoading}
                          className="text-rose-400 hover:text-rose-300 text-[11px] uppercase font-bold underline"
                        >
                          REMOVE
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleApplyCoupon} className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={couponCodeInput}
                            onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                            placeholder="ENTER PROMO CODE (e.g. BHAICHARA)"
                            className="flex-1 bg-[#121214] border border-[#27272a] rounded px-3 py-2 text-xs font-mono uppercase text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                          />
                          <button
                            type="submit"
                            disabled={couponLoading || !couponCodeInput.trim()}
                            className="px-4 py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] hover:border-[#ff6600] text-xs font-mono font-bold text-[#f4f4f5] rounded transition disabled:opacity-50 uppercase"
                          >
                            {couponLoading ? 'CHECKING...' : 'APPLY CODE'}
                          </button>
                        </div>
                        {couponError && (
                          <p className="text-[11px] font-mono text-rose-400">
                            {couponError}
                          </p>
                        )}
                      </form>
                    )}
                  </div>

                </div>

                {/* RIGHT COLUMN: Billing Summary & Payment (5 cols) */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-[#0b0b0b] border border-[#27272a] rounded-xl p-5 space-y-4 shadow-xl">
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 border-b border-[#1f1f23] pb-2">
                      BILLING SUMMARY
                    </div>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between text-zinc-300">
                        <span>Base Plan Rate:</span>
                        <span>₹{(appliedCoupon?.original_amount || baseAmount).toFixed(2)}</span>
                      </div>

                      {appliedCoupon && (
                        <div className="flex items-center justify-between text-emerald-400 font-semibold">
                          <span>Discount ({appliedCoupon.code}):</span>
                          <span>-₹{appliedCoupon.discount.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                        <span>Gateway & Slot Fee:</span>
                        <span className="text-emerald-400 font-bold">FREE</span>
                      </div>

                      <div className="border-t border-[#27272a] pt-2.5 flex items-baseline justify-between">
                        <span className="font-bold text-sm text-[#f4f4f5]">TOTAL PAYABLE:</span>
                        <span className="text-2xl font-black font-mono text-[#ff6600]">
                          ₹{finalAmountStr}
                        </span>
                      </div>
                    </div>

                    {/* High-Contrast Canvas QR Code */}
                    <div className="flex flex-col items-center justify-center pt-2 space-y-2">
                      <div className="p-3 bg-[#121214] border border-[#27272a] rounded-lg shadow-inner">
                        <canvas ref={canvasRef} className="block rounded" />
                      </div>
                      <div className="text-[10px] font-mono text-[#71717a] text-center">
                        Scan with any UPI app (GPay, PhonePe, Paytm, CRED)
                      </div>
                    </div>

                    {/* VPA ID Block */}
                    <div className="bg-[#18181b] border border-[#27272a] rounded p-2.5 flex items-center justify-between">
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="text-[10px] font-mono text-[#a1a1aa] uppercase">
                          UPI ID (VERIFIED UPI CHANNEL)
                        </div>
                        <div className="text-xs font-mono text-[#f4f4f5] mt-0.5 font-bold truncate">
                          {order.vpa}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={copyVpa}
                        className="text-[11px] font-mono uppercase px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded transition shrink-0"
                      >
                        {copiedVpa ? 'COPIED' : 'COPY ID'}
                      </button>
                    </div>

                    {/* Mobile Quick Pay Intent Buttons */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-mono text-[#a1a1aa] uppercase">
                        PAY VIA MOBILE APP (1-TAP INTENT)
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href={upiIntentUrl}
                          className="text-center py-2 px-2 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-[11px] font-mono text-[#f4f4f5] transition hover:border-zinc-500"
                        >
                          OPEN GPAY
                        </a>
                        <a
                          href={upiIntentUrl}
                          className="text-center py-2 px-2 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-[11px] font-mono text-[#f4f4f5] transition hover:border-zinc-500"
                        >
                          OPEN PHONEPE
                        </a>
                        <a
                          href={upiIntentUrl}
                          className="text-center py-2 px-2 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-[11px] font-mono text-[#f4f4f5] transition hover:border-zinc-500"
                        >
                          OPEN PAYTM
                        </a>
                        <a
                          href={upiIntentUrl}
                          style={{ backgroundColor: '#ff6600', color: '#000000' }}
                          className="text-center py-2 px-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold rounded text-[11px] font-mono transition"
                        >
                          DEFAULT UPI
                        </a>
                      </div>
                    </div>

                    {/* Automated Live Pulse Listener */}
                    <div className="w-full border border-[#27272a] bg-[#121214] rounded p-2 text-center flex items-center justify-center gap-2 text-xs font-mono text-[#ff6600]">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff6600] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff6600]"></span>
                      </span>
                      <span>LISTENING FOR INCOMING PAYMENT...</span>
                    </div>

                    {/* Guarantees & Cancel Return */}
                    <div className="pt-2 border-t border-[#1f1f23] space-y-1.5 text-[10px] font-mono text-zinc-500">
                      <div className="flex items-center justify-between">
                        <span>✓ Verified Instant Slot Allocation</span>
                        {order.callback_url && (
                          <a
                            href={getCleanReturnUrl(order.callback_url, 'cancelled', order.id)}
                            className="text-zinc-500 hover:text-[#ff6600] transition"
                          >
                            ← Cancel & Return
                          </a>
                        )}
                      </div>
                      <div>
                        <span>⚡ Auto-provisioned upon UPI transfer</span>
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
