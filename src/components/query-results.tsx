'use client';

import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Skeleton } from './ui/skeleton';
import { AlertCircle, Table as TableIcon, BarChart3, Code2, LineChart as LineChartIcon, PieChart as PieChartIcon, Loader2, Radio } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Button } from './ui/button';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

import { useToast } from '@/hooks/use-toast';

interface QueryResultsProps {
    results: { rows: any[], columns: string[], tableName?: string | null, primaryKeyColumn?: string | null } | null;
    error: string | null;
    isGenerating: boolean;
    isLiveUpdating?: boolean;
    hasMore?: boolean;
    isFetchingMore?: boolean;
    onLoadMore?: () => void;
    projectId?: string;
    onRowUpdatedInResults?: (rowIndex: number, columnName: string, newValue: any) => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1'];

export function QueryResults({ results, error, isGenerating, isLiveUpdating, hasMore, isFetchingMore, onLoadMore, projectId, onRowUpdatedInResults }: QueryResultsProps) {
    const [view, setView] = useState<'table' | 'chart' | 'json'>('table');
    const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
    const { toast } = useToast();

    // Scroll persistence: preserve scroll position during live updates
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const scrollTopRef = useRef<number>(0);

    // Inline Cell Editing State
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnName: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [updatingCell, setUpdatingCell] = useState<{ rowIndex: number; columnName: string } | null>(null);

    // Primary Key Column Resolution
    const pkColName = useMemo(() => {
        if (!results || !results.columns) return null;
        if (results.primaryKeyColumn) return results.primaryKeyColumn;
        const found = results.columns.find(c => c.toLowerCase() === 'id' || c.toLowerCase().endsWith('_id'));
        return found || 'id';
    }, [results]);

    const actualPkKey = useMemo(() => {
        if (!results || !results.columns || !pkColName) return null;
        return results.columns.find(c => c.toLowerCase() === pkColName.toLowerCase()) || null;
    }, [results, pkColName]);

    const handleCellDoubleClick = (rowIndex: number, colName: string, currentValue: any) => {
        const row = results?.rows[rowIndex];
        if (!results?.tableName) {
            toast({ variant: 'destructive', title: 'Cannot edit', description: 'Table name could not be automatically detected for this query.' });
            return;
        }
        
        if (!row || !actualPkKey || row[actualPkKey] === undefined || row[actualPkKey] === null) {
            toast({ variant: 'destructive', title: 'Cannot edit cell', description: `Output must include the primary key column ('${pkColName}').` });
            return;
        }
        if (colName.toLowerCase() === pkColName?.toLowerCase()) return;

        setEditingCell({ rowIndex, columnName: colName });
        setEditValue(currentValue === null ? '' : String(currentValue));
    };

    const handleSaveCell = async (rowIndex: number, colName: string) => {
        if (!projectId || !results?.tableName) return;
        const row = results.rows[rowIndex];
        
        if (!row || !actualPkKey || row[actualPkKey] === undefined || row[actualPkKey] === null) return;
        const rowId = String(row[actualPkKey]);

        const originalValue = row[colName];
        const stringifiedOriginal = originalValue === null ? '' : String(originalValue);
        if (editValue === stringifiedOriginal) {
            setEditingCell(null);
            return;
        }

        setUpdatingCell({ rowIndex, columnName: colName });
        setEditingCell(null);

        try {
            const { updateTableCellValueAction } = await import('@/app/(app)/editor/actions');
            const res = await updateTableCellValueAction(projectId, results.tableName, rowId, colName, editValue);
            
            if (res.success) {
                toast({ title: 'Success', description: `Cell '${colName}' updated.` });
                if (onRowUpdatedInResults) {
                    onRowUpdatedInResults(rowIndex, colName, editValue);
                }
            } else {
                toast({ variant: 'destructive', title: 'Update Failed', description: res.error || 'Failed to update cell.' });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message || 'An unexpected error occurred.' });
        } finally {
            setUpdatingCell(null);
        }
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        scrollTopRef.current = target.scrollTop;
        if (!onLoadMore || !hasMore || isFetchingMore) return;
        const threshold = 150;
        const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < threshold;
        if (isNearBottom) {
            onLoadMore();
        }
    };

