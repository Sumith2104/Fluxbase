'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Cpu } from 'lucide-react';

type HealthStatus = 'checking' | 'healthy' | 'degraded' | 'offline';

interface ServiceStatus {
    name: string;
    status: HealthStatus;
    latency?: number;
}

/** Phase 7: Read JS heap usage via Chrome/Edge Performance Memory API. Returns null on unsupported browsers (Firefox, Safari). */
function getHeapMB(): { used: number; total: number } | null {
    if (typeof performance === 'undefined') return null;
    const mem = (performance as any).memory;
    if (!mem) return null;
    return {
        used: Math.round(mem.usedJSHeapSize / 1024 / 1024),
        total: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
    };
}

export function StatusIndicator() {
    const [services, setServices] = useState<ServiceStatus[]>([
        { name: 'Database', status: 'checking' },
        { name: 'Redis', status: 'checking' },
        { name: 'API', status: 'checking' },
    ]);
    const [overall, setOverall] = useState<HealthStatus>('checking');
    const [open, setOpen] = useState(false);
    // Phase 7: Live JS heap memory gauge
    const [heapMB, setHeapMB] = useState<{ used: number; total: number } | null>(null);

    const check = useCallback(async () => {
        try {
            const start = Date.now();
            const res = await fetch('/api/health', { cache: 'no-store' });
            const fetchLatency = Date.now() - start;
            const data = await res.json();

            const dbLatency = (typeof data.dbLatencyMs === 'number' && data.dbLatencyMs >= 0) ? data.dbLatencyMs : fetchLatency;
            const redisLatency = (typeof data.redisLatencyMs === 'number' && data.redisLatencyMs >= 0) ? data.redisLatencyMs : undefined;
            const apiLatency = (typeof data.serverTimeMs === 'number' && data.serverTimeMs >= 0) ? data.serverTimeMs : fetchLatency;

            const dbStatus: HealthStatus = data.database === true ? (dbLatency > 800 ? 'degraded' : 'healthy') : 'offline';
            const redisStatus: HealthStatus = data.redis === true ? 'healthy' : 'degraded';
            const apiStatus: HealthStatus = res.ok ? 'healthy' : 'offline';

            const updated = [
                { name: 'Database', status: dbStatus, latency: dbLatency },
                { name: 'Redis', status: redisStatus, latency: redisLatency },
                { name: 'API', status: apiStatus, latency: apiLatency },
            ];
            setServices(updated);

            const hasOffline = updated.some(s => s.status === 'offline');
            const hasDegraded = updated.some(s => s.status === 'degraded');
            setOverall(hasOffline ? 'offline' : hasDegraded ? 'degraded' : 'healthy');
        } catch {
            setServices(prev => prev.map(s => ({ ...s, status: 'offline' })));
            setOverall('offline');
        }
    }, []);

    useEffect(() => {
        check();
        // Warm-up check after 2s so initial post-boot cold measurement is quickly refreshed
        const warmTimer = setTimeout(check, 2000);
        const interval = setInterval(check, 30000); // re-check services every 30s
        return () => {
            clearTimeout(warmTimer);
            clearInterval(interval);
        };
    }, [check]);

    // Phase 7: Sample JS heap memory every 5 seconds
    useEffect(() => {
        const sample = () => setHeapMB(getHeapMB());
        sample();
        const memInterval = setInterval(sample, 5000);
        return () => clearInterval(memInterval);
    }, []);

    const colors: Record<HealthStatus, string> = {
        checking: 'bg-muted-foreground',
        healthy: 'bg-emerald-500',
        degraded: 'bg-yellow-500',
        offline: 'bg-red-500',
    };

    const labels: Record<HealthStatus, string> = {
        checking: 'Checking...',
        healthy: 'All systems operational',
        degraded: 'Degraded performance',
        offline: 'Service disruption',
    };

    // Memory thresholds relative to the actual JS heap limit (not hardcoded 1GB)
    const memWarning = heapMB && ((heapMB.used / heapMB.total) > 0.8);
    const memPct = heapMB && heapMB.total > 0 ? Math.min(100, Math.round((heapMB.used / heapMB.total) * 100)) : 0;

    return (
        <Popover open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (isOpen) check();
        }}>
            <PopoverTrigger asChild>
                <button
                    id="status-indicator"
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors h-8 focus:outline-none"
                >
                    <span className="relative flex h-2 w-2">
                        {overall === 'healthy' && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                        )}
                        <span className={cn('relative inline-flex rounded-full h-2 w-2', colors[overall])} />
                    </span>
                    {/* Show orange memory warning text when over 80% capacity */}
                    {memWarning ? (
                        <span className="hidden lg:flex items-center gap-1 text-xs text-amber-400 font-medium">
                            <Cpu size={12} /> {heapMB!.used} MB
                        </span>
                    ) : (
                        <span className="hidden lg:block text-xs text-muted-foreground">Status</span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="bottom"
                align="end"
                className="bg-card border-border p-0 overflow-hidden min-w-[230px] shadow-2xl duration-75 animate-in fade-in-0 zoom-in-95"
            >
                <div className="px-3 py-2 border-b border-border">
                    <p className="text-xs font-semibold text-foreground">{labels[overall]}</p>
                </div>
                <div className="p-2 space-y-1">
                    {services.map(svc => (
                        <div key={svc.name} className="flex items-center justify-between px-1 py-0.5">
                            <div className="flex items-center gap-2">
                                <span className={cn('h-1.5 w-1.5 rounded-full', colors[svc.status])} />
                                <span className="text-xs text-foreground/85">{svc.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {svc.latency !== undefined && (
                                    <span className="text-[10px] text-muted-foreground/75 font-mono">{svc.latency}ms</span>
                                )}
                                <span className={cn(
                                    'text-[10px] capitalize font-medium',
                                    svc.status === 'healthy' ? 'text-emerald-400' :
                                    svc.status === 'degraded' ? 'text-yellow-400' :
                                    svc.status === 'offline' ? 'text-red-400' : 'text-muted-foreground/75'
                                )}>
                                    {svc.status}
                                </span>
                            </div>
                        </div>
                    ))}

                    {/* Phase 7: Browser JS Heap Memory Gauge */}
                    <div className="mt-2 pt-2 border-t border-border px-1">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                                <Cpu size={11} /> Browser Memory
                            </span>
                            {heapMB ? (
                                <span className={cn(
                                    'text-[10px] font-mono font-semibold',
                                    memWarning ? 'text-amber-400' : 'text-foreground/85'
                                )}>
                                    {heapMB.used} MB / {(heapMB.total >= 1024) ? (heapMB.total / 1024).toFixed(1) + ' GB' : heapMB.total + ' MB'}
                                </span>
                            ) : (
                                <span className="text-[10px] text-muted-foreground/55">N/A</span>
                            )}
                        </div>
                        {heapMB && (
                            <div className="w-full bg-muted rounded-full h-1.5">
                                <div
                                    className={cn(
                                        'h-1.5 rounded-full transition-all duration-500',
                                        memPct > 80 ? 'bg-red-500' : memPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                                    )}
                                    style={{ width: `${memPct}%` }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
