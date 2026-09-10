
'use client';

import * as React from "react"
import { Pie, PieChart } from "recharts"

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
} from "@/components/ui/chart"
import { AnalyticsStats } from "@/hooks/use-realtime-analytics";

const chartConfig = {
    visitors: {
        label: "Queries",
    },
    select: {
        label: "SELECT",
        color: "#f97316",
    },
    insert: {
        label: "INSERT",
        color: "#fb923c",
    },
    update: {
        label: "UPDATE",
        color: "#fdba74",
    },
    delete: {
        label: "DELETE",
        color: "#78716c",
    },
    alter: {
        label: "ALTER",
        color: "#44403c",
    },
} satisfies ChartConfig

export function QueryTypeChart({ stats }: { stats: AnalyticsStats | null }) {
    const [isHovered, setIsHovered] = React.useState(false);

    const chartData = React.useMemo(() => {
        const selectColor = isHovered ? "#f97316" : "rgba(249, 115, 22, 0.85)";
        const insertColor = isHovered ? "#10b981" : "rgba(16, 185, 129, 0.85)";
        const updateColor = isHovered ? "#38bdf8" : "rgba(56, 189, 248, 0.85)";
        const deleteColor = isHovered ? "#f43f5e" : "rgba(244, 63, 94, 0.85)";
        const alterColor  = isHovered ? "#a855f7" : "rgba(168, 85, 247, 0.85)";

        const totalReq = stats?.total_requests || 0;
        const hasAnySpecific = ((stats?.type_sql_select || 0) + (stats?.type_sql_insert || 0) + (stats?.type_sql_update || 0) + (stats?.type_sql_delete || 0) + (stats?.type_sql_alter || 0)) > 0;

        const selectCount = hasAnySpecific ? (stats?.type_sql_select || 0) : totalReq;
        const insertCount = stats?.type_sql_insert || 0;
        const updateCount = stats?.type_sql_update || 0;
        const deleteCount = stats?.type_sql_delete || 0;
        const alterCount = stats?.type_sql_alter || 0;

        if (!stats || (totalReq === 0 && !hasAnySpecific)) return [
            { browser: "select", visitors: 0, fill: selectColor },
            { browser: "insert", visitors: 0, fill: insertColor },
            { browser: "update", visitors: 0, fill: updateColor },
            { browser: "delete", visitors: 0, fill: deleteColor },
            { browser: "alter", visitors: 0, fill: alterColor },
        ];

        return [
            { browser: "select", visitors: selectCount, fill: selectColor },
            { browser: "insert", visitors: insertCount, fill: insertColor },
            { browser: "update", visitors: updateCount, fill: updateColor },
            { browser: "delete", visitors: deleteCount, fill: deleteColor },
            { browser: "alter", visitors: alterCount, fill: alterColor },
        ];
    }, [stats, isHovered]);

    return (
        <Card 
            className="h-full w-full flex flex-col aspect-square justify-between border-border bg-card/30 backdrop-blur-md overflow-hidden transition-colors hover:bg-card/50"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <CardHeader className="items-center pb-4 border-b border-border/40">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono flex items-center gap-2">
                    Query Type
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 pt-6 pb-6 flex items-center justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto aspect-square w-full max-h-[250px]"
                >
                    <PieChart>
                        <ChartTooltip
                            cursor={false}
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                        <div className="rounded-lg border border-border bg-popover/95 backdrop-blur-xl p-3 shadow-2xl min-w-[140px]">
                                            <div className="flex items-center gap-2.5">
                                                <div className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20" style={{ backgroundColor: data.fill }} />
                                                <span className="text-xs font-semibold text-foreground/85 uppercase tracking-widest">{data.browser}</span>
                                                <span className="ml-auto font-mono text-sm font-bold text-foreground">{data.visitors}</span>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Pie
                            data={chartData}
                            dataKey="visitors"
                            nameKey="browser"
                            stroke="rgba(24,24,27,0.8)" /* zinc-900 border separating slices */
                            strokeWidth={2}
                            isAnimationActive={true}
                            animationDuration={1800}
                            animationEasing="ease-out"
                        />
                    </PieChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}
