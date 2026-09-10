"use client";

import { useState, useEffect } from "react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, YAxis, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SparklineCardProps {
    title: string;
    value: number;           // The real current total from realtimeStats
    subtitle: React.ReactNode;
    type: "line" | "bar" | "area";
    color?: string;          // Vibrant color on hover
    defaultColor?: string;   // Default grey color
    data: { val: number, timeLabel?: string }[]; // 24-hour history buckets from DB
}

export function SparklineCard({ 
    title, 
    value, 
    subtitle, 
    type, 
    color = "#f97316", 
    defaultColor, 
    data 
}: SparklineCardProps) {
    const [isHovered, setIsHovered] = useState(false);
    // Use the theme color so bars are vibrant and clearly visible, highlighting on hover
    const activeColor = isHovered ? color : (defaultColor || color);

    const [now, setNow] = useState(0);
    useEffect(() => {
        setNow(Date.now());
    }, []);

    // Use the real history data directly, and inject localized 1-hour timestamps
    // dynamically on the client so it perfectly matches the user's timezone.
    const chartData = (data || []).map((d, i) => {
        const val = Number(d?.val) || 0;
        if (now === 0) return { ...d, val };
        const date = new Date(now - (((data?.length || 24) - 1 - i) * 60 * 60 * 1000));
        return {
            ...d,
            val,
            timeLabel: d?.timeLabel || date.toLocaleTimeString([], { hour: 'numeric', hour12: true })
        };
    });

    // Y-axis: always ensure a visible scale.
    // Safe bounds prevent NaN or -Infinity when data is empty or all zeroes.
    const rawVals = chartData.map(d => Number(d.val) || 0);
    const dataMax = rawVals.length > 0 ? Math.max(...rawVals) : 0;
    const yMin = dataMax === 0 ? -0.5 : 0;
    const yMax = dataMax === 0 ? 3 : dataMax * 1.25;

    const tooltipStyle = {
        contentStyle: { backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px", color: "#fff", fontSize: "12px", padding: "8px 12px" },
        itemStyle: { color: activeColor, fontWeight: 600 },
        labelStyle: { display: "block", color: "#a1a1aa", marginBottom: "4px", fontWeight: 600, fontSize: "10px", textTransform: "uppercase" as const },
        formatter: (val: number) => [val === 0 ? "—" : val.toLocaleString(), title],
    };

    return (
        <Card
            className="h-full w-full aspect-square flex flex-col justify-between relative overflow-hidden group border-border bg-card/30 backdrop-blur-md transition-colors hover:bg-card/50"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Background Sparkline layer - clearly visible by default at 70% opacity, 100% on hover */}
            <div className="absolute inset-0 z-0 opacity-70 group-hover:opacity-100 transition-opacity duration-300 pb-2">
                <ResponsiveContainer width="100%" height="100%">
                    {type === "line" ? (
                        <LineChart data={chartData} margin={{ top: 20, right: 2, left: 2, bottom: 0 }}>
                            <XAxis dataKey="timeLabel" hide />
                            <Tooltip
                                cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1, strokeDasharray: "4 4" }}
                                {...tooltipStyle}
                            />
                            <YAxis hide domain={[yMin, yMax]} />
                            <Line
                                type="monotone"
                                dataKey="val"
                                stroke={activeColor}
                                strokeWidth={2.5}
                                dot={false}
                                isAnimationActive={true}
                                animationDuration={600}
                                animationEasing="ease-out"
                            />
                        </LineChart>
                    ) : type === "bar" ? (
                        <BarChart data={chartData} margin={{ top: 20, right: 2, left: 2, bottom: 0 }}>
                            <XAxis dataKey="timeLabel" hide />
                            <Tooltip
                                cursor={{ fill: "rgba(255,255,255,0.1)" }}
                                {...tooltipStyle}
                            />
                            <YAxis hide domain={[yMin, yMax]} />
                            <Bar
                                dataKey="val"
                                fill={activeColor}
                                radius={[3, 3, 0, 0]}
                                isAnimationActive={true}
                                animationDuration={600}
                                animationEasing="ease-out"
                                minPointSize={1}
                            />
                        </BarChart>
                    ) : (
                        <AreaChart data={chartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                            <XAxis dataKey="timeLabel" hide />
                            <Tooltip
                                cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1, strokeDasharray: "4 4" }}
                                {...tooltipStyle}
                            />
                            <YAxis hide domain={[yMin, yMax]} />
                            <defs>
                                <linearGradient id={`color-${title.replace(/\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={activeColor} stopOpacity={0.8} />
                                    <stop offset="95%" stopColor={activeColor} stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <Area
                                type="monotone"
                                dataKey="val"
                                stroke={activeColor}
                                fillOpacity={1}
                                fill={`url(#color-${title.replace(/\s+/g, '')})`}
                                isAnimationActive={true}
                                animationDuration={600}
                                animationEasing="ease-out"
                                strokeWidth={2}
                            />
                        </AreaChart>
                    )}
                </ResponsiveContainer>
            </div>

            {/* Foreground Content */}
            <div className="relative z-10 flex flex-col justify-between h-full p-6 pointer-events-none">
                <CardHeader className="p-0 pb-2">
                    <CardTitle className="text-xs font-medium tracking-wider uppercase text-muted-foreground/70 font-mono flex items-center gap-2">
                        {title}
                        {type === "line" && (
                            <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="text-3xl font-bold tracking-tight text-foreground">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </div>
                    <p className="text-xs text-muted-foreground font-medium mt-1 truncate">
                        {subtitle}
                    </p>
                </CardContent>
            </div>
        </Card>
    );
}
