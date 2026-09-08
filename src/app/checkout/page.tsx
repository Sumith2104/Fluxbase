'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Check, Loader2, AlertCircle, ArrowRight } from 'lucide-react';

function CheckoutHandler() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { toast } = useToast();

    const paramSessionId = searchParams.get('sessionId');
    const paramOrderId = searchParams.get('order_id');
    const paramStatus = searchParams.get('status');
    const paramUtr = searchParams.get('utr');
    const paramPlan = searchParams.get('plan');

    const [status, setStatus] = useState<'redirecting' | 'verifying' | 'completed' | 'expired' | 'error'>('redirecting');
    const [message, setMessage] = useState<string>('Connecting to FluxPay Gateway...');
    const hasInitiated = useRef(false);

    // 1. If returning from FluxPay with status=paid or checking status
    useEffect(() => {
        if (paramStatus === 'paid' || paramUtr) {
            handleCompletion();
            return;
        }

        // If returned with sessionId, verify from database
        if (paramSessionId) {
            verifyExistingSession(paramSessionId);
            return;
        }

        // If initiating a new checkout with plan (e.g. /checkout?plan=pro)
        if (paramPlan && !hasInitiated.current) {
            hasInitiated.current = true;
            initiateAndRedirect(paramPlan);
            return;
        }

        // Fallback: no params provided
        if (!paramPlan && !paramSessionId && !paramStatus) {
            router.push('/dashboard/projects');
        }
    }, [paramStatus, paramUtr, paramSessionId, paramPlan]);

    // Helper: Initiate FluxPay checkout and redirect immediately
    const initiateAndRedirect = async (planKey: string) => {
        setStatus('redirecting');
        setMessage(`Generating payment order for ${planKey.toUpperCase()} tier...`);

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
                    plan: planKey,
                    projectData
                })
            });

            const data = await res.json();
            if (!res.ok || (!data.checkoutUrl && !data.sessionId)) {
                throw new Error(data.error || 'Failed to create payment session');
            }

            if (data.checkoutUrl) {
                let targetUrl = String(data.checkoutUrl).trim();
                if (targetUrl.startsWith('//')) {
                    targetUrl = `https:${targetUrl}`;
                } else if (!/^https?:\/\//i.test(targetUrl)) {
                    targetUrl = `https://${targetUrl.replace(/^\/+/, '')}`;
                }
                setMessage('Redirecting to payments.fluxbasedb.me...');
                window.location.href = targetUrl;
            } else {
                router.push(`/checkout?sessionId=${data.sessionId}`);
            }
        } catch (err: any) {
            console.error('Checkout initiation error:', err);
            setStatus('error');
            setMessage(err.message || 'Error redirecting to payment gateway.');
            toast({
                variant: 'destructive',
                title: 'Checkout Error',
                description: err.message
            });
        }
    };

    // Helper: Verify session status with backend
    const verifyExistingSession = async (sessionId: string) => {
        setStatus('verifying');
        setMessage('Verifying payment status...');

        try {
            const res = await fetch(`/api/payments/check-session?sessionId=${sessionId}`);
            const data = await res.json();

            if (res.ok && data.success) {
                if (data.status === 'completed') {
                    handleCompletion();
                } else if (data.status === 'expired') {
                    setStatus('expired');
                    setMessage('Payment session has expired.');
                } else {
                    // If still pending and has checkoutUrl, redirect to FluxPay
                    if (data.checkoutUrl) {
                        let targetUrl = String(data.checkoutUrl).trim();
                        if (targetUrl.startsWith('//')) {
                            targetUrl = `https:${targetUrl}`;
                        } else if (!/^https?:\/\//i.test(targetUrl)) {
                            targetUrl = `https://${targetUrl.replace(/^\/+/, '')}`;
                        }
                        window.location.href = targetUrl;
                    } else {
                        setStatus('error');
                        setMessage('Payment is still pending on FluxPay.');
                    }
                }
            } else {
                throw new Error(data.error || 'Session not found');
            }
        } catch (err: any) {
            setStatus('error');
            setMessage(err.message || 'Failed to verify session.');
        }
    };

    // Helper: Finalize payment success, provision pending project, and redirect
    const handleCompletion = async () => {
        setStatus('completed');
        setMessage('Payment verified! Your plan has been upgraded.');

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
                    description: `Your ${projData.projectName} project is active and ready.`
                });
            } catch (e) {
                console.error('Error provisioning paid project:', e);
            } finally {
                localStorage.removeItem('pending_paid_project');
            }
        } else {
            toast({
                title: 'Plan Upgraded Successfully!',
                description: 'Payment confirmed via FluxPay. Welcome to your upgraded tier.'
            });
        }

        setTimeout(() => router.push('/dashboard/projects'), 1800);
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-card/10 to-background px-4 text-foreground selection:bg-primary selection:text-primary-foreground">
            <div className="w-full max-w-md">
                <Card className="border border-border bg-card shadow-2xl relative overflow-hidden backdrop-blur-md">
                    {/* Glowing background hint */}
                    <div className="absolute top-0 right-0 h-40 w-40 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

                    <CardHeader className="text-center pb-2">
                        <div className="text-[10px] font-mono text-primary uppercase tracking-widest font-bold mb-1">
                            FLUXBASE // BILLING & PAYMENTS
                        </div>
                        <CardTitle className="text-xl font-bold tracking-tight">
                            {status === 'completed'
                                ? 'Payment Verified!'
                                : status === 'expired'
                                ? 'Session Expired'
                                : status === 'error'
                                ? 'Checkout Error'
                                : 'Redirecting to FluxPay'}
                        </CardTitle>
                        <CardDescription className="text-xs">
                            {message}
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="flex flex-col items-center justify-center py-8 text-center space-y-4">
                        {status === 'completed' && (
                            <div className="space-y-4 animate-in zoom-in-95 duration-300">
                                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/80 border-2 border-emerald-500 flex items-center justify-center text-emerald-400">
                                    <Check className="h-8 w-8" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold text-foreground">
                                        Subscription Activated Successfully
                                    </p>
                                    {paramUtr && (
                                        <p className="text-xs font-mono text-muted-foreground">
                                            Bank UTR: {paramUtr}
                                        </p>
                                    )}
                                </div>
                                <p className="text-xs text-primary font-mono animate-pulse">
                                    Redirecting to dashboard in a moment...
                                </p>
                            </div>
                        )}

                        {(status === 'redirecting' || status === 'verifying') && (
                            <div className="space-y-4 py-4">
                                <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto" />
                                <p className="text-xs text-muted-foreground font-mono">
                                    Redirecting to payments.fluxbasedb.me...
                                </p>
                            </div>
                        )}

                        {status === 'expired' && (
                            <div className="space-y-4">
                                <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive">
                                    <AlertCircle className="h-7 w-7" />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    The checkout session timed out. Please return to your projects and initiate an upgrade again.
                                </p>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="space-y-4">
                                <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive">
                                    <AlertCircle className="h-7 w-7" />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {message}
                                </p>
                            </div>
                        )}
                    </CardContent>

                    {(status === 'completed' || status === 'expired' || status === 'error') && (
                        <CardFooter className="pt-2 pb-6 border-t border-border/50 flex justify-center">
                            <Button
                                onClick={() => router.push('/dashboard/projects')}
                                className="w-full bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center gap-2"
                            >
                                <span>Go to Projects Dashboard</span>
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        </CardFooter>
                    )}
                </Card>
            </div>
        </div>
    );
}

export default function CheckoutPage() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-foreground">
                <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
                <p className="text-muted-foreground text-xs font-mono">Connecting to FluxPay Gateway...</p>
            </div>
        }>
            <CheckoutHandler />
        </Suspense>
    );
}
