'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { 
    CreditCard, Zap, Activity, HardDrive, Cpu, 
    ArrowUpRight, Clock, CheckCircle2, Receipt, 
    Sparkles, Building2, Briefcase, GraduationCap, 
    Loader2, ChevronRight, ShieldCheck, RefreshCw 
} from 'lucide-react';
import { getBillingDetailsAction, BillingDetails } from '@/app/(app)/settings/billing-actions';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function PaymentsBillsManager() {
    const { toast } = useToast();
    const router = useRouter();
    const [billingData, setBillingData] = useState<BillingDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);

    const fetchBilling = async () => {
        setLoading(true);
        try {
            const res = await getBillingDetailsAction();
            if (res.success && res.data) {
                setBillingData(res.data);
            }
        } catch (e: any) {
            console.error('Error fetching billing details:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBilling();
    }, []);

    const handleStartCheckout = async (planKey: string) => {
        setUpgradingPlan(planKey);
        try {
            const res = await fetch('/api/payments/create-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan: planKey })
            });
            const data = await res.json();
            if (res.ok && (data.checkoutUrl || data.sessionId)) {
                toast({
                    title: 'Redirecting to FluxPay',
                    description: `Redirecting to payments.fluxbasedb.me to review order and pay...`,
                });
                if (data.checkoutUrl) {
                    let targetUrl = String(data.checkoutUrl).trim();
                    if (targetUrl.startsWith('//')) {
                        targetUrl = `https:${targetUrl}`;
                    } else if (!/^https?:\/\//i.test(targetUrl)) {
                        targetUrl = `https://${targetUrl.replace(/^\/+/, '')}`;
                    }
                    window.location.href = targetUrl;
                } else {
                    router.push(`/checkout?sessionId=${data.sessionId}`);
                }
            } else {
                throw new Error(data.error || 'Failed to initialize payment');
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Checkout Error',
                description: err.message,
            });
        } finally {
            setUpgradingPlan(null);
        }
    };

    if (loading) {
        return (
            <Card className="border-border/80 bg-card/40">
                <CardHeader className="flex flex-row items-center justify-between pb-4">
                    <div className="space-y-1.5">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-72" />
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full" />
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="p-4 rounded-xl border border-border/60 bg-secondary/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-5 w-28" />
                                <Skeleton className="h-5 w-16 rounded-full" />
                            </div>
                            <Skeleton className="h-4 w-52" />
                        </div>
                        <Skeleton className="h-9 w-32 rounded" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="p-3.5 rounded-lg border border-border/50 bg-secondary/20 space-y-2">
                                <div className="flex justify-between">
                                    <Skeleton className="h-3.5 w-16" />
                                    <Skeleton className="h-3.5 w-12" />
                                </div>
                                <Skeleton className="h-2 w-full rounded-full" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    const plan = billingData?.plan || 'free';
    const role = billingData?.role || 'student';
    const queriesPercentage = Math.min(100, Math.round(((billingData?.queriesUsed || 0) / (billingData?.queriesLimit || 1)) * 100));
    const storagePercentage = Math.min(100, Math.round(((billingData?.storageUsedGb || 0) / (billingData?.storageLimitGb || 1)) * 100));

    return (
        <div className="space-y-6">
            
            {/* ── 1. Plan Overview & Active Tier ── */}
            <Card className="border-border/80 bg-card/40 overflow-hidden">
                <CardHeader className="border-b border-border/50 pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
                                <CreditCard className="h-5 w-5" />
                            </div>
                            <div>
                                <CardTitle className="text-lg font-bold">Payments, Bills & Usage</CardTitle>
                                <CardDescription className="text-xs">
                                    Manage your dedicated server tier, Pay-As-You-Go meters, and invoices.
                                </CardDescription>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="font-mono text-xs uppercase px-2.5 py-1 bg-primary/10 text-primary border-primary/20">
                                {role === 'org_owner' ? 'Org Owner Tier' : (role === 'employee' ? 'Employee Tier' : 'Student Tier')}
                            </Badge>
                            <Button size="sm" variant="ghost" onClick={fetchBilling} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
                                <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-6 space-y-6">
                    
                    {/* Active Plan Banner */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-secondary/40 border border-border/60 gap-4">
                        <div className="flex items-center gap-3.5">
                            <div className="p-3 rounded-lg bg-primary/10 text-primary">
                                {role === 'org_owner' ? <Building2 className="h-6 w-6" /> : (role === 'employee' ? <Briefcase className="h-6 w-6" /> : <GraduationCap className="h-6 w-6" />)}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-base text-foreground capitalize">
                                        {role === 'org_owner' ? 'Organization Owner (Top-Grade Enterprise)' : (role === 'employee' ? 'Employee (High-Performance Dedicated)' : `Student (${plan.toUpperCase()} Plan)`)}
                                    </h3>
                                    <Badge variant="outline" className="text-[10px] font-mono text-green-400 bg-green-500/10 border-green-500/20">
                                        Active
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {role === 'org_owner' ? '₹5,000 / month • 8 vCPU Dedicated Xeon, 32GB RAM, 100GB NVMe' : (role === 'employee' ? '₹500 / month • 2 vCPU Dedicated, 4GB RAM, 10GB SSD' : 'Student Tier • Shared Micro Compute with instant serverless provisioning')}
                                </p>
                            </div>
                        </div>

                        {billingData?.billing_cycle_end && (
                            <div className="text-right text-xs font-mono text-muted-foreground">
                                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/70">Next Renewal</span>
                                <span className="text-foreground font-semibold">{new Date(billingData.billing_cycle_end).toLocaleDateString()}</span>
                            </div>
                        )}
                    </div>

                    {/* ── 2. Pay-As-You-Go Live Metered Usage ── */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                <Activity className="h-3.5 w-3.5 text-primary" />
                                Pay-As-You-Go Consumption & Meters
                            </h4>
                            <span className="text-xs font-mono text-muted-foreground">
                                Current Cycle Unbilled: <strong className="text-foreground font-bold font-mono">₹{billingData?.unbilledAmount.toFixed(2)}</strong>
                            </span>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            {/* Queries Meter */}
                            <div className="p-4 rounded-xl border border-border/60 bg-secondary/20 space-y-2">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-medium text-foreground flex items-center gap-1.5">
                                        <Cpu className="h-3.5 w-3.5 text-blue-400" />
                                        SQL Query Executions
                                    </span>
                                    <span className="font-mono text-muted-foreground">
                                        {billingData?.queriesUsed.toLocaleString()} / {billingData?.queriesLimit.toLocaleString()}
                                    </span>
                                </div>
                                <Progress value={queriesPercentage} className="h-1.5 bg-secondary" />
                                <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                                    <span>{queriesPercentage}% of base quota</span>
                                    <span>Rate: {role === 'org_owner' ? '₹2.00 / 10k extra' : '₹0.50 / 10k extra'}</span>
                                </div>
                            </div>

                            {/* Storage Meter */}
                            <div className="p-4 rounded-xl border border-border/60 bg-secondary/20 space-y-2">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-medium text-foreground flex items-center gap-1.5">
                                        <HardDrive className="h-3.5 w-3.5 text-purple-400" />
                                        Database NVMe Storage
                                    </span>
                                    <span className="font-mono text-muted-foreground">
                                        {billingData?.storageUsedGb} GB / {billingData?.storageLimitGb} GB
                                    </span>
                                </div>
                                <Progress value={storagePercentage} className="h-1.5 bg-secondary" />
                                <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                                    <span>{storagePercentage}% allocated</span>
                                    <span>Rate: {role === 'org_owner' ? '₹15 / extra GB' : '₹5 / extra GB'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── 3. Plan Upgrades & Tier Switcher ── */}
                    <div>
                        <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
                            Switch Tier or Upgrade
                        </h4>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            
                            {/* Employee Tier (₹500) */}
                            <Card className="p-4 border-border/80 bg-secondary/30 flex flex-col justify-between hover:border-blue-500/50 transition-all">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <h5 className="font-bold text-sm text-foreground">Employee Dedicated</h5>
                                        <Badge variant="outline" className="text-[10px] font-mono bg-blue-500/10 text-blue-400 border-blue-500/20">₹500 / mo</Badge>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">High-Performance 2 vCPU, 4GB RAM, 10GB SSD.</p>
                                </div>
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    onClick={() => handleStartCheckout('employee')}
                                    disabled={upgradingPlan !== null || role === 'employee'}
                                    className="mt-3 text-xs w-full font-medium border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-400"
                                >
                                    {upgradingPlan === 'employee' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (role === 'employee' ? 'Current Tier' : 'Upgrade (₹500)')}
                                </Button>
                            </Card>

                            {/* Org Owner Tier (₹5,000) */}
                            <Card className="p-4 border-border/80 bg-secondary/30 flex flex-col justify-between hover:border-purple-500/50 transition-all">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <h5 className="font-bold text-sm text-foreground">Org Owner Enterprise</h5>
                                        <Badge variant="outline" className="text-[10px] font-mono bg-purple-500/10 text-purple-400 border-purple-500/20">₹5,000 / mo</Badge>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">Top-Grade 8 vCPU Xeon, 32GB RAM, 100GB Gen4 NVMe.</p>
                                </div>
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    onClick={() => handleStartCheckout('org_owner')}
                                    disabled={upgradingPlan !== null || role === 'org_owner'}
                                    className="mt-3 text-xs w-full font-medium border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400"
                                >
                                    {upgradingPlan === 'org_owner' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (role === 'org_owner' ? 'Current Tier' : 'Upgrade (₹5,000)')}
                                </Button>
                            </Card>

                            {/* Student Pro Upgrade */}
                            <Card className="p-4 border-border/80 bg-secondary/30 flex flex-col justify-between hover:border-primary/50 transition-all">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <h5 className="font-bold text-sm text-foreground">Student Pro Plan</h5>
                                        <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20">Student Only</Badge>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">Unlimited projects, 5GB storage, 250k queries/mo.</p>
                                </div>
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    onClick={() => handleStartCheckout('pro')}
                                    disabled={upgradingPlan !== null || plan === 'pro'}
                                    className="mt-3 text-xs w-full font-medium"
                                >
                                    {upgradingPlan === 'pro' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (plan === 'pro' ? 'Current Plan' : 'Get Student Pro')}
                                </Button>
                            </Card>

                        </div>
                    </div>

                    {/* ── 4. Invoices & Transaction Receipts History ── */}
                    <div>
                        <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                            <Receipt className="h-3.5 w-3.5 text-primary" />
                            Invoices & Payment Receipts
                        </h4>

                        {(!billingData?.invoices || billingData.invoices.length === 0) ? (
                            <div className="p-6 rounded-xl border border-dashed border-border/60 text-center bg-secondary/20">
                                <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                                <p className="text-xs text-muted-foreground">No invoices found for this account.</p>
                            </div>
                        ) : (
                            <div className="rounded-xl border border-border/60 overflow-hidden bg-secondary/20">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-secondary/40 text-muted-foreground border-b border-border/60 font-mono uppercase text-[10px]">
                                        <tr>
                                            <th className="p-3">Date</th>
                                            <th className="p-3">Description / Tier</th>
                                            <th className="p-3">Reference ID</th>
                                            <th className="p-3">Amount</th>
                                            <th className="p-3">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40">
                                        {billingData.invoices.map((inv) => (
                                            <tr key={inv.id} className="hover:bg-secondary/40 transition-colors">
                                                <td className="p-3 font-mono">{inv.date}</td>
                                                <td className="p-3 font-medium capitalize text-foreground">{inv.plan} Subscription</td>
                                                <td className="p-3 font-mono text-muted-foreground text-[11px] truncate max-w-[120px]">{inv.transactionId}</td>
                                                <td className="p-3 font-mono font-bold text-foreground">₹{inv.amount.toFixed(2)}</td>
                                                <td className="p-3">
                                                    <Badge variant="outline" className="text-[10px] font-mono text-green-400 bg-green-500/10 border-green-500/20">
                                                        {inv.status}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                </CardContent>
            </Card>

        </div>
    );
}
