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
  
  // Two-step checkout flow: 'review' (Order & Coupon Review) -> 'pay' (Timer & UPI Payment)
  const [viewStep, setViewStep] = useState<'review' | 'pay'>('review');
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

  // The 3-minute timer ONLY runs once the user enters the 'pay' step!
  useEffect(() => {
    if (viewStep !== 'pay' || status !== 'pending' || remainingSeconds <= 0) return;
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
  }, [viewStep, status, remainingSeconds]);

  // Render high-contrast QR Code on canvas
  useEffect(() => {
    if (canvasRef.current && status === 'pending' && viewStep === 'pay') {
      QRCode.toCanvas(
        canvasRef.current,
        upiIntentUrl,
        {
          width: 210,
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
  }, [upiIntentUrl, status, finalAmount, viewStep]);

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

  const proceedToPayment = () => {
    setRemainingSeconds(180);
    setViewStep('pay');
  };

  // 1. PAID STATE
  if (status === 'paid') {
    return (
      <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 selection:bg-[#ff6600] selection:text-black font-sans">
        <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-xl p-8 text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 font-mono text-xl font-bold">
            OK
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#f4f4f5] tracking-tight">
              PAYMENT VERIFIED
            </h2>
            <p className="text-xs text-emerald-400 mt-1 font-mono">
              VERIFIED BY NOTIFICATION ENGINE
            </p>
            {utr && (
              <p className="text-xs text-[#a1a1aa] mt-1 font-mono">
                BANK UTR: {utr}
              </p>
            )}
          </div>

          <div className="bg-[#18181b] border border-[#27272a] rounded p-3 text-xs font-mono text-zinc-400">
            Amount Paid: <span className="text-[#f4f4f5] font-bold">₹{finalAmountStr}</span>
          </div>

          <div className="p-3 bg-emerald-950/20 border border-emerald-800/40 rounded">
            <p className="text-xs text-[#ff6600] font-mono font-semibold">
              {redirectCount !== null
                ? `Payment confirmed. Returning to Fluxbase in ${redirectCount}s...`
                : 'Payment complete. Ready to return.'}
            </p>
          </div>

          {order.callback_url && (
            <a
              href={getCleanReturnUrl(order.callback_url, 'paid', order.id, utr)}
              className="inline-block w-full py-2.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs rounded transition font-mono uppercase"
            >
              RETURN TO FLUXBASE NOW
            </a>
          )}
        </div>
      </div>
    );
  }

  // 2. EXPIRED STATE
  if (status === 'expired') {
    return (
      <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 selection:bg-[#ff6600] selection:text-black font-sans">
        <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-xl p-8 text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 mx-auto rounded-full bg-[#18181b] border border-[#27272a] flex items-center justify-center text-zinc-400 font-mono text-sm font-bold">
            EXPIRED
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#f4f4f5] tracking-tight">
              PAYMENT WINDOW EXPIRED
            </h2>
            <p className="text-xs text-[#a1a1aa] mt-1">
              The allocated payment slot timed out and was released.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setStatus('pending');
                setRemainingSeconds(180);
                setViewStep('review');
              }}
              className="w-full py-2.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono rounded transition uppercase"
            >
              REVIEW ORDER & TRY AGAIN
            </button>
            {order.callback_url && (
              <a
                href={getCleanReturnUrl(order.callback_url, 'expired', order.id)}
                className="w-full py-2 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-zinc-300 text-xs font-mono rounded transition text-center"
              >
                RETURN TO FLUXBASE
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. STEP 2: ACTIVE PAYMENT & QR SCAN SCREEN (Timer Runs Here)
  if (viewStep === 'pay') {
    return (
      <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 md:p-6 lg:p-8 selection:bg-[#ff6600] selection:text-black font-sans">
        <div className="w-full max-w-4xl bg-[#121214] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
          
          {/* Top Bar with Back to Review & Timer */}
          <div className="px-6 py-4 border-b border-[#27272a] flex flex-wrap items-center justify-between gap-3 bg-[#151518]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setViewStep('review')}
                className="p-1.5 px-2.5 rounded bg-[#1c1c20] border border-[#27272a] hover:border-[#ff6600] text-zinc-400 hover:text-[#f4f4f5] transition text-xs font-mono"
                title="Back to Order Review"
              >
                ← REVIEW
              </button>
              <div>
                <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
                  FLUXPAY // SECURE GATEWAY
                </div>
                <h1 className="text-sm font-bold text-[#f4f4f5] tracking-tight">
                  Complete Your UPI Transfer
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1c1c20] border border-[#27272a] rounded text-[#a1a1aa] text-[11px]">
                <span className="text-zinc-500">EXPIRES:</span>
                <span className="text-[#ff6600] font-bold">{formatTime(remainingSeconds)}</span>
              </div>
              <StatusBadge status={status} />
            </div>
          </div>

          {/* Slot Expiry Countdown Progress Bar */}
          <div className="w-full bg-[#18181b] h-1">
            <div
              className="bg-[#ff6600] h-1 transition-all duration-1000 ease-linear"
              style={{ width: `${Math.max(0, Math.min(100, (remainingSeconds / 180) * 100))}%` }}
            />
          </div>

          {/* Two-Column Payment Layout */}
          <div className="p-6 lg:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-start">
              
              {/* LEFT: Order Info, Amount, VPA, Intent Buttons */}
              <div className="space-y-4">
                
                {/* Order Summary Summary Pill */}
                <div className="bg-[#0b0b0b] border border-[#27272a] rounded-lg p-4 space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between text-zinc-500 text-[10px] border-b border-[#1f1f23] pb-1.5 uppercase font-semibold">
                    <span>ORDER SUMMARY</span>
                    <span>ID: {order.id.slice(0, 12)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-[#a1a1aa]">ITEM:</span>
                    <span className="text-[#f4f4f5] font-bold truncate max-w-[200px]">
                      {planMeta?.name || order.title || 'Subscription Plan'}
                    </span>
                  </div>
                  {appliedCoupon && (
                    <div className="flex items-center justify-between text-emerald-400">
                      <span>COUPON [{appliedCoupon.code}]:</span>
                      <span>-₹{appliedCoupon.discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t border-[#27272a] pt-2 flex items-baseline justify-between">
                    <span className="text-[#a1a1aa]">TOTAL PAYABLE:</span>
                    <span className="text-xl font-bold text-[#ff6600]">₹{finalAmountStr}</span>
                  </div>
                </div>

                {/* VPA Block */}
                <div className="bg-[#18181b] border border-[#27272a] rounded p-3 flex items-center justify-between">
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

                {/* Mobile Quick Pay (1-Tap Intent) */}
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

                {/* Return Links */}
                <div className="pt-2 flex items-center justify-between text-[11px] font-mono text-zinc-500">
                  <button
                    type="button"
                    onClick={() => setViewStep('review')}
                    className="hover:text-[#f4f4f5] transition"
                  >
                    ← Back to Order Review
                  </button>
                  {order.callback_url && (
                    <a
                      href={getCleanReturnUrl(order.callback_url, 'cancelled', order.id)}
                      className="hover:text-[#ff6600] transition"
                    >
                      Cancel and Return
                    </a>
                  )}
                </div>

              </div>

              {/* RIGHT: Pay Exact Amount, Canvas QR, Live Pulse */}
              <div className="space-y-4 flex flex-col items-center">
                <div className="w-full text-center bg-[#0b0b0b] border border-[#ff6600]/40 rounded-lg p-3 space-y-1">
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
                      {copiedAmount ? 'COPIED' : 'COPY'}
                    </button>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400">
                    Transfer the exact amount for instant automated verification.
                  </div>
                </div>

                {/* Canvas QR */}
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="p-3 bg-[#0b0b0b] border border-[#27272a] rounded-lg shadow-inner">
                    <canvas ref={canvasRef} className="block rounded" />
                  </div>
                  <div className="text-[10px] font-mono text-[#71717a] text-center">
                    Scan with any UPI app (GPay, PhonePe, Paytm, BHIM, CRED)
                  </div>
                </div>

                {/* Live Pulse Listener */}
                <div className="w-full border border-[#27272a] bg-[#0b0b0b] rounded p-2.5 text-center flex items-center justify-center gap-2 text-xs font-mono text-[#ff6600]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff6600] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff6600]"></span>
                  </span>
                  <span>LISTENING FOR INCOMING PAYMENT...</span>
                </div>

                <div className="w-full pt-1 border-t border-[#27272a] flex items-center justify-between text-[10px] font-mono text-[#71717a]">
                  <span className="truncate max-w-[180px]">ORDER: {order.id}</span>
                  <span>TIMEOUT: {formatTime(remainingSeconds)}</span>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    );
  }

  // 4. STEP 1: CLEAN ORDER & PROMO CODE REVIEW SCREEN (No Timer Running!)
  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4 md:p-6 lg:p-8 selection:bg-[#ff6600] selection:text-black font-sans">
      <div className="w-full max-w-5xl bg-[#121214] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-[#27272a] flex flex-wrap items-center justify-between gap-3 bg-[#151518]">
          <div className="flex items-center gap-3">
            {order.callback_url && (
              <a
                href={getCleanReturnUrl(order.callback_url, 'cancelled', order.id)}
                className="p-1.5 px-2.5 rounded bg-[#1c1c20] border border-[#27272a] hover:border-[#ff6600] text-zinc-400 hover:text-[#f4f4f5] transition text-xs font-mono"
                title="Cancel and return to Fluxbase"
              >
                ← BACK
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

          <div className="text-zinc-500 font-mono text-[11px] uppercase tracking-wider">
            256-BIT ENCRYPTED
          </div>
        </div>

        {/* Provisioning Target Context Banner (if applicable) */}
        {projectData?.projectName && (
          <div className="mx-6 lg:mx-8 mt-6 p-3.5 bg-[#0b0b0b] border border-[#27272a] rounded-lg flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-[#ff6600] font-bold">[TARGET]</span>
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

        {/* 2-Column Review Grid: Left Specs & Coupon, Right Billing Summary & Proceed */}
        <div className="p-6 lg:p-8">
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
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-emerald-400 font-bold shrink-0">•</span>
                          <span className="leading-tight">{spec}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Promo Code / Coupon Box */}
              <div className="bg-[#0b0b0b] border border-[#27272a] rounded-xl p-5 space-y-3 shadow-xl">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-[#f4f4f5]">
                  HAVE A DISCOUNT PROMO CODE?
                </div>

                {appliedCoupon ? (
                  <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded-lg flex items-center justify-between text-xs font-mono text-emerald-400">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">COUPON [{appliedCoupon.code}] APPLIED</span>
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
                        placeholder="ENTER PROMO CODE (E.G. BHAICHARA)"
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

            {/* RIGHT COLUMN: Billing Summary & Proceed Button (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-[#0b0b0b] border border-[#27272a] rounded-xl p-6 space-y-4 shadow-xl">
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

                  <div className="border-t border-[#27272a] pt-3 flex items-baseline justify-between">
                    <span className="font-bold text-sm text-[#f4f4f5]">TOTAL PAYABLE:</span>
                    <span className="text-2xl font-black font-mono text-[#ff6600]">
                      ₹{finalAmountStr}
                    </span>
                  </div>
                </div>

                {/* Primary Proceed Action */}
                <button
                  type="button"
                  onClick={proceedToPayment}
                  className="w-full py-3.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold text-xs font-mono uppercase tracking-wider rounded transition"
                >
                  PROCEED TO PAYMENT →
                </button>

                {/* Guarantees & Cancel (Clean text, no icons, no emojis) */}
                <div className="pt-2 border-t border-[#1f1f23] space-y-1.5 text-[10px] font-mono text-zinc-500">
                  <div className="flex items-center justify-between">
                    <span>Verified Instant Slot Allocation</span>
                    {order.callback_url && (
                      <a
                        href={getCleanReturnUrl(order.callback_url, 'cancelled', order.id)}
                        className="text-zinc-500 hover:text-[#ff6600] transition"
                      >
                        Cancel and return
                      </a>
                    )}
                  </div>
                  <div>
                    <span>Auto-provisioned upon UPI transfer</span>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
