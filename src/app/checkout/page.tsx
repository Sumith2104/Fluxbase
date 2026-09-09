'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react';

function CheckoutHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const paramSessionId = searchParams.get('sessionId');
  const paramOrderId = searchParams.get('order_id');
  const paramStatus = searchParams.get('status');
  const paramUtr = searchParams.get('utr');
  const paramPlan = searchParams.get('plan');

  // Modes: 'redirecting' (handoff to FluxPay) | 'completed' | 'cancelled' | 'expired' | 'error'
  const [viewMode, setViewMode] = useState<'redirecting' | 'completed' | 'cancelled' | 'expired' | 'error'>('redirecting');
  const [statusMessage, setStatusMessage] = useState<string>('Initializing secure checkout...');
  const initTriggeredRef = useRef(false);

  useEffect(() => {
    // 1. Return from FluxPay: Payment Successful
    if (paramStatus === 'paid' || paramUtr) {
      handleCompletion();
      return;
    }

    // 2. Return from FluxPay: Cancelled or Expired
    if (paramStatus === 'cancelled') {
      setViewMode('cancelled');
      setStatusMessage('Payment checkout was cancelled. You can return to the dashboard or try again.');
      return;
    }

    if (paramStatus === 'expired' || paramStatus === 'failed') {
      setViewMode('expired');
      setStatusMessage('The allocated payment window expired. Please initiate a fresh checkout.');
      return;
    }

    // 3. Return with SessionId check
    if (paramSessionId && !paramPlan) {
      verifyExistingSession(paramSessionId);
      return;
    }

    // 4. Initial Plan Checkout: Immediately hand off to FluxPay Gateway
    if (paramPlan && !initTriggeredRef.current) {
      initTriggeredRef.current = true;
      initiateFluxPayHandoff(paramPlan);
      return;
    }

    // 5. Direct navigation without parameters
    if (!paramPlan && !paramStatus && !paramSessionId) {
      router.replace('/pricing');
    }
  }, [paramStatus, paramUtr, paramSessionId, paramPlan]);

  // Immediate handoff: create session & redirect directly to FluxPay review & pay page
  const initiateFluxPayHandoff = async (planKey: string) => {
    setViewMode('redirecting');
    setStatusMessage('Connecting to FluxPay Gateway...');

    try {
      let projectData: any = null;
      try {
        const raw = localStorage.getItem('pending_paid_project');
        if (raw) projectData = JSON.parse(raw);
      } catch {}

      const cleanPlan = planKey.toLowerCase();
      const res = await fetch('/api/payments/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: cleanPlan,
          projectData,
        }),
      });

      const data = await res.json();
      if (!res.ok || (!data.checkoutUrl && !data.sessionId)) {
        throw new Error(data.error || 'Failed to initialize payment gateway.');
      }

      if (data.checkoutUrl) {
        let targetUrl = String(data.checkoutUrl).trim();
        if (targetUrl.startsWith('//')) {
          targetUrl = `https:${targetUrl}`;
        } else if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = `https://${targetUrl.replace(/^\/+/, '')}`;
        }
        // Direct seamless handoff to FluxPay
        window.location.href = targetUrl;
      } else {
        router.push(`/checkout?sessionId=${data.sessionId}`);
      }
    } catch (err: any) {
      setViewMode('error');
      setStatusMessage(err.message || 'Could not connect to FluxPay gateway.');
      toast({
        variant: 'destructive',
        title: 'Checkout Error',
        description: err.message || 'Could not initialize gateway session.',
      });
    }
  };

  // Helper: Verify session status with backend
  const verifyExistingSession = async (sessionId: string) => {
    setViewMode('redirecting');
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
          {/* Animated Verified Tick Mark */}
          <div className="relative flex items-center justify-center w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
            <svg
              className="w-20 h-20 relative z-10 animate-checkmark-pop"
              viewBox="0 0 64 64"
              fill="none"
              style={{
                filter: 'drop-shadow(0 0 12px rgba(16, 185, 129, 0.4))',
              }}
            >
              {/* Background badge circle */}
              <circle cx="32" cy="32" r="28" fill="#064e3b" fillOpacity="0.45" />

              {/* Animated drawing outer ring */}
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="animate-checkmark-circle"
              />

              {/* Animated drawing checkmark tick */}
              <path
                d="M20 32.5L28 40.5L44 23.5"
                stroke="#34d399"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-checkmark-check"
              />
            </svg>
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

  // Render: Cancelled, Expired or Error State
  if (viewMode === 'cancelled' || viewMode === 'expired' || viewMode === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0b] text-[#f4f4f5] p-4 font-sans">
        <Card className="w-full max-w-md border border-[#27272a] bg-[#121214] shadow-2xl p-6 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-400 font-mono text-xl">
            {viewMode === 'cancelled' ? '←' : '✕'}
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#f4f4f5] tracking-tight uppercase">
              {viewMode === 'cancelled'
                ? 'CHECKOUT CANCELLED'
                : viewMode === 'expired'
                ? 'SESSION TIMED OUT'
                : 'CHECKOUT ERROR'}
            </h2>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{statusMessage}</p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            {paramPlan && (
              <Button
                onClick={() => {
                  initTriggeredRef.current = false;
                  initiateFluxPayHandoff(paramPlan);
                }}
                className="w-full bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold text-xs font-mono uppercase"
              >
                Try Again
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => router.push('/dashboard/projects')}
              className="w-full border-[#27272a] hover:bg-[#18181b] text-zinc-300 text-xs font-mono"
            >
              Return to Dashboard
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push('/pricing')}
              className="w-full text-zinc-500 hover:text-zinc-300 text-xs font-mono"
            >
              View Pricing & Plans
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Render: Fast, Sleek Gateway Handoff Spinner
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b0b] text-[#f4f4f5] p-4 font-sans selection:bg-[#ff6600] selection:text-black">
      <Card className="w-full max-w-sm border border-[#27272a] bg-[#121214] shadow-2xl p-8 text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-full bg-[#ff6600]/10 border border-[#ff6600]/30 flex items-center justify-center shadow-inner">
          <Loader2 className="h-7 w-7 text-[#ff6600] animate-spin" />
        </div>
        <div>
          <div className="text-[10px] font-mono text-[#ff6600] uppercase tracking-widest font-bold">
            FLUXPAY // SECURE GATEWAY
          </div>
          <h2 className="text-base font-bold text-[#f4f4f5] mt-1 tracking-tight">
            Redirecting to FluxPay
          </h2>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
            {statusMessage}
          </p>
        </div>

        <div className="pt-2 border-t border-[#1f1f23] flex items-center justify-center gap-1.5 text-[10px] font-mono text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span>256-Bit SSL Encrypted Handshake</span>
        </div>
      </Card>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0b0b0b] text-[#f4f4f5] p-4 font-mono">
          <Loader2 className="h-8 w-8 text-[#ff6600] animate-spin mb-3" />
          <p className="text-zinc-400 text-xs">Loading Secure Checkout...</p>
        </div>
      }
    >
      <CheckoutHandler />
    </Suspense>
  );
}
