
'use client';

import { useContext, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Edit, Sparkles } from "lucide-react"
import Link from "next/link"
import { getTablesForProject, Table as DbTable, getProjectAnalytics, ProjectAnalytics } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import {
    Table as ShadcnTable,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { QueryTypeChart } from "@/components/query-type-chart";
import { SparklineCard } from "@/components/sparkline-card";
import { ProjectContext } from '@/contexts/project-context';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardPageSkeleton } from '@/components/skeletons/page-skeletons';
import { useRealtimeAnalytics } from '@/hooks/use-realtime-analytics';
import { useProjectHistory } from '@/hooks/use-project-history';
import { getDashboardWidgetsAction } from './analytics-actions';
import { AsyncWidget } from '@/app/(app)/analytics/client';
import { Responsive as ResponsiveGridLayout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGrid = ResponsiveGridLayout as any;

function DashboardCustomWidgetsGrid({ widgets, projectId }: { widgets: any[], projectId: string }) {
    const [width, setWidth] = useState(1200);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver(entries => {
            if (entries[0]) {
                setWidth(entries[0].contentRect.width);
            }
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    const layoutMap = widgets.map((w, i) => {
        const configObj = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
        return configObj.layout || { i: w.id, x: (i * 4) % 12, y: Infinity, w: 4, h: 10 };
    });

    if (width < 768) {
        return (
            <div ref={ref} className="w-full pb-6 space-y-4 flex flex-col">
                {widgets.map((widget: any) => (
                    <div key={widget.id} className="w-full">
                        <AsyncWidget projectId={projectId} widget={widget} />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div ref={ref} className="w-full pb-6">
            <ResponsiveGrid
                className="layout"
                width={width}
                layouts={{ lg: layoutMap }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={30}
                compactType="vertical"
                preventCollision={false}
                isDraggable={false}
                isResizable={false}
            >
                {widgets.map((widget: any) => (
                    <div key={widget.id}>
                        <AsyncWidget projectId={projectId} widget={widget} />
                    </div>
                ))}
            </ResponsiveGrid>
        </div>
    );
}

export default function DashboardPage() {
    const { project: selectedProject } = useContext(ProjectContext);

    // --- Migrated from useState+useEffect to useQuery ---
    // Tables: stale for 60s (structure rarely changes), evicted from heap after 10 min
    const { data: tables = [], isLoading: tablesLoading } = useQuery({
        queryKey: ['tables', selectedProject?.project_id],
        queryFn: () => getTablesForProject(selectedProject!.project_id),
        enabled: !!selectedProject,
        staleTime: 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    // Analytics: stale for 30s, evicted after 5 min
    const { data: analytics = null, isLoading: analyticsLoading } = useQuery<ProjectAnalytics | null>({
        queryKey: ['dashboard-analytics', selectedProject?.project_id],
        queryFn: () => getProjectAnalytics(selectedProject!.project_id),
        enabled: !!selectedProject,
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    // Custom Pinned Widgets
    const { data: widgets = [], isLoading: widgetsLoading } = useQuery({
        queryKey: ['dashboard-widgets', selectedProject?.project_id],
        queryFn: () => getDashboardWidgetsAction(selectedProject!.project_id),
        enabled: !!selectedProject,
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });


    const loading = tablesLoading;

    const realtimeStats = useRealtimeAnalytics(selectedProject?.project_id);
    const historyStats = useProjectHistory(selectedProject?.project_id);

    if (loading) {
        return <DashboardPageSkeleton />;
    }

    if (!selectedProject) {
        // This state should ideally not be reached due to layout redirect
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-lg text-muted-foreground">Please select a project to view the dashboard.</p>
                <Button asChild variant="link">
                    <Link href="/dashboard/projects">Go to Project Selection</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-0">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
            <h1 className="text-2xl font-semibold flex items-center gap-3 tracking-tight">
                    Dashboard
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-500 opacity-30"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-zinc-500"></span>
                    </span>
                </h1>
                <div className="flex items-center gap-3">
                    <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground text-sm">
                        <Link href="/pricing">
                            Upgrade Plan
                        </Link>
                    </Button>
                    <Button asChild>
                        <Link href={`/editor?projectId=${selectedProject.project_id}&newTable=true`}>
                            <Plus className="mr-2 h-4 w-4" />
                            New Table
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="space-y-6">

                {/* 4 Analytics Boxes in One Single Row */}
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                    <SparklineCard
                        title="24h Activity"
                        value={realtimeStats?.total_requests ?? 0}
                        subtitle="Requests (Last 24 Hours)"
                        type="bar"
                        color="#f97316"
                        defaultColor="#3f3f46"
                        data={historyStats.requests}
                    />

                    <SparklineCard
                        title="Total Requests"
                        value={realtimeStats?.all_time_requests ?? realtimeStats?.total_requests ?? 0}
                        subtitle="All-Time Invocations"
                        type="bar"
                        color="#38bdf8"
                        defaultColor="#52525b"
                        data={historyStats.totalHistory || historyStats.requests}
                    />

                    <QueryTypeChart stats={realtimeStats} />

                    <SparklineCard
                        title="Live Sessions"
                        value={realtimeStats?.live_sessions ?? 0}
                        subtitle="Active Connections"
                        type="area"
                        color="#10b981"
                        defaultColor="#52525b"
                        data={historyStats.sessions}
                    />
                </div>







                <Card>
                    <CardHeader>
                        <CardTitle>Tables</CardTitle>
                        <CardDescription>
                            A list of tables in your project.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {tables.length > 0 ? (
                            <div className="border rounded-lg overflow-x-auto">
                                <ShadcnTable>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Rows</TableHead>
                                            <TableHead>Description</TableHead>
                                            <TableHead>Created</TableHead>
                                            <TableHead></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {tables.map((table: DbTable) => {
                                            const tableAnalytics = analytics?.tables?.find(
                                                t => t.name.toLowerCase() === table.table_name.toLowerCase() ||
                                                     t.name.toLowerCase() === table.table_id?.toLowerCase()
                                            );
                                            const rowCount = tableAnalytics?.rows ?? (table as any).rows;
                                            return (
                                                <TableRow key={table.table_id}>
                                                    <TableCell className="font-medium">{table.table_name}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="font-mono text-xs">
                                                            {analyticsLoading && rowCount === undefined ? (
                                                                <span className="inline-block w-8 h-3 bg-muted animate-pulse rounded" />
                                                            ) : typeof rowCount === 'number' ? (
                                                                rowCount.toLocaleString()
                                                            ) : (
                                                                rowCount ?? '0'
                                                            )}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground">{table.description}</TableCell>
                                                    <TableCell>{new Date(table.created_at).toLocaleDateString()}</TableCell>
                                                    <TableCell>
                                                        <Button asChild variant="outline" size="sm">
                                                            <Link href={`/editor?projectId=${selectedProject.project_id}&tableId=${table.table_id}&tableName=${table.table_name}`}>
                                                                <Edit className="mr-2 h-4 w-4" />
                                                                Edit
                                                            </Link>
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </ShadcnTable>
                            </div>
                        ) : (
                            <div className="text-center text-muted-foreground py-10 border-2 border-dashed rounded-lg">
                                <p>No tables yet.</p>
                                <Button variant="link" asChild>
                                    <Link href={`/editor?projectId=${selectedProject.project_id}&newTable=true`}>Create your first table</Link>
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
