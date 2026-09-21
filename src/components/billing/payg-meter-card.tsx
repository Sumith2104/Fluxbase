'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { 
    Activity, 
    Database, 
    Layers, 
    HardDrive, 
    KeyRound, 
    Cpu, 
    Calendar, 
    Clock, 
    IndianRupee, 
    ShieldAlert, 
    RefreshCw, 
    Info, 
    CheckCircle2, 
    Sparkles 
} from 'lucide-react';

interface PaygMeterCardProps {
    projectId: string;
}

export function PaygMeterCard({ projectId }: PaygMeterCardProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [cycleData, setCycleData] = useState<any>(null);
    const [spendingLimitInput, setSpendingLimitInput] = useState<string>('');
    const [isSavingLimit, setIsSavingLimit] = useState(false);
    const [showBreakdown, setShowBreakdown] = useState(false);
    const [lastSynced, setLastSynced] = useState<Date | null>(null);

    const fetchPaygData = async (force: boolean = false) => {
        if (!projectId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/payg?projectId=${projectId}${force ? '&force=true' : ''}`);
            const data = await res.json();
            if (res.ok && data.success) {
                setCycleData(data.cycle);
                setSpendingLimitInput(data.cycle.spendingLimit?.toString() || '1000');
                setLastSynced(new Date());
            }
        } catch (e: any) {
            console.error('Error fetching PAYG data:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPaygData(false);
    }, [projectId]);

    const handleSaveSpendingLimit = async () => {
        const val = parseFloat(spendingLimitInput);
        if (isNaN(val) || val <= 0) {
            toast({ variant: 'destructive', title: 'Invalid Limit', description: 'Please enter a valid spending amount in ₹.' });
            return;
        }

        setIsSavingLimit(true);
        try {
            const res = await fetch('/api/payg', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, spendingLimit: val })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast({ title: 'Spending Cap Updated', description: `Alerts will trigger if usage exceeds ₹${val}.` });
                fetchPaygData(true);
            } else {
                toast({ variant: 'destructive', title: 'Update Failed', description: data.error || 'Failed to update cap' });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Network Error', description: e.message });
        } finally {
            setIsSavingLimit(false);
        }
    };

    if (loading && !cycleData) {
        return (
            <Card className="border border-border/60 bg-card/40 backdrop-blur-sm p-6 text-center">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground animate-pulse">
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    Calculating real-time resource meters...
                </div>
            </Card>
        );
    }

    if (!cycleData) return null;

    const { daysElapsed, totalDays, daysRemaining, cycleStart, cycleEnd, metrics, bill, cycleNumber, spendingLimit, userPlan } = cycleData;
    const isSubscription = userPlan?.isSubscription;
    const planName = userPlan?.planName || 'Pay-As-You-Go';

    const reqBreakdown = bill.breakdown?.find((b: any) => b.dimension.includes('API')) || bill.breakdown?.[0];
    const tableBreakdown = bill.breakdown?.find((b: any) => b.dimension.includes('Table')) || bill.breakdown?.[1];
    const rowBreakdown = bill.breakdown?.find((b: any) => b.dimension.includes('Row')) || bill.breakdown?.[2];
    const storageBreakdown = bill.breakdown?.find((b: any) => b.dimension.includes('Storage')) || bill.breakdown?.[3];
    const keyBreakdown = bill.breakdown?.find((b: any) => b.dimension.includes('Key')) || bill.breakdown?.[4];
    const mcpBreakdown = bill.breakdown?.find((b: any) => b.dimension.includes('MCP')) || bill.breakdown?.[5];

    const reqAllowance = reqBreakdown?.freeAllowance || (isSubscription ? 5000000 : 50000);
    const tableAllowance = tableBreakdown?.freeAllowance || (isSubscription ? 100 : 5);
    const rowAllowance = rowBreakdown?.freeAllowance || (isSubscription ? 10000000 : 25000);
    const storageAllowanceMb = storageBreakdown?.freeAllowance || (isSubscription ? 102400 : 100);
    const keyAllowance = keyBreakdown?.freeAllowance || (isSubscription ? 50 : 2);
    const mcpAllowance = mcpBreakdown?.freeAllowance || (isSubscription ? 10000 : 100);

    const progressPercent = Math.min(100, Math.round((daysElapsed / totalDays) * 100));

    const startDateStr = new Date(cycleStart).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
    const endDateStr = new Date(cycleEnd).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
    const renewalDateStr = userPlan?.billingCycleEnd ? new Date(userPlan.billingCycleEnd).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : endDateStr;

    return (
        <Card className="border border-primary/20 bg-gradient-to-b from-card/80 via-card/40 to-background/90 shadow-xl backdrop-blur-md overflow-hidden">
            {/* Header: Cycle Timeline */}
            <CardHeader className="border-b border-border/40 pb-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                    <div>
                        <div className="flex items-center gap-2">
                            <CardTitle className="text-base font-bold flex items-center gap-2">
                                <Activity className="h-4 w-4 text-primary animate-pulse" />
                                {isSubscription ? `Workspace Resource Meter (${planName})` : 'Pay-As-You-Go 28-Day Meter'}
                            </CardTitle>
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] font-mono">
                                {isSubscription ? 'Included Quota' : `Cycle #${cycleNumber}`}
                            </Badge>
                        </div>
                        <CardDescription className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            <Calendar className="h-3 w-3" />
                            {isSubscription 
                                ? `${reqAllowance.toLocaleString()} queries included • Renews on ${renewalDateStr}`
                                : `${startDateStr} — ${endDateStr} (${daysRemaining} days remaining)`}
                        </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                        {lastSynced && (
                            <span className="text-[10px] text-muted-foreground hidden sm:inline-block font-mono">
                                Synced {lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => fetchPaygData(true)}
                            disabled={loading}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Sync
                        </Button>
                    </div>
                </div>

                {/* 28-Day Cycle Timeline Bar */}
                <div className="pt-3 space-y-1.5">
                    <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
                        <span>Day {daysElapsed} of {totalDays}</span>
                        <span>{daysRemaining} Days Left in Cycle</span>
                    </div>
                    <Progress value={progressPercent} className="h-1.5 bg-muted/40" />
                </div>
            </CardHeader>

            <CardContent className="p-5 space-y-5">
                {/* Current Accrued Bill Banner */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border border-border/60 bg-gradient-to-r from-card to-secondary/20 gap-4">
                    <div className="space-y-1">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                            {isSubscription ? 'Current Cycle Bill & Inclusions' : 'Current Cycle Accrued Bill'}
                        </span>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black font-mono text-foreground">
                                ₹{bill.totalAmount.toFixed(2)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {isSubscription ? '/ Included in Monthly Plan' : '/ 28 days'}
                            </span>
                            {bill.totalAmount === 0 && (
                                <Badge variant="secondary" className="text-[10px] ml-1 text-emerald-500 border-emerald-500/20 bg-emerald-500/10 font-medium">
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> {isSubscription ? `100% Covered by ${planName}` : '100% Free Baseline'}
                                </Badge>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            {isSubscription 
                                ? `${metrics.totalRequests.toLocaleString()} of ${reqAllowance.toLocaleString()} queries used (${((metrics.totalRequests / (reqAllowance || 1)) * 100).toFixed(1)}%). Zero unbilled overage.` 
                                : `Calculated from day of project creation. Billed on ${endDateStr}.`}
                        </p>
                    </div>

                    {/* Safety Spending Cap */}
                    <div className="flex flex-col items-start sm:items-end gap-1.5 w-full sm:w-auto">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                            <ShieldAlert className="h-3 w-3 text-amber-500" /> Spending Cap
                        </span>
                        <div className="flex items-center gap-1.5 w-full sm:w-auto">
                            <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">₹</span>
                                <Input
                                    type="number"
                                    value={spendingLimitInput}
                                    onChange={(e) => setSpendingLimitInput(e.target.value)}
                                    className="h-8 w-24 pl-6 text-xs font-mono"
                                />
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleSaveSpendingLimit}
                                disabled={isSavingLimit || parseFloat(spendingLimitInput) === spendingLimit}
                                className="h-8 text-xs font-medium"
                            >
                                {isSavingLimit ? 'Saving...' : 'Set Cap'}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* 6 Metered Dimensions Grid */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground uppercase tracking-wider text-[11px]">
                            Live Resource Metrics (6 Dimensions)
                        </span>
                        <button
                            onClick={() => setShowBreakdown(!showBreakdown)}
                            className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                        >
                            <Info className="h-3 w-3" /> {showBreakdown ? 'Hide Pricing Breakdown' : 'View Pricing Breakdown'}
                        </button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {/* 1. Requests */}
                        <MetricTile
                            icon={<Activity className="h-3.5 w-3.5 text-blue-400" />}
                            title="API & Query Reqs"
                            used={metrics.totalRequests.toLocaleString()}
                            allowance={isSubscription ? `${reqAllowance.toLocaleString()} included` : `${reqAllowance.toLocaleString()} free`}
                            percent={Math.min(100, (metrics.totalRequests / (reqAllowance || 1)) * 100)}
                            rate={isSubscription ? (reqBreakdown?.billableUnits > 0 ? reqBreakdown.rateDescription : 'Included in Plan') : '₹10 / 50k excess'}
                        />

                        {/* 2. Tables */}
                        <MetricTile
                            icon={<Database className="h-3.5 w-3.5 text-indigo-400" />}
                            title="Database Tables"
                            used={`${metrics.totalTables} tables`}
                            allowance={isSubscription ? `${tableAllowance} included` : `${tableAllowance} free`}
                            percent={Math.min(100, (metrics.totalTables / (tableAllowance || 1)) * 100)}
                            rate={isSubscription ? (tableBreakdown?.billableUnits > 0 ? tableBreakdown.rateDescription : 'Included in Plan') : '₹2 / table excess'}
                        />

                        {/* 3. Rows */}
                        <MetricTile
                            icon={<Layers className="h-3.5 w-3.5 text-emerald-400" />}
                            title="Total Table Rows"
                            used={metrics.totalRows.toLocaleString()}
                            allowance={isSubscription ? `${rowAllowance.toLocaleString()} included` : `${rowAllowance.toLocaleString()} free`}
                            percent={Math.min(100, (metrics.totalRows / (rowAllowance || 1)) * 100)}
                            rate={isSubscription ? (rowBreakdown?.billableUnits > 0 ? rowBreakdown.rateDescription : 'Included in Plan') : '₹5 / 50k excess'}
                        />

                        {/* 4. Storage */}
                        <MetricTile
                            icon={<HardDrive className="h-3.5 w-3.5 text-purple-400" />}
                            title="Storage Footprint"
                            used={`${metrics.storageMb} MB`}
                            allowance={isSubscription ? `${(storageAllowanceMb / 1024).toFixed(0)} GB included` : `${storageAllowanceMb} MB free`}
                            percent={Math.min(100, (metrics.storageMb / (storageAllowanceMb || 1)) * 100)}
                            rate={isSubscription ? (storageBreakdown?.billableUnits > 0 ? storageBreakdown.rateDescription : 'Included in Plan') : '₹15 / 100 MB excess'}
                        />

                        {/* 5. API Keys */}
                        <MetricTile
                            icon={<KeyRound className="h-3.5 w-3.5 text-amber-400" />}
                            title="Active API Keys"
                            used={`${metrics.activeApiKeys} keys`}
                            allowance={isSubscription ? `${keyAllowance} included` : `${keyAllowance} free`}
                            percent={Math.min(100, (metrics.activeApiKeys / (keyAllowance || 1)) * 100)}
                            rate={isSubscription ? (keyBreakdown?.billableUnits > 0 ? keyBreakdown.rateDescription : 'Included in Plan') : '₹5 / key excess'}
                        />

                        {/* 6. MCP Usage */}
                        <MetricTile
                            icon={<Cpu className="h-3.5 w-3.5 text-rose-400" />}
                            title="MCP Tool Calls"
                            used={`${metrics.mcpCalls} calls`}
                            allowance={isSubscription ? `${mcpAllowance.toLocaleString()} included` : `${mcpAllowance.toLocaleString()} free`}
                            percent={Math.min(100, (metrics.mcpCalls / (mcpAllowance || 1)) * 100)}
                            rate={isSubscription ? (mcpBreakdown?.billableUnits > 0 ? mcpBreakdown.rateDescription : 'Included in Plan') : '₹10 / 500 excess'}
                        />
                    </div>
                </div>

                {/* Collapsible Itemized Bill Breakdown */}
                {showBreakdown && (
                    <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2 text-xs animate-in fade-in duration-200">
                        <div className="font-semibold text-foreground flex items-center gap-1.5 pb-1 border-b border-border/40">
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Itemized Resource Allocation & Line Items
                        </div>
                        <div className="space-y-1.5 font-mono text-[11px]">
                            {bill.breakdown.map((item: any, idx: number) => (
                                <div key={idx} className="flex justify-between items-center py-0.5">
                                    <div className="text-muted-foreground">
                                        <span className="text-foreground font-medium">{item.dimension}:</span> {item.used} {item.unit} ({item.freeAllowance.toLocaleString()} {isSubscription ? 'included' : 'free'}) • {item.rateDescription}
                                    </div>
                                    <div className="font-semibold text-foreground">
                                        ₹{item.cost.toFixed(2)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>

            <CardFooter className="bg-card/50 border-t border-border/40 py-3 px-5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                    {isSubscription 
                        ? `Fixed ${planName} • Active until ${renewalDateStr}`
                        : '₹50 refundable deposit applied • Rolling 28-day settlement'}
                </span>
                <span className="font-mono">Next Rollover: {endDateStr}</span>
            </CardFooter>
        </Card>
    );
}

function MetricTile({ icon, title, used, allowance, percent, rate }: {
    icon: React.ReactNode;
    title: string;
    used: string;
    allowance: string;
    percent: number;
    rate: string;
}) {
    return (
        <div className="p-3 rounded-lg border border-border/60 bg-card/60 space-y-2 hover:border-primary/40 transition-colors">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                    {icon} {title}
                </span>
            </div>
            <div className="space-y-0.5">
                <div className="text-base font-bold font-mono text-foreground">
                    {used}
                </div>
                <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                    <span>{allowance}</span>
                    <span className="text-[9px] opacity-80">{rate}</span>
                </div>
            </div>
            <Progress value={percent} className="h-1 bg-muted/40" />
        </div>
    );
}
