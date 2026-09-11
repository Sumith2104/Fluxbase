'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Trash2, Loader2, Zap, Layers, RefreshCw } from 'lucide-react';
import { FluxAiIcon } from '@/components/ui/flux-ai-icon';
import { UniversalChartRenderer } from '@/components/analytics/chart-renderer';
import { ManualBuilder } from '@/components/analytics/manual-builder';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog"
// @ts-ignore
import { Responsive as ResponsiveGridLayout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { SystemMetrics } from '@/components/analytics/system-metrics';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { createWidgetsAction, removeWidgetAction, updateWidgetConfigAction } from './actions';
import { useToast } from "@/hooks/use-toast";

const ResponsiveGrid = ResponsiveGridLayout as any;

export function AsyncWidget({ projectId, widget, onRemove }: { projectId: string, widget: any, onRemove?: (id: string) => void }) {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [forceRefresh, setForceRefresh] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/analytics/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId, query: widget.query, refresh: forceRefresh })
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Failed to fetch data');
                if (isMounted) {
                    setData(json.data || []);
                    setError('');
                }
            } catch (e: any) {
                if (isMounted) setError(e.message);
            } finally {
                if (isMounted) {
                    setLoading(false);
                    setForceRefresh(false);
                }
            }
        };
        fetchData();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, widget.query, refreshTrigger]);

    const handleRefresh = (e: React.MouseEvent) => {
        e.stopPropagation();
        setForceRefresh(true);
        setRefreshTrigger(prev => prev + 1);
    };

    let configObj = widget.config;
    if (typeof configObj === 'string') {
        try { configObj = JSON.parse(configObj); } catch { configObj = {} }
    }

    return (
        <div className="h-full w-full pointer-events-auto">
        <Card className="h-full flex flex-col overflow-hidden relative group">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b border-border/60 bg-secondary/60 cursor-move drag-handle group/header">
                <CardTitle className="text-sm font-medium truncate pr-4 select-none">{widget.title}</CardTitle>
                <div className="flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:bg-secondary hover:text-foreground" 
                        onMouseDown={e => e.stopPropagation()} 
                        onClick={handleRefresh}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    </Button>
                    {onRemove && (
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-muted-foreground hover:bg-destructive/20 hover:text-destructive shrink-0" 
                            onMouseDown={e => e.stopPropagation()} 
                            onClick={() => onRemove(widget.id)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-4 min-h-0 relative">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                )}
                {error ? (
                    <div className="flex h-full items-center justify-center text-rose-500 text-xs text-center px-4 font-mono whitespace-pre-wrap">{error}</div>
                ) : (
                    <UniversalChartRenderer type={widget.chart_type} data={data} config={configObj} />
                )}
            </CardContent>
        </Card>
        </div>
    );
}

export default function AnalyticsDashboardClient({ projectId, initialWidgets }: { projectId: string, initialWidgets: any[] }) {
    const { toast } = useToast();
    const router = useRouter();
    
    const parsedWidgets = initialWidgets.map(w => ({
        ...w,
        configObj: typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {}),
    }));
    const [widgets, setWidgets] = useState(parsedWidgets);
    const [activeTab, setActiveTab] = useState<'performance' | 'system'>('performance');

    useEffect(() => {
        const updatedParsed = initialWidgets.map(w => ({
            ...w,
            configObj: typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {}),
        }));
        setWidgets(updatedParsed);
    }, [initialWidgets]);

    const [aiOpen, setAiOpen] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [suggestionsError, setSuggestionsError] = useState(false);
    const [modelTrigger, setModelTrigger] = useState(0);

    useEffect(() => {
        const handleModelChange = () => {
            setModelTrigger(prev => prev + 1);
        };
        window.addEventListener('flux_ai:model-change', handleModelChange);
        return () => window.removeEventListener('flux_ai:model-change', handleModelChange);
    }, []);

    // Fetch Suggestions whenever modal opens or model changes
    useEffect(() => {
        if (!aiOpen) return;
        
        async function fetchSuggestions() {
            setLoadingSuggestions(true);
            setSuggestionsError(false);
            try {
                const selectedModel = typeof window !== 'undefined' ? localStorage.getItem('flux_ai_selected_model') || '' : '';
                const res = await fetch('/api/analytics/suggestions', {
                    method: 'POST',
                    body: JSON.stringify({ projectId, model: selectedModel }),
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.success) {
                    let s = data.suggestions;
                    if (typeof s === 'string') s = JSON.parse(s);
                    setSuggestions(s || []);
                } else {
                    setSuggestionsError(true);
                }
            } catch {
                setSuggestionsError(true);
            } finally {
                setLoadingSuggestions(false);
            }
        }
        
        fetchSuggestions();
    }, [aiOpen, projectId, modelTrigger]);
    const [aiPrompt, setAiPrompt] = useState('');
    const [generating, setGenerating] = useState(false);

    const handleGenerate = async () => {
        if (!aiPrompt.trim()) return;
        setGenerating(true);
        try {
            const selectedModel = typeof window !== 'undefined' ? localStorage.getItem('flux_ai_selected_model') || '' : '';
            const res = await fetch('/api/analytics/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, prompt: aiPrompt, model: selectedModel })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Generation failed');
            if (!json.widgets || !Array.isArray(json.widgets)) throw new Error('Invalid AI response format');

            const widgetsToSave = json.widgets.map((widget: any) => {
                const safeTitle = widget.title.length > 40 ? widget.title.substring(0, 40) + '...' : widget.title;
                return {
                    title: safeTitle,
                    chartType: widget.chart_type,
                    query: widget.query,
                    config: widget.config
                };
            });

            const savedWidgets = await createWidgetsAction(projectId, widgetsToSave);
            
            const mappedSaved = savedWidgets.map((w, idx) => ({
                ...w,
                configObj: widgetsToSave[idx].config
            }));

            setWidgets(prev => [...prev, ...mappedSaved]);
            
            toast({ title: 'Success', description: `Generated ${json.widgets.length} widget(s) successfully!` });
            setAiOpen(false);
            setAiPrompt('');
        } catch (e: any) {
            toast({ title: 'Generation Failed', description: e.message, variant: 'destructive' });
        } finally {
            setGenerating(false);
        }
    };


    const handleRemove = async (id: string) => {
        try {
            await removeWidgetAction(projectId, id);
            setWidgets(widgets.filter(w => w.id !== id));
        } catch (e: any) {
            toast({ title: 'Failed to delete target', description: e.message, variant: 'destructive' });
        }
    };

    const handleLayoutChange = async (layout: any[]) => {
        for (const l of layout) {
            const widget = widgets.find(w => w.id === l.i);
            if (widget) {
                const currentL = widget.configObj.layout || {};
                 if (currentL.x !== l.x || currentL.y !== l.y || currentL.w !== l.w || currentL.h !== l.h) {
                     const newConfig = { ...widget.configObj, layout: { x: l.x, y: l.y, w: l.w, h: l.h, i: l.i } };
                     updateWidgetConfigAction(projectId, widget.id, newConfig).catch(e => console.error('Save layout failed', e));
                     widget.configObj = newConfig;
                 }
            }
        }
    };

    const layoutMap = widgets.map((w, i) => {
        return w.configObj.layout || { i: w.id, x: (i * 4) % 12, y: Infinity, w: 4, h: 10 };
    });

    return (
        <div className="h-full min-h-screen flex flex-col space-y-6 relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 p-1.5 bg-secondary border border-border rounded-lg w-fit shrink-0">
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className={cn("h-8 text-xs px-4 rounded-md transition-all", activeTab === 'performance' ? "bg-orange-600 text-white hover:bg-orange-500 shadow-lg shadow-orange-950/20" : "text-muted-foreground/75 hover:text-foreground/85")}
                        onClick={() => setActiveTab('performance')}
                    >
                        <Zap className="h-3.5 w-3.5 mr-2" />
                        Performance
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className={cn("h-8 text-xs px-4 rounded-md transition-all", activeTab === 'system' ? "bg-orange-600 text-white hover:bg-orange-500 shadow-lg shadow-orange-950/20" : "text-muted-foreground/75 hover:text-foreground/85")}
                        onClick={() => setActiveTab('system')}
                    >
                        <Layers className="h-3.5 w-3.5 mr-2" />
                        System Health
                    </Button>
                </div>
                
                <div className="flex items-center gap-2">
                    <ManualBuilder 
                        projectId={projectId} 
                        onSaved={(newWidget) => {
                            if (newWidget) {
                                const cfg = typeof newWidget.config === 'string' ? JSON.parse(newWidget.config) : newWidget.config;
                                setWidgets(prev => [...prev, { ...newWidget, configObj: cfg }]);
                            }
                        }} 
                    />
                    <Dialog open={aiOpen} onOpenChange={setAiOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2">
                                <FluxAiIcon size={16} />
                                Ask AI
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[500px] border-border/70 bg-background/95 backdrop-blur-xl">
                            <DialogHeader>
                                <DialogTitle>Generate Analytics Widget</DialogTitle>
                                <DialogDescription>Describe the data you want to see. AI will write the SQL and pick the best chart.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">

                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <FluxAiIcon size={16} />
                                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data-Driven Suggestions</span>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {loadingSuggestions ? (
                                            Array(3).fill(0).map((_, i) => (
                                                <div key={i} className="h-10 border border-border/50 bg-white/5 rounded-lg animate-pulse" />
                                            ))
                                        ) : suggestionsError ? (
                                            <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-sm">
                                                Unable to load schema suggestions.
                                            </div>
                                        ) : (
                                            suggestions.map((s, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => setAiPrompt(s)}
                                                    className="text-left px-4 py-2.5 rounded-lg border border-border bg-secondary/70 hover:bg-muted hover:border-border/80 transition-all text-sm text-foreground/85"
                                                >
                                                    {s}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <Input 
                                    placeholder="e.g. Show me the number of users created per day" 
                                    className="col-span-3 bg-secondary border-border" 
                                    value={aiPrompt}
                                    onChange={e => setAiPrompt(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') handleGenerate() }}
                                />
                            </div>
                            <Button onClick={handleGenerate} disabled={generating || !aiPrompt.trim()} className="w-full bg-orange-500 hover:bg-orange-600 text-white">
                                {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Generating...</> : 'Generate Chart'}
                            </Button>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {activeTab === 'system' ? (
                <SystemMetrics projectId={projectId} />
            ) : (
                <div className="flex-1 flex flex-col min-h-0">
                    {widgets.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-border/70 rounded-lg bg-white/5 min-h-[400px]">
                            <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                                <Sparkles className="w-8 h-8 text-blue-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">No widgets yet</h3>
                            <p className="text-muted-foreground text-sm mb-6 max-w-sm text-center">Your dashboard is empty. Use the Ask AI button or Manual Builder to pin charts here.</p>
                            <Button onClick={() => setAiOpen(true)}>Generate First Chart</Button>
                        </div>
                    ) : (
                        <div 
                            className="flex-1 rounded-lg border border-border/50 bg-background/50 relative pt-4 -mx-6 px-6 overflow-y-auto"
                            style={{ backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
                        >
                            <AutoSizedGrid 
                                layoutMap={layoutMap} 
                                handleLayoutChange={handleLayoutChange} 
                                widgets={widgets} 
                                projectId={projectId} 
                                handleRemove={handleRemove} 
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AutoSizedGrid({ layoutMap, handleLayoutChange, widgets, projectId, handleRemove }: any) {
    const [width, setWidth] = useState(1200);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver(entries => {
            setWidth(entries[0].contentRect.width);
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={ref} className="pb-20 flex-1 w-full">
            <ResponsiveGrid
                className="layout"
                width={width}
                layouts={{ lg: layoutMap }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={30}
                onLayoutChange={handleLayoutChange}
                draggableHandle=".drag-handle"
                compactType="vertical"
                preventCollision={false}
                isResizable={true}
            >
                {widgets.map((widget: any) => (
                    <div key={widget.id}>
                        <AsyncWidget projectId={projectId} widget={widget} onRemove={handleRemove} />
                    </div>
                ))}
            </ResponsiveGrid>
        </div>
    );
}
