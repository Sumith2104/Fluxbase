'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2, AlertCircle, ArrowRight, ArrowLeft, Tag, ShieldCheck, Zap, Database, Server, Clock } from 'lucide-react';

interface PlanMeta {
  name: string;
  badge: string;
  category: string;
  price: number;
  interval: string;
  description: string;
  specs: string[];
}

const DEFAULT_PLANS: Record<string, PlanMeta> = {
  pay_as_you_go: {
    name: 'Pay As You Go Verification Deposit',
    badge: 'METERED BASE',
    category: 'Business & Developers',
    price: 50,
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
    price: 499,
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
    price: 499,
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
    price: 1499,
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
    price: 1499,
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
    price: 500,
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
    price: 5000,
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
    price: 5000,
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

function CheckoutHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const paramSessionId = searchParams.get('sessionId');
  const paramOrderId = searchParams.get('order_id');
  const paramStatus = searchParams.get('status');
  const paramUtr = searchParams.get('utr');
  const paramPlan = searchParams.get('plan') || 'pay_as_you_go';

  // Mode state: 'review' (default order review) | 'processing' | 'completed' | 'expired' | 'error'
  const [viewMode, setViewMode] = useState<'review' | 'processing' | 'completed' | 'expired' | 'error'>('review');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Pending Project details (if project was configured before payment)
  const [pendingProject, setPendingProject] = useState<{
    projectName?: string;
    dialect?: string;
    userRole?: string;
    billingPreference?: string;
  } | null>(null);

  // Plan info
  const cleanPlanKey = (paramPlan || 'pay_as_you_go').toLowerCase();
  const planInfo = DEFAULT_PLANS[cleanPlanKey] || DEFAULT_PLANS.pay_as_you_go;

  // Pricing & Coupon State
  const [basePrice, setBasePrice] = useState<number>(planInfo.price);
  const [couponInput, setCouponInput] = useState<string>('');
  const [couponLoading, setCouponLoading] = useState<boolean>(false);
  const [couponError, setCouponError] = useState<string>('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    description?: string;
    discountAmount: number;
    discountValue: number;
    discountType: string;
  } | null>(null);

  // Checkout submission loading
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Read pending project from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pending_paid_project');
      if (raw) {
        setPendingProject(JSON.parse(raw));
      }
    } catch {}
  }, []);

  // Check returning parameters
  useEffect(() => {
    if (paramStatus === 'paid' || paramUtr) {
      handleCompletion();
      return;
    }

    if (paramStatus === 'expired' || paramStatus === 'failed' || paramStatus === 'cancelled') {
      setViewMode('expired');
      setStatusMessage(
        paramStatus === 'cancelled'
          ? 'Payment session was cancelled. You can review and restart below.'
          : 'Payment session expired. Please verify your details and try again.'
      );
      return;
    }

    if (paramSessionId && !paramPlan) {
      verifyExistingSession(paramSessionId);
      return;
    }
  }, [paramStatus, paramUtr, paramSessionId]);

  // Handle Coupon Verification via API
  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponInput.trim()) return;

    setCouponError('');
    setCouponLoading(true);

    try {
      const res = await fetch('/api/payments/verify-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponInput.trim().toUpperCase(),
          planKey: cleanPlanKey,
          orderAmount: basePrice,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.discount) {
        throw new Error(data.error || 'Invalid or expired coupon code.');
      }

      setAppliedCoupon({
        code: data.discount.code,
        description: data.discount.description,
        discountAmount: data.discount.discountAmount,
        discountValue: data.discount.discountValue,
        discountType: data.discount.discountType,
      });
      setCouponInput('');
      toast({
        title: 'Coupon Applied!',
        description: `${data.discount.code}: Saved ₹${data.discount.discountAmount.toFixed(2)} on your order.`,
      });
    } catch (err: any) {
      setCouponError(err.message || 'Failed to apply coupon.');
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError('');
  };

  // Calculate Final Amount
  const discountAmount = appliedCoupon ? appliedCoupon.discountAmount : 0;
  const finalPayable = Math.max(1, Math.round(basePrice - discountAmount));

  // Proceed to Payment Action
  const handleProceedToPayment = async () => {
    setIsSubmitting(true);
    setStatusMessage('Allocating dedicated payment slot on FluxPay Gateway...');

    try {
      let projectData: any = null;
      try {
        const raw = localStorage.getItem('pending_paid_project');
        if (raw) projectData = JSON.parse(raw);
      } catch {}

      const res = await fetch('/api/payments/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: cleanPlanKey,
          amount: finalPayable,
          couponCode: appliedCoupon?.code,
          isDiscountApplied: !!appliedCoupon,
          projectData,
        }),
      });

      const data = await res.json();
      if (!res.ok || (!data.checkoutUrl && !data.sessionId)) {
        throw new Error(data.error || 'Failed to initialize payment gateway session.');
      }

      if (data.checkoutUrl) {
        let targetUrl = String(data.checkoutUrl).trim();
        if (targetUrl.startsWith('//')) {
          targetUrl = `https:${targetUrl}`;
        } else if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = `https://${targetUrl.replace(/^\/+/, '')}`;
        }
        window.location.href = targetUrl;
        return;
      } else {
        router.push(`/checkout?sessionId=${data.sessionId}`);
      }
    } catch (err: any) {
      setIsSubmitting(false);
      toast({
        variant: 'destructive',
        title: 'Checkout Error',
        description: err.message || 'Could not connect to payment gateway.',
      });
    }
  };

  // Helper: Verify session status with backend
  const verifyExistingSession = async (sessionId: string) => {
    setViewMode('processing');
    setStatusMessage('Verifying payment status with FluxPay...');

    try {
      const res = await fetch(`/api/payments/check-session?sessionId=${sessionId}`);
      const data = await res.json();

      if (res.ok && data.success) {
        if (data.status === 'completed') {
          handleCompletion();
        } else if (data.status === 'expired') {
          setViewMode('expired');
          setStatusMessage('Payment session has expired.');
        } else {
          if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
          } else {
            setViewMode('error');
            setStatusMessage('Payment is still pending on FluxPay.');
          }
        }
      } else {
        throw new Error(data.error || 'Session not found');
      }
    } catch (err: any) {
      setViewMode('error');
      setStatusMessage(err.message || 'Failed to verify session.');
    }
  };

  // Helper: Finalize payment success, provision pending project, and redirect
  const handleCompletion = async () => {
    setViewMode('completed');
    setStatusMessage('Payment verified! Your plan has been upgraded.');

    const pendingProjectJson = localStorage.getItem('pending_paid_project');
    if (pendingProjectJson) {
      try {
        const projData = JSON.parse(pendingProjectJson);
        const formData = new FormData();
        formData.append('projectName', projData.projectName);
        formData.append('dialect', projData.dialect);
        formData.append('timezone', projData.timezone || 'UTC');
        formData.append('userRole', projData.userRole);
        formData.append('billingPreference', projData.billingPreference || 'monthly');
        formData.append('companyName', projData.companyName || '');
        formData.append('workDescription', projData.workDescription || '');
        formData.append('connectionType', 'internal');

        const { createProjectAction } = await import('@/components/layout/actions');
        await createProjectAction(formData);

        toast({
          title: 'Payment Verified & Project Provisioned!',
          description: `Your ${projData.projectName} project is active and ready.`,
        });
      } catch (e) {
        console.error('Error provisioning paid project:', e);
      } finally {
        localStorage.removeItem('pending_paid_project');
      }
    } else {
      toast({
        title: 'Plan Upgraded Successfully!',
        description: 'Payment confirmed via FluxPay. Welcome to your upgraded tier.',
      });
    }

    setTimeout(() => router.push('/dashboard/projects'), 1800);
  };

  // Render: Completed State
  if (viewMode === 'completed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0b] text-[#f4f4f5] p-4 font-sans">
        <Card className="w-full max-w-md border border-[#27272a] bg-[#121214] shadow-2xl p-6 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 font-mono text-2xl font-bold">
            ✓
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#f4f4f5] tracking-tight">PAYMENT CONFIRMED</h2>
            <p className="text-xs text-emerald-400 font-mono mt-1">SUBSCRIPTION ACTIVE & PROVISIONED</p>
            {paramUtr && <p className="text-xs text-zinc-400 font-mono mt-0.5">BANK UTR: {paramUtr}</p>}
          </div>
          <p className="text-xs text-[#ff6600] font-mono animate-pulse">
            Redirecting to your projects dashboard in a moment...
          </p>
          <Button
            onClick={() => router.push('/dashboard/projects')}
            className="w-full bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono uppercase"
          >
            Go to Projects Now
          </Button>
        </Card>
      </div>
    );
  }

  // Render: Expired or Error State
  if (viewMode === 'expired' || viewMode === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0b] text-[#f4f4f5] p-4 font-sans">
        <Card className="w-full max-w-md border border-[#27272a] bg-[#121214] shadow-2xl p-6 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-400 font-mono text-xl">
            ✕
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#f4f4f5]">
              {viewMode === 'expired' ? 'SESSION TIMED OUT' : 'CHECKOUT ERROR'}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">{statusMessage}</p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <Button
              onClick={() => {
                setViewMode('review');
                setStatusMessage('');
              }}
              className="w-full bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono uppercase"
            >
              Review Order & Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/dashboard/projects')}
              className="w-full border-[#27272a] hover:bg-[#18181b] text-zinc-300 text-xs font-mono"
            >
              Return to Dashboard
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Render: Order Review & Bill Breakdown Mode (Instant, responsive, zero scroll)
  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] py-8 px-4 sm:px-6 lg:px-8 font-sans selection:bg-[#ff6600] selection:text-black">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Navigation Breadcrumb / Header */}
        <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/dashboard/projects')}
              className="p-1.5 rounded bg-[#18181b] border border-[#27272a] hover:border-[#ff6600] text-zinc-400 hover:text-[#f4f4f5] transition"
              title="Return to Dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
                FLUXBASE // ORDER REVIEW & SUMMARY
              </div>
              <h1 className="text-lg font-bold text-[#f4f4f5] tracking-tight">
                Review Your Subscription Order
              </h1>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 font-mono text-xs text-zinc-400">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>256-Bit SSL Encrypted</span>
          </div>
        </div>

        {/* Pending Project Context Banner (if applicable) */}
        {pendingProject?.projectName && (
          <div className="p-3.5 bg-[#121214] border border-[#27272a] rounded-lg flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 text-[#ff6600]" />
              <span>
                PROVISIONING TARGET:{' '}
                <strong className="text-[#f4f4f5]">{pendingProject.projectName}</strong> (
                {pendingProject.dialect?.toUpperCase() || 'POSTGRESQL'})
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 uppercase px-2 py-0.5 bg-[#18181b] rounded border border-[#27272a]">
              ACTIVATES UPON PAYMENT
            </span>
          </div>
        )}

        {/* 2-Column Grid: Left Details & Right Bill */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          
          {/* LEFT COLUMN (2 Cols): Tier Specs & Coupon Code */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Selected Plan Details Card */}
            <div className="bg-[#121214] border border-[#27272a] rounded-xl p-6 space-y-4 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded bg-[#ff6600]/10 text-[#ff6600] border border-[#ff6600]/20">
                    {planInfo.badge}
                  </span>
                  <h2 className="text-xl font-bold text-[#f4f4f5] mt-2">
                    {planInfo.name}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    {planInfo.description}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-black font-mono text-[#f4f4f5]">
                    ₹{basePrice.toFixed(2)}
                  </div>
                  <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                    {planInfo.interval}
                  </div>
                </div>
              </div>

              {/* Specs & Quotas Included */}
              <div className="pt-3 border-t border-[#27272a]">
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-2.5">
                  INCLUDED QUOTAS & INFRASTRUCTURE SPECS
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-zinc-300">
                  {planInfo.specs.map((spec, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold shrink-0">✓</span>
                      <span>{spec}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Discount / Coupon Box */}
            <div className="bg-[#121214] border border-[#27272a] rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-[#ff6600]" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#f4f4f5]">
                  HAVE A DISCOUNT PROMO CODE?
                </span>
              </div>

              {appliedCoupon ? (
                <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded-lg flex items-center justify-between text-xs font-mono text-emerald-400">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">✓ COUPON [{appliedCoupon.code}] APPLIED</span>
                    <span>(-₹{appliedCoupon.discountAmount.toFixed(2)})</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
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
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder="ENTER PROMO CODE (e.g. FLUX20)"
                      className="flex-1 bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono uppercase text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                    />
                    <Button
                      type="submit"
                      disabled={couponLoading || !couponInput.trim()}
                      className="bg-[#1c1c20] hover:bg-[#27272a] border border-[#27272a] hover:border-[#ff6600] text-xs font-mono font-bold uppercase px-4"
                    >
                      {couponLoading ? 'CHECKING...' : 'APPLY CODE'}
                    </Button>
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

          {/* RIGHT COLUMN (1 Col): Bill Summary & Proceed */}
          <div className="space-y-4 sticky top-6">
            <div className="bg-[#121214] border border-[#27272a] rounded-xl p-6 space-y-4 shadow-xl">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 border-b border-[#27272a] pb-2.5">
                BILLING SUMMARY
              </h3>

              <div className="space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Base Plan Rate:</span>
                  <span>₹{basePrice.toFixed(2)}</span>
                </div>

                {appliedCoupon && (
                  <div className="flex items-center justify-between text-emerald-400 font-semibold">
                    <span>Discount ({appliedCoupon.code}):</span>
                    <span>-₹{appliedCoupon.discountAmount.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                  <span>Gateway & Slot Fee:</span>
                  <span className="text-emerald-400">FREE</span>
                </div>

                <div className="border-t border-[#27272a] pt-3 flex items-baseline justify-between">
                  <span className="font-bold text-sm text-[#f4f4f5]">TOTAL PAYABLE:</span>
                  <span className="text-2xl font-black font-mono text-[#ff6600]">
                    ₹{finalPayable.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Proceed to Payment Button */}
              <Button
                onClick={handleProceedToPayment}
                disabled={isSubmitting}
                className="w-full py-5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold text-xs font-mono uppercase tracking-wider rounded-lg shadow-lg shadow-[#ff6600]/20 flex items-center justify-center gap-2 transition"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-black" />
                    <span>CONNECTING GATEWAY...</span>
                  </>
                ) : (
                  <>
                    <span>PROCEED TO PAYMENT</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/projects')}
                  className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition"
                >
                  ← Cancel and return to Dashboard
                </button>
              </div>

              {/* Trust & Guarantees */}
              <div className="pt-3 border-t border-[#1f1f23] space-y-1.5 text-[10px] font-mono text-zinc-500">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Verified Instant Slot Allocation</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-[#ff6600] shrink-0" />
                  <span>Auto-provisioned upon UPI transfer</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0b0b0b] text-[#f4f4f5] p-4 font-mono">
          <Loader2 className="h-8 w-8 text-[#ff6600] animate-spin mb-3" />
          <p className="text-zinc-400 text-xs">Loading Order Review...</p>
        </div>
      }
    >
      <CheckoutHandler />
    </Suspense>
  );
}