    // Restore scroll position after live background refresh
    useLayoutEffect(() => {
        if (scrollContainerRef.current && scrollTopRef.current > 0) {
            scrollContainerRef.current.scrollTop = scrollTopRef.current;
        }
    }, [results?.rows]);

    const chartDataConfig = useMemo(() => {
        if (!results || !results.rows || results.rows.length === 0) return null;

        const firstRow = results.rows[0];
        let xAxisKey = results.columns[0];
        let yAxisKey = results.columns.find(c => typeof firstRow[c] === 'number') || results.columns[1] || results.columns[0];

        for (const col of results.columns) {
            if (typeof firstRow[col] === 'string' && !xAxisKey) xAxisKey = col;
            if (typeof firstRow[col] === 'number') yAxisKey = col;
        }

        return { xAxisKey, yAxisKey };
    }, [results]);

    if (isGenerating) {
        return (
            <div className="p-4 space-y-3 h-full overflow-hidden font-mono text-xs">
                <div className="grid grid-cols-4 gap-3 pb-2 border-b border-border/60">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-32" />
                </div>
                <div className="space-y-2">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="grid grid-cols-4 gap-3 py-1 items-center">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-2/3" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-4 w-4/5" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 flex flex-col justify-center max-w-3xl mx-auto h-full w-full">
                <div className="rounded-xl border border-red-500/40 bg-card/95 p-4 shadow-lg backdrop-blur-sm">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-border/50">
                        <div className="p-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30">
                            <AlertCircle className="h-4 w-4" />
                        </div>
                        <span className="font-semibold text-sm text-foreground">Execution Failed</span>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30 font-medium">
                            Database Error
                        </span>
                    </div>
                    <div className="mt-3.5 rounded-lg border border-red-500/30 bg-neutral-950 p-3.5 shadow-inner">
                        <p className="font-mono text-xs sm:text-sm text-red-200 selection:bg-red-800 leading-relaxed break-all select-text font-normal">
                            {error}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (results && results.rows) {
        const isEditableTable = Boolean(results.tableName && actualPkKey);

        return (
            <div className="flex flex-col h-full bg-background relative overflow-hidden">
                <div className="flex shrink-0 flex-col gap-2 border-b bg-muted/10 px-2 py-1 sm:flex-row sm:items-center sm:justify-between">
                    <Tabs value={view} onValueChange={(v) => setView(v as any)} className="w-full min-w-0 sm:max-w-[400px]">
                        <TabsList className="h-8 max-w-full gap-1 overflow-x-auto bg-transparent pb-0">
                            <TabsTrigger value="table" className="h-7 text-[11px] data-[state=active]:bg-muted"><TableIcon className="h-3.5 w-3.5 mr-1" /> Table</TabsTrigger>
                            <TabsTrigger value="chart" className="h-7 text-[11px] data-[state=active]:bg-muted"><BarChart3 className="h-3.5 w-3.5 mr-1" /> Chart</TabsTrigger>
                            <TabsTrigger value="json" className="h-7 text-[11px] data-[state=active]:bg-muted"><Code2 className="h-3.5 w-3.5 mr-1" /> JSON</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {view === 'chart' && (
                        <div className="mx-0 flex items-center gap-1 sm:mx-2">
                            <Button variant={chartType === 'bar' ? 'secondary' : 'ghost'} size="sm" className="h-6 w-6 p-0" onClick={() => setChartType('bar')}><BarChart3 className="h-3 w-3" /></Button>
                            <Button variant={chartType === 'line' ? 'secondary' : 'ghost'} size="sm" className="h-6 w-6 p-0" onClick={() => setChartType('line')}><LineChartIcon className="h-3 w-3" /></Button>
                            <Button variant={chartType === 'pie' ? 'secondary' : 'ghost'} size="sm" className="h-6 w-6 p-0" onClick={() => setChartType('pie')}><PieChartIcon className="h-3 w-3" /></Button>
                        </div>
                    )}
                    {view === 'table' && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-[10px] text-muted-foreground/80 bg-muted/20 border px-2 py-0.5 rounded font-medium flex items-center gap-1.5 font-sans">
                                <span className={`h-1.5 w-1.5 rounded-full ${isLiveUpdating ? 'bg-amber-400 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                                <span className="font-semibold text-foreground">{results.tableName || 'Live'}</span>
                                {isLiveUpdating ? (
                                    <span className="text-amber-400 font-medium">Syncing...</span>
                                ) : (
                                    <span className="opacity-60">• Live</span>
                                )}
                            </div>
                            {isEditableTable && results.rows.length > 0 && (
                                <span className="text-[10px] text-muted-foreground/60 hidden md:inline">
                                    Double-click cell to edit
                                </span>
                            )}
                            {hasMore && (
                                <div className="text-[10px] font-medium text-muted-foreground font-sans">
                                    Loaded {results.rows.length} rows
                                </div>
                            )}
                            {!hasMore && results.rows.length > 0 && (
                                <div className="text-[10px] font-medium text-muted-foreground font-sans">
                                    All {results.rows.length.toLocaleString()} rows
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div
                    ref={scrollContainerRef}
                    className="flex-grow relative overflow-auto custom-scrollbar"
                    data-scroll-container="true"
                    style={{ willChange: 'scroll-position', contain: 'paint' }}
                    onScroll={handleScroll}
                >
                    {view === 'table' && (
                        <Table className="relative w-max min-w-full border-collapse border-spacing-0">
                            <TableHeader className="sticky top-0 z-20 shadow-sm">
                                <TableRow className="hover:bg-muted/50 border-b border-border">
                                    {results.columns.map((col, idx) => (
                                        <TableHead
                                            key={`${idx}-${col}`}
                                            className="h-9 px-4 py-2 whitespace-nowrap bg-muted/80 backdrop-blur-sm text-xs font-semibold uppercase tracking-wider text-foreground border-r last:border-r-0 border-border select-none"
                                        >
                                            <div className="flex items-center gap-2">
                                                {col}
                                            </div>
                                        </TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {results.rows.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={results.columns.length || 1} className="h-32 text-center text-muted-foreground">
                                            <div className="flex flex-col items-center justify-center gap-2">
                                                <AlertCircle className="h-8 w-8 text-muted-foreground/50 opacity-50" />
                                                <p className="text-sm font-medium">No results found</p>
                                                <p className="text-xs opacity-70">Query executed successfully, but 0 rows were returned.</p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    results.rows.map((row, rowIndex) => {
                                        const rowHasPk = actualPkKey && row[actualPkKey] !== undefined && row[actualPkKey] !== null;
                                        const canEditRow = isEditableTable && rowHasPk;
                                        const rowKey = rowHasPk ? String(row[actualPkKey]) : `row_${rowIndex}`;

                                        return (
                                            <TableRow key={rowKey} className="border-b border-border/50 hover:bg-muted/30 group h-9">
                                                {results.columns.map((col, colIndex) => {
                                                    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === col;
                                                    const isUpdating = updatingCell?.rowIndex === rowIndex && updatingCell?.columnName === col;
                                                    const isPkCell = pkColName ? col.toLowerCase() === pkColName.toLowerCase() : false;
                                                    const canEditCell = canEditRow && !isPkCell;

                                                    return (
                                                        <TableCell
                                                            key={`${rowKey}-${colIndex}-${col}`}
                                                            className={`relative h-9 p-0 whitespace-nowrap font-mono text-xs border-r border-border/50 last:border-r-0 select-none ${canEditCell ? 'cursor-pointer hover:bg-primary/5' : ''}`}
                                                            onDoubleClick={() => canEditCell && handleCellDoubleClick(rowIndex, col, row[col])}
                                                        >
                                                            {isUpdating ? (
                                                                <div className="w-full h-full flex items-center gap-2 px-4 py-1.5 bg-muted/20">
                                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                                                                    <span className="text-muted-foreground truncate">{editValue}</span>
                                                                </div>
                                                            ) : isEditing ? (
                                                                <input
                                                                    type="text"
                                                                    className="absolute inset-0 w-full h-full px-4 py-1.5 bg-background text-foreground font-mono text-xs border-2 border-primary focus:outline-none focus:ring-0 focus-visible:ring-0 rounded-none shadow-none z-30"
                                                                    value={editValue}
                                                                    onChange={(e) => setEditValue(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') handleSaveCell(rowIndex, col);
                                                                        if (e.key === 'Escape') setEditingCell(null);
                                                                    }}
                                                                    onBlur={() => handleSaveCell(rowIndex, col)}
                                                                    autoFocus
                                                                />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center px-4 py-1.5">
                                                                    {row[col] === null ? (
                                                                        <span className="text-muted-foreground/50 italic text-[10px]">NULL</span>
                                                                    ) : (
                                                                        <span className="text-foreground/90 truncate">{String(row[col])}</span>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </TableCell>
                                                    );
                                                })}
                                            </TableRow>
                                        );
                                    })
                                )}
                                {isFetchingMore && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={results.columns.length || 1} className="h-12 text-center py-3 border-r-0">
                                            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground font-sans">
                                                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading more rows...
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}

                    {view === 'chart' && chartDataConfig && (
                        <div className="h-full w-full p-6 flex flex-col pt-8 pb-12">
                            <ResponsiveContainer width="100%" height="100%">
                                {chartType === 'bar' ? (
                                    <BarChart data={results.rows.slice(0, 500)}>
                                        <XAxis dataKey={chartDataConfig.xAxisKey} tick={{ fontSize: 12, fill: '#888' }} />
                                        <YAxis tick={{ fontSize: 12, fill: '#888' }} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '8px' }} itemStyle={{ color: '#e5e7eb' }} />
                                        <Bar dataKey={chartDataConfig.yAxisKey} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                ) : chartType === 'line' ? (
                                    <LineChart data={results.rows.slice(0, 500)}>
                                        <XAxis dataKey={chartDataConfig.xAxisKey} tick={{ fontSize: 12, fill: '#888' }} />
                                        <YAxis tick={{ fontSize: 12, fill: '#888' }} />
                                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '8px' }} itemStyle={{ color: '#e5e7eb' }} />
                                        <Line type="monotone" dataKey={chartDataConfig.yAxisKey} stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                                    </LineChart>
                                ) : (
                                    <PieChart>
                                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '8px' }} itemStyle={{ color: '#e5e7eb' }} />
                                        <Pie data={results.rows.slice(0, 500)} dataKey={chartDataConfig.yAxisKey} nameKey={chartDataConfig.xAxisKey} cx="50%" cy="50%" outerRadius={120}>
                                            {results.rows.slice(0, 500).map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                )}
                            </ResponsiveContainer>
                        </div>
                    )}

                    {view === 'json' && (
                        <div className="h-full overflow-auto bg-card p-4">
                            <pre className="font-mono text-xs text-green-400">
                                {JSON.stringify(results.rows, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col items-center justify-center bg-muted/50 p-8 text-muted-foreground">
            <div className="w-16 h-16 mb-4 rounded-xl bg-muted/50 flex items-center justify-center border border-dashed border-muted-foreground/30">
                <TableIcon className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="font-medium text-foreground">No Results Detected</p>
            <p className="text-sm mt-1">Execute a query using the editor to view data.</p>
        </div>
    );
}
