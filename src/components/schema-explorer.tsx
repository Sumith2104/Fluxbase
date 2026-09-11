'use client';

import { useState, useEffect } from 'react';
import { Database, Table2, Columns, ChevronRight, ChevronDown, Hash, Folder, FolderOpen, Box, Binary, FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRealtimeSubscription } from '@/hooks/use-realtime-subscription';

interface ColumnDef { name: string; type: string; }
interface IndexDef { name: string; table: string; }
interface SchemaData {
    tables: Record<string, ColumnDef[]>;
    views: string[];
    indexes: IndexDef[];
    functions: string[];
    extensions: string[];
}



export function SchemaExplorer({ projectId, onInsertQuery }: { projectId?: string, onInsertQuery: (query: string) => void }) {
    const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['tables']));
    const queryClient = useQueryClient();

    // Register with the global sync layer to catch CREATE/DROP/ALTER events
    useRealtimeSubscription(projectId);


    const { data: schema, isLoading: loading } = useQuery({
        queryKey: ['schema', projectId],
        queryFn: async () => {
            const res = await fetch(`/api/schema?projectId=${projectId}`);
            const data = await res.json();
            if (!data.success || !data.tables) return null;
            return data as SchemaData;
        },
        enabled: !!projectId,
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const toggleFolder = (folder: string) => {
        const next = new Set(expandedFolders);
        if (next.has(folder)) next.delete(folder);
        else next.add(folder);
        setExpandedFolders(next);
    };

    const toggleTable = (tableName: string) => {
        const next = new Set(expandedTables);
        if (next.has(tableName)) next.delete(tableName);
        else next.add(tableName);
        setExpandedTables(next);
    };

    if (!projectId) {
        return (
            <div className="h-full flex items-center justify-center p-4 text-center">
                <span className="text-xs text-muted-foreground opacity-70">Select a project to view schema</span>
            </div>
        );
    }

    if (loading && !schema) {
        return (
            <div className="flex flex-col h-full overflow-hidden w-full text-sm font-mono">
                <div className="px-3 py-2 border-b border-border/60 bg-background/95 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Database className="h-3.5 w-3.5 text-orange-400" />
                        <span className="font-semibold text-xs tracking-tight">Database Explorer</span>
                    </div>
                </div>
                <div className="p-3 space-y-2.5">
                    <Skeleton className="h-7 w-full rounded" />
                    <div className="space-y-1.5 pt-1">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/40">
                                <Skeleton className="h-3.5 w-24" />
                                <Skeleton className="h-3.5 w-8 rounded" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const tableNames = schema?.tables ? Object.keys(schema.tables) : [];

    return (
        <div className="flex flex-col h-full overflow-y-auto w-full text-sm font-mono pb-8">
            <div className="px-3 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5 text-primary" />
                    <span className="font-semibold text-xs tracking-tight">Database Explorer</span>
                </div>
                {/* Manual refresh button removed in favor of global WebSocket auto-sync */}
            </div>

            <div className="p-2 select-none">

                {/* Tables Folder */}
                <div className="mb-1">
                    <div
                        className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => toggleFolder('tables')}
                    >
                        {expandedFolders.has('tables') ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                        <span className="text-xs font-medium">Tables ({tableNames.length})</span>
                    </div>

                    {expandedFolders.has('tables') && (
                        <div className="pl-4 mt-1 border-l ml-2.5 border-border/40 flex flex-col gap-0.5">
                            {tableNames.length === 0 && !loading && (
                                <span className="text-[10px] text-muted-foreground p-1 italic h-6 flex items-center">No tables found</span>
                            )}

                            {tableNames.map((tableName) => (
                                <div key={tableName}>
                                    <div
                                        className="group flex flex-col rounded hover:bg-muted/40 transition-colors"
                                    >
                                        <div className="flex items-center justify-between p-1 pl-1 cursor-pointer" onClick={() => toggleTable(tableName)}>
                                            <div className="flex items-center gap-1.5 overflow-hidden">
                                                {expandedTables.has(tableName) ?
                                                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/50" /> :
                                                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                                                }
                                                <Table2 className="h-3.5 w-3.5 shrink-0 text-blue-500/80" />
                                                <span className="text-xs truncate" title={tableName}>{tableName}</span>
                                            </div>
                                        </div>

                                        {/* Quick Actions (Hover) */}
                                        <div className="hidden group-hover:flex items-center gap-1 px-5 pb-1.5 pt-0.5">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="h-5 px-1.5 text-[9px] bg-primary/10 hover:bg-primary/20 text-primary border-transparent"
                                                onClick={(e) => { e.stopPropagation(); onInsertQuery(`SELECT * FROM ${tableName} LIMIT 50;`); }}
                                            >
                                                Preview
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="h-5 px-1.5 text-[9px] bg-muted/50 border-transparent"
                                                onClick={(e) => { e.stopPropagation(); onInsertQuery(`SELECT count(*) FROM ${tableName};`); }}
                                            >
                                                Count
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Columns */}
                                    {expandedTables.has(tableName) && (
                                        <div className="pl-5 py-1 border-l ml-2.5 border-border/30 flex flex-col gap-1">
                                            {schema!.tables[tableName].map((col, idx) => (
                                                <div key={idx} className="flex items-center justify-between group/col px-1">
                                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                                        <Columns className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                                                        <span className="text-[10px] truncate text-foreground/80" title={col.name}>{col.name}</span>
                                                    </div>
                                                    <span className="text-[9px] text-muted-foreground/60 font-medium shrink-0 ml-2">{col.type}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Views Folder */}
                <div className="mb-1">
                    <div
                        className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => toggleFolder('views')}
                    >
                        {expandedFolders.has('views') ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                        <span className="text-xs font-medium">Views ({schema?.views?.length || 0})</span>
                    </div>

                    {expandedFolders.has('views') && (
                        <div className="pl-4 mt-1 border-l ml-2.5 border-border/40 flex flex-col gap-0.5">
                            {(schema?.views?.length || 0) === 0 && !loading && (
                                <span className="text-[10px] text-muted-foreground p-1 italic h-6 flex items-center">No views found</span>
                            )}
                            {schema?.views?.map((viewName) => (
                                <div key={viewName} className="group flex flex-col rounded hover:bg-muted/40 transition-colors">
                                    <div className="flex items-center justify-between p-1 pl-1">
                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                            <Table2 className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
                                            <span className="text-xs truncate" title={viewName}>{viewName}</span>
                                        </div>
                                    </div>
                                    <div className="hidden group-hover:flex items-center gap-1 px-5 pb-1.5 pt-0.5">
                                        <Button
                                            variant="secondary" size="sm"
                                            className="h-5 px-1.5 text-[9px] bg-primary/10 hover:bg-primary/20 text-primary border-transparent"
                                            onClick={(e) => { e.stopPropagation(); onInsertQuery(`SELECT * FROM ${viewName} LIMIT 50;`); }}
                                        >
                                            Preview
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Indexes Folder */}
                <div className="mb-1">
                    <div
                        className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => toggleFolder('indexes')}
                    >
                        {expandedFolders.has('indexes') ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                        <span className="text-xs font-medium">Indexes ({schema?.indexes?.length || 0})</span>
                    </div>

                    {expandedFolders.has('indexes') && (
                        <div className="pl-4 mt-1 border-l ml-2.5 border-border/40 flex flex-col gap-0.5">
                            {(schema?.indexes?.length || 0) === 0 && !loading && (
                                <span className="text-[10px] text-muted-foreground p-1 italic h-6 flex items-center">No indexes found</span>
                            )}
                            {schema?.indexes?.map((idxInfo, i) => (
                                <div key={i} className="group flex flex-col rounded hover:bg-muted/40 transition-colors">
                                    <div className="flex items-center justify-between p-1 pl-1">
                                        <div className="flex items-center gap-1.5 overflow-hidden w-full">
                                            <Hash className="h-3 w-3 shrink-0 text-pink-500/80" />
                                            <span className="text-xs truncate w-full" title={`${idxInfo.name} on ${idxInfo.table}`}>
                                                {idxInfo.name} <span className="text-[9px] text-muted-foreground ml-1">on {idxInfo.table}</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Functions Folder */}
                <div className="mb-1">
                    <div
                        className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => toggleFolder('functions')}
                    >
                        {expandedFolders.has('functions') ? <FolderOpen className="h-3.5 w-3.5" /> : <FileCode2 className="h-3.5 w-3.5" />}
                        <span className="text-xs font-medium">Functions ({schema?.functions?.length || 0})</span>
                    </div>

                    {expandedFolders.has('functions') && (
                        <div className="pl-4 mt-1 border-l ml-2.5 border-border/40 flex flex-col gap-0.5">
                            {(schema?.functions?.length || 0) === 0 && !loading && (
                                <span className="text-[10px] text-muted-foreground p-1 italic h-6 flex items-center">No functions found</span>
                            )}
                            {schema?.functions?.map((funcName, i) => (
                                <div key={i} className="group flex flex-col rounded hover:bg-muted/40 transition-colors">
                                    <div className="flex items-center justify-between p-1 pl-1">
                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                            <Binary className="h-3 w-3 shrink-0 text-emerald-500/80" />
                                            <span className="text-xs truncate" title={funcName}>{funcName}()</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Extensions Folder (PG Only) */}
                {(schema?.extensions || []).length > 0 && (
                    <div className="mb-1">
                        <div
                            className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => toggleFolder('extensions')}
                        >
                            {expandedFolders.has('extensions') ? <FolderOpen className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
                            <span className="text-xs font-medium">Extensions ({schema?.extensions?.length || 0})</span>
                        </div>

                        {expandedFolders.has('extensions') && (
                            <div className="pl-4 mt-1 border-l ml-2.5 border-border/40 flex flex-col gap-0.5">
                                {schema?.extensions?.map((extName, i) => (
                                    <div key={i} className="group flex flex-col rounded hover:bg-muted/40 transition-colors">
                                        <div className="flex items-center justify-between p-1 pl-1">
                                            <div className="flex items-center gap-1.5 overflow-hidden">
                                                <Box className="h-3 w-3 shrink-0 text-indigo-500/80" />
                                                <span className="text-xs truncate" title={extName}>{extName}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
}

