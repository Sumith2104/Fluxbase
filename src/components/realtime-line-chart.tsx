"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRealtimeHistoryAction } from '@/app/(app)/dashboard/analytics-actions';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticsStats, useRealtimeAnalytics } from '@/hooks/use-realtime-analytics';
import { Activity } from 'lucide-react';

interface RealtimeLineChartProps {
    projectId: string;
    stats?: AnalyticsStats | null;
}

interface DataPoint {
    timestamp: number;
    timeLabel: string;
    requests: number;
    api: number;
    sql: number;
    deltaRequests: number;
    deltaApi: number;
    deltaSql: number;
}

const renderCustomDot = (props: any) => {
    const { cx, cy, index, dataKey, payload } = props;
    const isLatest = payload?.isLatest;

    // Only show a subtle dot at the latest point
    if (isLatest && dataKey === 'requests') {
        return (
            <g key={`dot-${index}`}>
                <circle cx={cx} cy={cy} r={3} fill="#94a3b8" stroke="#18181b" strokeWidth={2} />
            </g>
        );
    }
    return <g key={`dot-${index}`} />;
};

export function RealtimeLineChart({ projectId, stats: propStats }: RealtimeLineChartProps) {
    const hookStats = useRealtimeAnalytics(propStats !== undefined ? undefined : projectId);
    const stats = propStats !== undefined ? propStats : hookStats;

    const { data: initialHistory } = useQuery({
        queryKey: ['realtime-line-history', projectId],
        queryFn: () => getRealtimeHistoryAction(projectId),
        enabled: !!projectId,
        staleTime: 15000,
        gcTime: 5 * 60 * 1000
    });

    const [data, setData] = useState<DataPoint[]>(() => {
        const initialData: DataPoint[] = [];
        const now = Date.now();
        for (let i = 59; i >= 0; i--) {
            const time = now - i * 60000;
            const date = new Date(time);
            initialData.push({
                timestamp: time,
                timeLabel: date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' }),
                requests: 0,
                api: 0,
                sql: 0,
                deltaRequests: 0,
                deltaApi: 0,
                deltaSql: 0,
            });
        }
        return initialData;
    });

    const [isHovered, setIsHovered] = useState(false);
    const [peakRPS, setPeakRPS] = useState(0);

    useEffect(() => {
        if (initialHistory && initialHistory.length > 0) {
            setData(initialHistory);
            const maxVal = Math.max(...initialHistory.map(d => d.requests || 0), 0);
            if (maxVal > 0) setPeakRPS(maxVal);
        }
    }, [initialHistory]);

    const reqColor = isHovered ? "#f97316" : "#71717a";
    const apiColor = isHovered ? "#ea580c" : "#52525b";
    const sqlColor = isHovered ? "#78716c" : "#3f3f46";

    // Keep track of the absolute stats independently
    const currentStatsRef = useRef<AnalyticsStats | null>(null);
    const prevTickStatsRef = useRef<AnalyticsStats | null>(null);

    // Update our ref whenever SSE pushes new data
    useEffect(() => {
        if (stats) {
            currentStatsRef.current = stats;
        }
    }, [stats]);

    // Independent smooth visual ticking interval
    useEffect(() => {
        const tickInterval = setInterval(() => {
            const current = currentStatsRef.current;
            const prev = prevTickStatsRef.current;

            // If we have an older baseline, calculate the delta
            let deltaReq = 0, deltaA = 0, deltaS = 0;

            if (current && prev) {
                deltaReq = Math.max(0, current.total_requests - prev.total_requests);
                deltaA = Math.max(0, current.type_api_call - prev.type_api_call);
                deltaS = Math.max(0, current.type_sql_execution - prev.type_sql_execution);
            }

            // Always tick the previous ref up so we don't double-count on the next interval
            if (current) {
                prevTickStatsRef.current = current;
            }

            const now = Date.now();
            const date = new Date(now);

            setData(currentData => {
                const newData = [...currentData];
                // Smoothly shift left
                newData.shift();
                newData.push({
                    timestamp: now,
                    timeLabel: date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, minute: '2-digit', second: '2-digit' }),
                    requests: deltaReq,
                    api: deltaA,
                    sql: deltaS,
                    deltaRequests: deltaReq,
                    deltaApi: deltaA,
                    deltaSql: deltaS
                });
                return newData;
            });

            setPeakRPS(prevPeak => Math.max(prevPeak, deltaReq));
        }, 2000); // 2-second reliable local tick

        // Phase 4: Reset peak RPS every 5 minutes to maintain accurate "recent peak" semantics.
        // Without this, peakRPS only ever grows and never reflects the current activity level.
        const peakResetInterval = setInterval(() => {
            setPeakRPS(0);
        }, 5 * 60 * 1000);

        return () => {
            clearInterval(tickInterval);
            clearInterval(peakResetInterval);
        };
    }, []);

    const averages = useMemo(() => {
        if (data.length === 0) return { requests: 0, api: 0, sql: 0 };
        const sum = data.reduce((acc, curr) => ({
            requests: acc.requests + curr.requests,
            api: acc.api + curr.api,
            sql: acc.sql + curr.sql
        }), { requests: 0, api: 0, sql: 0 });

        return {
            requests: (sum.requests / data.length).toFixed(0),
            api: (sum.api / data.length).toFixed(0),
            sql: (sum.sql / data.length).toFixed(0)
        };
    }, [data]);

    const currentRPS = data.length > 0 ? data[data.length - 1].requests : 0;

    // Enhance data for chart rendering (adding isLatest flag)
    const chartData = data.map((d, i) => ({
        ...d,
        isLatest: i === data.length - 1
    }));

    return (
        <Card 
            className="col-span-4 flex flex-col h-full min-h-[400px] border-border bg-card/30 backdrop-blur-md transition-colors hover:bg-card/50"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/40">
                <div className="space-y-1">
                    <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                        <Activity className="h-4 w-4 text-muted-foreground/60" />
                        Real-Time Activity
                    </CardTitle>
                    <CardDescription className="text-muted-foreground text-xs">Live incoming requests</CardDescription>
                </div>

                {/* KPI Metrics */}
                <div className="flex gap-8">
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono">Current</span>
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-orange-500/70" />
                            <span className="text-xl font-semibold font-mono text-orange-400">
                                {currentRPS}
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono">Peak (60s)</span>
                        <span className="text-xl font-semibold font-mono text-foreground/80">
                            {peakRPS}
                        </span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono">Avg</span>
                        <span className="text-xl font-semibold font-mono text-muted-foreground/70">
                            {averages.requests}
                        </span>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pl-0 pb-0 pt-6 flex-1 flex flex-col">
                <div className="flex-1 w-full min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={reqColor} stopOpacity={0.25} />
                                    <stop offset="95%" stopColor={reqColor} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorApi" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={apiColor} stopOpacity={0.15} />
                                    <stop offset="95%" stopColor={apiColor} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorSql" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={sqlColor} stopOpacity={0.15} />
                                    <stop offset="95%" stopColor={sqlColor} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" vertical={true} horizontal={true} />
                            <XAxis
                                dataKey="timeLabel"
                                stroke="#525252"
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                minTickGap={30}
                                dy={10}
                                tick={{ fill: '#71717a' }}
                            />
                            <YAxis
                                stroke="#525252"
                                fontSize={10}
                                tickLine={false}
                                axisLine={false}
                                width={50}
                                domain={[(dataMin: number) => dataMin > 0 ? 0 : -0.5, (dataMax: number) => Math.max(5, Math.ceil(dataMax * 1.3))]} allowDataOverflow={false}
                                tick={{ fill: '#71717a' }}
                            />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        return (
                                            <div className="rounded-lg border border-border bg-popover/95 backdrop-blur-xl p-3 shadow-[0_4px_20px_rgba(0,0,0,0.5)] min-w-[200px]">
                                                <div className="mb-2 border-b border-border pb-2">
                                                    <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
                                                </div>
                                                <div className="space-y-2.5">
                                                    {payload.map((p: any) => {
                                                        const deltaKey = p.dataKey === 'requests' ? 'deltaRequests' : p.dataKey === 'api' ? 'deltaApi' : 'deltaSql';
                                                        const delta = p.payload[deltaKey] || 0;
                                                        const isPositive = delta > 0;
                                                        const isNegative = delta < 0;

                                                        return (
                                                            <div key={p.name} className="flex items-center justify-between gap-4">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.stroke }} />
                                                                    <span className="text-xs font-medium text-foreground/85">{p.name}</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`text-[10px] font-medium font-mono ${isPositive ? 'text-emerald-400' : isNegative ? 'text-rose-400' : 'text-muted-foreground/75'}`}>
                                                                        {isPositive ? '+' : ''}{delta !== 0 ? delta : ''}
                                                                    </span>
                                                                    <span className="font-mono text-sm font-bold text-foreground min-w-[3ch] text-right">
                                                                        {p.value}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    }
                                    return null
                                }}
                            />

                            <Area
                                type="monotone"
                                dataKey="requests"
                                stroke={reqColor}
                                strokeWidth={1.5}
                                fill="url(#colorRequests)"
                                name="Total Requests"
                                isAnimationActive={true}
                                animationDuration={2000}
                                animationEasing="ease-out"
                                animationBegin={100}
                                dot={renderCustomDot}
                                activeDot={false}
                            />
                            <Area
                                type="monotone"
                                dataKey="api"
                                stroke={apiColor}
                                strokeWidth={1}
                                strokeOpacity={0.7}
                                fill="url(#colorApi)"
                                name="API Calls"
                                isAnimationActive={true}
                                animationDuration={2000}
                                animationEasing="ease-out"
                                animationBegin={250}
                                dot={false}
                                activeDot={false}
                            />
                            <Area
                                type="monotone"
                                dataKey="sql"
                                stroke={sqlColor}
                                strokeWidth={1}
                                strokeOpacity={0.7}
                                fill="url(#colorSql)"
                                name="SQL Executions"
                                isAnimationActive={true}
                                animationDuration={2000}
                                animationEasing="ease-out"
                                animationBegin={400}
                                dot={false}
                                activeDot={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
