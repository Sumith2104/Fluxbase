'use client';

import { useGlobalAlert } from '@/components/global-alert-provider';

import { useState, useContext, useEffect, useCallback } from 'react';

import { Play, Trash2, History as HistoryIcon, Sparkles,  ChevronRight,  Table2, ListRestart, Info, Database, AlertCircle, CheckCircle2, TerminalSquare,  MoreHorizontal, FileJson, FileType, Copy as CopyIcon, AlignLeft, Upload } from 'lucide-react';
import { FluxAiIcon } from '@/components/ui/flux-ai-icon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';

const SqlEditorSkeleton = () => (
    <div className="h-full w-full flex bg-background/40 font-mono text-xs min-h-[300px]">
        <div className="w-10 border-r border-border/40 py-3 text-center text-muted-foreground/40 space-y-2 select-none">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <div key={n}>{n}</div>)}
        </div>
        <div className="flex-1 p-4 space-y-2.5">
            <Skeleton className="h-4 w-48 bg-blue-500/15" />
            <Skeleton className="h-4 w-32 bg-blue-500/15" />
            <Skeleton className="h-4 w-64 bg-blue-500/15" />
            <Skeleton className="h-4 w-40 bg-blue-500/15" />
        </div>
    </div>
);

const SqlEditor = dynamic(() => import('@/components/sql-editor').then(mod => mod.SqlEditor), {
    ssr: false,
    loading: () => <SqlEditorSkeleton />,
});
import { QueryResults } from '@/components/query-results';
import { QueryHistory, HistoryItem } from '@/components/query-history';
import { SchemaExplorer } from '@/components/schema-explorer';
import { ProjectContext } from '@/contexts/project-context';
import { useToast } from '@/hooks/use-toast';
import { generateSQLAction } from '@/actions/ai-sql-actions';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useRealtimeSubscription } from '@/hooks/use-realtime-subscription';

export default function QueryPage() {
  

  const [query, setQuery] = useState('SELECT * FROM your_table_name LIMIT 100;');
  const [isQueryLoaded, setIsQueryLoaded] = useState(false);
  const [queryResponse, setQueryResponse] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeResultsTab, setActiveResultsTab] = useState('results');

  // Pagination State
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [executedQuery, setExecutedQuery] = useState('');
  const [isLiveUpdating, setIsLiveUpdating] = useState(false);

  // AI State
  const [aiInput, setAiInput] = useState('');
  const [isGeneratingSQL, setIsGeneratingSQL] = useState(false);
  const [isExecutingAI, setIsExecutingAI] = useState(false);

  const { project } = useContext(ProjectContext);
  const { toast } = useToast();

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile(); // Check right away on mount
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!project?.project_id) {
      setHistory([]);
      return;
    }
    const saved = localStorage.getItem(`queryHistory_${project.project_id}`);
    if (saved) {
      try { setHistory(JSON.parse(saved)); } catch { }
    } else {
      setHistory([]);
    }
  }, [project?.project_id]);

  // Persist Editor Query
  useEffect(() => {
    if (!project?.project_id) {
      setQuery('SELECT * FROM your_table_name LIMIT 100;');
      setIsQueryLoaded(true);
      return;
    }
    setIsQueryLoaded(false);
    const savedQuery = localStorage.getItem(`sqlQuery_${project.project_id}`);
    if (savedQuery !== null) {
      setQuery(savedQuery);
    } else {
      setQuery('SELECT * FROM your_table_name LIMIT 100;');
    }
    setIsQueryLoaded(true);
  }, [project?.project_id]);

  useEffect(() => {
    if (isQueryLoaded && project?.project_id) {
      localStorage.setItem(`sqlQuery_${project.project_id}`, query);
    }
  }, [query, isQueryLoaded, project?.project_id]);

  // Reset query response on project switch to clear stale states
  useEffect(() => {
    setQueryResponse(null);
  }, [project?.project_id]);

  // Listen for SQL injection from Flux AI assistant
  useEffect(() => {
    if (!project?.project_id) return;
    const handler = (e: any) => {
      const { query, projectId } = e.detail || {};
      if (projectId && projectId !== project.project_id) return;
      if (!query) return;
      setQuery(query);
      try { localStorage.setItem(`sqlQuery_${project.project_id}`, query); } catch {}
      setQueryResponse(null);
      toast({ title: "Query loaded", description: "Press Ctrl+Enter to execute." });
    };
    window.addEventListener('flux:inject-sql', handler);

    // Check for pending SQL injection from navigation
    try {
      const pending = localStorage.getItem('flux_pending_sql_inject');
      if (pending) {
        const data = JSON.parse(pending);
        if (data?.projectId === project.project_id && data?.query && Date.now() - (data.timestamp || 0) < 30000) {
          setQuery(data.query);
          localStorage.setItem(`sqlQuery_${project.project_id}`, data.query);
          setQueryResponse(null);
          toast({ title: "Query loaded", description: "Press Ctrl+Enter to execute." });
        }
        localStorage.removeItem('flux_pending_sql_inject');
      }
    } catch {}

    return () => window.removeEventListener('flux:inject-sql', handler);
  }, [project?.project_id, toast]);

  // Sync queries and results executed by Flux AI into the Query Results tab
  useEffect(() => {
    const handleAiSqlExecuted = (e: any) => {
      const detail = e.detail;
      if (detail?.projectId === project?.project_id && detail?.response) {
        if (detail.query && project?.project_id) {
          setQuery(detail.query);
          setExecutedQuery(detail.query);
          try {
            localStorage.setItem(`sqlQuery_${project.project_id}`, detail.query);
          } catch {}
        }
        setQueryResponse(detail.response);
        setActiveResultsTab('results');
        setHasMore(!!detail.response.result?.hasMore);
      }
    };

    if (project?.project_id) {
      try {
        const raw = localStorage.getItem('flux_latest_query_result');
        if (raw) {
          const item = JSON.parse(raw);
          if (item?.projectId === project.project_id && Date.now() - (item.timestamp || 0) < 120000) {
            if (item.query) {
              setQuery(item.query);
              setExecutedQuery(item.query);
            }
            if (item.response) {
              setQueryResponse(item.response);
              setActiveResultsTab('results');
              setHasMore(!!item.response?.result?.hasMore);
            }
          }
        }
      } catch {}
    }

    window.addEventListener('flux:sql-executed' as any, handleAiSqlExecuted);
    return () => window.removeEventListener('flux:sql-executed' as any, handleAiSqlExecuted);
  }, [project?.project_id]);

  const addToHistory = useCallback((queryStr: string, success: boolean) => {
    if (!project?.project_id) return;
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      query: queryStr,
      timestamp: Date.now(),
      success
    };

    setHistory(prev => {
      const newHistory = [newItem, ...prev].slice(0, 50);
      localStorage.setItem(`queryHistory_${project.project_id}`, JSON.stringify(newHistory));
      return newHistory;
    });
  }, [project?.project_id]);


  const { showConfirm } = useGlobalAlert();

  // ...

  const clearHistory = async () => {
    if (!project?.project_id) return;
    const confirmed = await showConfirm('Are you sure you want to clear all query history?', {
      title: 'Clear History',
      variant: 'destructive',
      confirmText: 'Clear History'
    });

    if (confirmed) {
      setHistory([]);
      localStorage.removeItem(`queryHistory_${project.project_id}`);
    }
  };

  const handleRunQuery = useCallback(async (queryOverride?: string | React.MouseEvent) => {

    const queryToExecute = typeof queryOverride === 'string' ? queryOverride : query;

    if (!queryToExecute.trim()) {
      toast({ variant: 'destructive', title: 'Query cannot be empty' });
      return;
    }

    setIsExecuting(true);
    setQueryResponse(null);
    setActiveResultsTab('results');
    setPage(0);
    setHasMore(false);
    setExecutedQuery(queryToExecute);

    try {
      const response = await fetch('/api/execute-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectId: project?.project_id, 
          query: queryToExecute,
          paginate: true,
          page: 0,
          pageSize: 50
        })
      });

      const data = await response.json();
      addToHistory(queryToExecute, data.success);
      setQueryResponse(data);
      if (data.success && data.result) {
        setHasMore(!!data.result.hasMore);
      }

      if (!data.success) {
        setActiveResultsTab('messages');
      } else {
        // Dispatch local event on schema change to refresh explorer immediately
        const uppercaseQuery = queryToExecute.trim().toUpperCase();
        const isSchemaChange = uppercaseQuery.includes('CREATE ') || 
                               uppercaseQuery.includes('DROP ') || 
                               uppercaseQuery.includes('ALTER ') || 
                               uppercaseQuery.includes('RENAME ');
        if (isSchemaChange && project?.project_id && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flux:schema-change', { detail: { projectId: project.project_id } }));
        }
      }

    } catch (e: any) {
      setQueryResponse({
        success: false,
        error: { message: e.message, code: 'NETWORK_ERROR' }
      });
      addToHistory(queryToExecute, false);
      setActiveResultsTab('messages');
    }

    setIsExecuting(false);

  }, [query, project, toast, addToHistory]);

  const handleRowUpdatedInResults = useCallback((rowIndex: number, columnName: string, newValue: any) => {
    setQueryResponse((prev: any) => {
      if (!prev || !prev.result || !prev.result.rows) return prev;
      const updatedRows = [...prev.result.rows];
      if (updatedRows[rowIndex]) {
        updatedRows[rowIndex] = {
          ...updatedRows[rowIndex],
          [columnName]: newValue === '' ? null : newValue
        };
      }
      return {
        ...prev,
        result: {
          ...prev.result,
          rows: updatedRows
        }
      };
    });
  }, []);

  const fetchNextPage = useCallback(async () => {
    if (isFetchingMore || !hasMore || !project?.project_id || !queryResponse?.success) return;

    setIsFetchingMore(true);
    const nextPage = page + 1;

    try {
      const response = await fetch('/api/execute-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.project_id,
          query: executedQuery,
          paginate: true,
          page: nextPage,
          pageSize: 50
        })
      });

      const data = await response.json();
      if (data.success && data.result) {
        setQueryResponse((prev: any) => {
          if (!prev || !prev.result) return prev;
          return {
            ...prev,
            result: {
              ...prev.result,
              rows: [...prev.result.rows, ...(data.result.rows || [])],
              hasMore: !!data.result.hasMore
            },
            executionInfo: {
              ...prev.executionInfo,
              time: data.executionInfo?.time || prev.executionInfo?.time,
              rowCount: prev.result.rows.length + (data.result.rows?.length || 0)
            }
          };
        });
        setPage(nextPage);
        setHasMore(!!data.result.hasMore);
      } else {
        toast({ variant: 'destructive', title: 'Failed to load more rows', description: data.error?.message || 'Unknown error' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to load more rows', description: e.message });
    } finally {
      setIsFetchingMore(false);
    }
  }, [isFetchingMore, hasMore, project?.project_id, queryResponse, page, executedQuery, toast]);

  const { lastEvent } = useRealtimeSubscription(project?.project_id);

  const handleLiveRefresh = useCallback(async () => {
    if (!project?.project_id || !executedQuery || !queryResponse?.success || isExecuting || isLiveUpdating) return;

    const totalPagesToFetch = Math.max(1, page + 1);
    const fetchPageSize = Math.max(50, totalPagesToFetch * 50);

    setIsLiveUpdating(true);
    try {
      const response = await fetch('/api/execute-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.project_id,
          query: executedQuery,
          paginate: true,
          page: 0,
          pageSize: fetchPageSize
        })
      });

      const data = await response.json();
      if (data.success && data.result) {
        setQueryResponse((prev: any) => {
          if (!prev || !prev.result) return data;
          return {
            ...data,
            result: {
              ...data.result,
              rows: data.result.rows || [],
              hasMore: !!data.result.hasMore
            },
            executionInfo: {
              ...data.executionInfo,
              time: data.executionInfo?.time || prev.executionInfo?.time,
              rowCount: data.result.rows?.length || 0
            }
          };
        });
        setHasMore(!!data.result.hasMore);
      }
    } catch (err) {
      console.warn('[Realtime SQL] Silent live refresh error:', err);
    } finally {
      setIsLiveUpdating(false);
    }
  }, [project?.project_id, executedQuery, queryResponse, isExecuting, isLiveUpdating, page]);

  // Reactive SQL: Auto-refresh results seamlessly when data in the affected table changes elsewhere
  useEffect(() => {
    const eventType = lastEvent?.type || lastEvent?.event_type;
    if (!lastEvent || (eventType !== 'db_event' && eventType !== 'update' && eventType !== 'live') || !queryResponse?.success) return;

    const affectedTable = (lastEvent as any).payload?.table || lastEvent.table || lastEvent.table_name;
    if (!affectedTable) return;

    const targetQuery = executedQuery || query;
    const isRelevant = new RegExp(`\\b${affectedTable}\\b`, 'i').test(targetQuery);
    const isReadOnly = /^\s*(SELECT|WITH)\b/i.test(targetQuery);

    if (isRelevant && isReadOnly) {
      console.log(`[Realtime SQL] Detected change in '${affectedTable}'. Silently refreshing results without resetting scroll...`);
      handleLiveRefresh();
    }
  }, [lastEvent, executedQuery, query, queryResponse?.success, handleLiveRefresh]);

  const handleGenerateSQL = async () => {
    if (!aiInput.trim()) return;
    if (!project?.project_id) {
      toast({ variant: 'destructive', title: 'Start a project first.' });
      return;
    }

    setIsGeneratingSQL(true);
    try {
      const result = await generateSQLAction(project.project_id, aiInput);

      if (result.success && result.query) {
        setQuery(result.query);
        if (result.isDangerous) {
            toast({ variant: "destructive", title: "Dangerous Query Flagged", description: result.warning || "Please review carefully." });
        } else {
            toast({ title: "Query Generated", description: "Review the query in the editor." });
        }
        setAiInput(''); // Clear input on success
      } else {
        toast({ variant: "destructive", title: "Generation Failed", description: result.error });
      }
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "Failed to connect to AI service." });
    } finally {
      setIsGeneratingSQL(false);
    }
  };

  const handleDirectExecute = async () => {
    if (!aiInput.trim()) return;
    if (!project?.project_id) {
      toast({ variant: 'destructive', title: 'Start a project first.' });
      return;
    }

    setIsExecutingAI(true);
    try {
      const result = await generateSQLAction(project.project_id, aiInput);

      if (result.success && result.query) {
        setQuery(result.query);
        
        if (result.isDangerous) {
            const confirmed = await showConfirm(
                `WARNING: ${result.warning || 'This query modifies or deletes data.'}\n\nDo you want to proceed and execute this query anyway?`, 
                {
                    title: 'Dangerous Query Flagged',
                    confirmText: 'Execute Anyway',
                    variant: 'destructive'
                }
            );
            if (!confirmed) {
                toast({ title: "Execution Cancelled", description: "The query was populated in the editor but not executed." });
                setAiInput('');
                return;
            }
        }

        toast({ title: "Query Generated & Executed", description: "Executing query..." });
        setAiInput('');
        // Execute immediately with the new query
        handleRunQuery(result.query);
      } else {
        toast({ variant: "destructive", title: "Generation Failed", description: result.error });
      }
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "Failed to connect to AI service." });
    } finally {
      setIsExecutingAI(false);
    }
  };

  useKeyboardShortcuts([
    {
      combination: { key: 'enter', ctrl: true },
      handler: () => handleRunQuery(),
      description: 'Run SQL Query'
    },
    {
      combination: { key: 'i', ctrl: true, shift: true },
      handler: () => formatSql(),
      description: 'Format SQL'
    }
  ], !isExecuting);

  const formatSql = () => {
    // Basic regex-based SQL formatter
    const formatted = query
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s*\(\s*/g, ' (')
      .replace(/\s*\)\s*/g, ') ')
      .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|INSERT|UPDATE|DELETE|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|UNION|VALUES|SET|AND|OR)\b/gi, (match) => `\n${match.toUpperCase()}`)
      .trim();
    setQuery(formatted);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(query);
    toast({ title: "Copied", description: "Query copied to clipboard." });
  };

  const exportData = (type: 'json' | 'csv') => {
    if (!queryResponse?.result?.rows || !Array.isArray(queryResponse.result.rows)) return;

    let content = '';
    let fileName = `query_export_${Date.now()}`;
    let mimeType = '';

    if (type === 'json') {
      content = JSON.stringify(queryResponse.result.rows, null, 2);
      fileName += '.json';
      mimeType = 'application/json';
    } else {
      const rows = queryResponse.result.rows;
      if (rows.length === 0) return;
      const headers = queryResponse.result.columns || Object.keys(rows[0]);
      content = [
        headers.join(','),
        ...rows.map((row: Record<string, any>) => headers.map(h => {
          const val = row[h];
          return val === null || val === undefined ? '' : typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : String(val);
        }).join(','))
      ].join('\n');
      fileName += '.csv';
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isMobile) {
    return (
      <div key={project?.project_id || 'no-project'} className="min-h-[calc(100dvh-57px)] w-full overflow-x-hidden bg-background p-2 pb-24">
        <Tabs defaultValue="editor" className="flex min-h-[calc(100dvh-73px)] flex-col gap-2">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-lg bg-secondary/60 p-1">
            <TabsTrigger value="schema" className="h-9 px-1 text-[11px]">Schema</TabsTrigger>
            <TabsTrigger value="editor" className="h-9 px-1 text-[11px]">Editor</TabsTrigger>
            <TabsTrigger value="assist" className="h-9 px-1 text-[11px]">Assist</TabsTrigger>
            <TabsTrigger value="results" className="h-9 px-1 text-[11px]">Results</TabsTrigger>
          </TabsList>

          <TabsContent value="schema" className="m-0 min-h-0 flex-1 overflow-hidden rounded-lg bg-card">
            <div className="h-[calc(100dvh-145px)] overflow-hidden">
              <SchemaExplorer key={project?.project_id || 'no-project'} projectId={project?.project_id} onInsertQuery={setQuery} />
            </div>
          </TabsContent>

          <TabsContent value="editor" className="m-0 min-h-0 flex-1 overflow-hidden rounded-lg bg-card">
            <div className="h-[calc(100dvh-145px)] overflow-hidden">
              <SqlEditor
                key={project?.project_id || 'no-project'}
                projectId={project?.project_id}
                query={query}
                setQuery={setQuery}
                onRun={handleRunQuery}
                isGenerating={isExecuting}
                results={queryResponse?.result}
              />
            </div>
          </TabsContent>

          <TabsContent value="assist" className="m-0 min-h-0 flex-1 overflow-hidden rounded-lg bg-card">
            <Tabs defaultValue="ai" className="flex h-[calc(100dvh-145px)] min-h-0 flex-col">
              <div className="border-b px-2 py-2">
                <TabsList className="grid h-9 w-full grid-cols-2 bg-secondary/60">
                  <TabsTrigger value="ai" className="text-xs">AI</TabsTrigger>
                  <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="ai" className="m-0 flex-1 p-3 data-[state=active]:flex data-[state=active]:flex-col">
                <Textarea
                  placeholder="Describe your query..."
                  className="min-h-0 flex-1 resize-none"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGenerateSQL}
                    disabled={isGeneratingSQL || isExecutingAI || !aiInput.trim()}
                  >
                    {isGeneratingSQL ? <MoreHorizontal className="mr-2 h-4 w-4 animate-pulse" /> : <FluxAiIcon size={14} className="mr-2" />}
                    Generate
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleDirectExecute}
                    disabled={isGeneratingSQL || isExecutingAI || !aiInput.trim()}
                  >
                    {isExecutingAI ? <MoreHorizontal className="mr-2 h-4 w-4 animate-pulse" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                    Execute
                  </Button>
                </div>
                <p className="mt-3 text-center text-[10px] text-muted-foreground">
                  AI can make mistakes. Review generated SQL before running.
                </p>
              </TabsContent>

              <TabsContent value="history" className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col">
                <div className="flex items-center justify-between border-b p-2">
                  <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">Recent Queries</h3>
                  {history.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-7 text-[10px] text-destructive" onClick={clearHistory}>
                      <Trash2 className="mr-1 h-3 w-3" /> Clear
                    </Button>
                  )}
                </div>
                <div className="min-h-0 flex-1 p-2">
                  <QueryHistory history={history} onSelectQuery={setQuery} />
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="results" className="m-0 min-h-0 flex-1 overflow-hidden rounded-lg bg-card">
            <Tabs value={activeResultsTab} onValueChange={setActiveResultsTab} className="flex h-[calc(100dvh-145px)] min-h-0 flex-col">
              <div className="border-b px-2 py-2">
                <TabsList className="grid h-9 w-full grid-cols-3 bg-secondary/60">
                  <TabsTrigger value="results" className="text-xs">Results</TabsTrigger>
                  <TabsTrigger value="explanation" className="text-xs">Plan</TabsTrigger>
                  <TabsTrigger value="messages" className="text-xs">Messages</TabsTrigger>
                </TabsList>
              </div>
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <TabsContent value="results" className="absolute inset-0 m-0">
                  {queryResponse?.success ? (
                    <QueryResults 
                      results={queryResponse.result} 
                      error={null} 
                      isGenerating={false} 
                      isLiveUpdating={isLiveUpdating}
                      hasMore={hasMore}
                      isFetchingMore={isFetchingMore}
                      onLoadMore={fetchNextPage}
                      projectId={project?.project_id}
                      onRowUpdatedInResults={handleRowUpdatedInResults}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
                      <Table2 className="mb-3 h-10 w-10 opacity-20" />
                      <p className="text-sm font-medium">Execute a query to view results</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="explanation" className="absolute inset-0 m-0 overflow-auto p-3">
                  {queryResponse?.explanation ? (
                    <div className="rounded-md bg-card text-card-foreground shadow-sm">
                      {queryResponse.explanation.map((line: string, i: number) => (
                        <div key={i} className="flex items-start gap-3 border-b border-border/40 p-2.5 font-mono text-xs last:border-0">
                          <span className="w-6 select-none text-right text-muted-foreground opacity-50">{i + 1}</span>
                          <span className="break-anywhere text-foreground/90">{line}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground opacity-60">
                      <ListRestart className="mb-2 h-8 w-8 opacity-20" />
                      No execution plan available
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="messages" className="absolute inset-0 m-0 overflow-auto p-3">
                  {queryResponse?.error ? (
                    <Alert variant="destructive" className="border-red-900/50 bg-red-900/10 text-red-500 shadow-sm">
                      <AlertCircle className="h-5 w-5" />
                      <AlertTitle className="font-mono text-sm font-bold">Execution Failed</AlertTitle>
                      <AlertDescription className="mt-3">
                        <div className="break-anywhere rounded border border-red-900/30 bg-red-950/30 p-3 font-mono text-sm">
                          {queryResponse.error.message}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-sm text-muted-foreground opacity-60">
                      <TerminalSquare className="mb-2 h-8 w-8 opacity-20" />
                      No active messages
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div key={project?.project_id || 'no-project'} className="h-[calc(100vh-57px)] w-full p-2 bg-background">
      <ResizablePanelGroup
        direction="vertical"
        className="h-full w-full rounded-md border bg-card shadow-sm overflow-hidden"
        key="layout-v1-vertical" // Force re-render if direction changed and wasn't picked up
      >

        {/* === TOP ROW: Editor (Left) | History/AI (Right) === */}
        <ResizablePanel defaultSize={60} minSize={30} className="flex flex-col">
          <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="h-full w-full">

            {/* 1. LEFT SIDEBAR: Schema Explorer */}
            <ResizablePanel defaultSize={20} minSize={15} className="flex flex-col border-r bg-muted/5 min-w-[200px]">
              <SchemaExplorer key={project?.project_id || 'no-project'} projectId={project?.project_id} onInsertQuery={setQuery} />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* 2. MAIN: SQL Editor */}
            <ResizablePanel defaultSize={55} minSize={30} className="flex flex-col border-r bg-muted/5">
              <div className="h-10 flex items-center justify-between px-3 border-b bg-muted/20 shrink-0">
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground/80">{project?.dialect || 'SQL'}</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50 rotate-90" />
                  <span className="text-xs text-muted-foreground font-mono">Editor</span>
                </div>
                {/* Advanced Editor Toolbar */}
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={formatSql} title="Format SQL (Ctrl+Shift+I)">
                    <AlignLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={copyToClipboard} title="Copy to clipboard">
                    <CopyIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Separator orientation="vertical" className="h-4 mx-0.5" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground" disabled={!queryResponse?.success || !Array.isArray(queryResponse?.result?.rows)}>
                        <Upload className="h-3 w-3 rotate-180" /> Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem onClick={() => exportData('csv')} className="text-xs">
                        <FileType className="mr-2 h-3.5 w-3.5 opacity-60" /> CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportData('json')} className="text-xs">
                        <FileJson className="mr-2 h-3.5 w-3.5 opacity-60" /> JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex-grow overflow-hidden relative">
                <SqlEditor
                  key={project?.project_id || 'no-project'}
                  projectId={project?.project_id}
                  query={query}
                  setQuery={setQuery}
                  onRun={handleRunQuery}
                  isGenerating={isExecuting}
                  results={queryResponse?.result}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* 3. RIGHT: History & AI */}
            <ResizablePanel
              defaultSize={30}
              minSize={20}
              className="flex flex-col min-h-0 bg-muted/5 min-w-[250px]"
            >
              <Tabs
                defaultValue="history"
                className="flex flex-col h-full min-h-0"
              >
                {/* Tabs Header */}
                <div className="h-10 border-b flex items-center px-2 shrink-0">
                  <TabsList className="bg-transparent p-0 h-full gap-2">
                    <TabsTrigger value="history" className="h-8 text-xs px-3">
                      <HistoryIcon className="h-3.5 w-3.5 mr-1.5" />
                      History
                    </TabsTrigger>

                    <TabsTrigger value="ai" className="h-8 text-xs px-3">
                      <FluxAiIcon size={14} className="mr-1.5" />
                      AI Assistant
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* HISTORY CONTENT */}
                <TabsContent
                  value="history"
                  className="flex-1 min-h-0 m-0 p-0 data-[state=active]:flex data-[state=active]:flex-col"
                >
                  <div className="flex items-center justify-between p-2 border-b shrink-0">
                    <h3 className="text-xs font-medium px-2 py-1 text-muted-foreground">Recent Queries</h3>
                    {history.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive px-2"
                        onClick={clearHistory}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 p-2">
                    <QueryHistory
                      history={history}
                      onSelectQuery={setQuery}
                    />
                  </div>
                </TabsContent>

                {/* AI CONTENT */}
                <TabsContent
                  value="ai"
                  className="flex-1 min-h-0 p-4"
                >
                  <div className="h-full flex flex-col gap-4">
                    <Textarea
                      placeholder="Describe your query..."
                      className="flex-1 resize-none"
                      value={aiInput}
                      onChange={(e) => setAiInput(e.target.value)}
                    />

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={handleGenerateSQL}
                        disabled={isGeneratingSQL || isExecutingAI || !aiInput.trim()}
                      >
                        {isGeneratingSQL ? <MoreHorizontal className="h-4 w-4 mr-2 animate-pulse" /> : <FluxAiIcon size={14} className="mr-2" />}
                        {isGeneratingSQL ? "Generating..." : "Generate"}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={handleDirectExecute}
                        disabled={isGeneratingSQL || isExecutingAI || !aiInput.trim()}
                      >
                        {isExecutingAI ? <MoreHorizontal className="h-4 w-4 mr-2 animate-pulse" /> : <Play className="h-3.5 w-3.5 mr-2" />}
                        {isExecutingAI ? "Executing..." : "Execute"}
                      </Button>
                    </div>

                    <div className="text-[10px] text-muted-foreground text-center opacity-70">
                      AI can make mistakes. Review the generated query before running.
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </ResizablePanel>


          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* === BOTTOM ROW: Results (Full Width) === */}
        <ResizablePanel defaultSize={40} minSize={20} className="flex flex-col bg-background">
          <Tabs value={activeResultsTab} onValueChange={setActiveResultsTab} className="h-full flex flex-col">
            <div className="flex items-center justify-between px-3 border-b bg-muted/10 shrink-0 h-10">
              <TabsList className="bg-transparent p-0 h-full gap-2">
                <TabsTrigger value="results" className="h-full px-4 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs text-muted-foreground data-[state=active]:text-foreground font-medium">
                  Results
                </TabsTrigger>
                <TabsTrigger value="explanation" className="h-full px-4 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs text-muted-foreground data-[state=active]:text-foreground font-medium">
                  Explanation
                </TabsTrigger>
                <TabsTrigger value="messages" className="h-full px-4 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs text-muted-foreground data-[state=active]:text-foreground font-medium">
                  Messages  {queryResponse?.success === false && <Badge variant="destructive" className="ml-1 h-3.5 w-3.5 p-0 text-[8px] flex items-center justify-center rounded-full">!</Badge>}
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {queryResponse?.executionInfo && (
                  <span className="flex items-center gap-1 font-mono text-[10px] opacity-70">
                    <Info className="h-3 w-3" />
                    {queryResponse.executionInfo.time} / {queryResponse.executionInfo.rowCount} rows
                  </span>
                )}
              </div>
            </div>

            <div className="flex-grow overflow-hidden relative bg-muted/5">
              <TabsContent value="results" className="h-full m-0 p-0 absolute inset-0">
                {queryResponse?.success ? (
                  <QueryResults 
                    results={queryResponse.result} 
                    error={null} 
                    isGenerating={false} 
                    isLiveUpdating={isLiveUpdating}
                    hasMore={hasMore}
                    isFetchingMore={isFetchingMore}
                    onLoadMore={fetchNextPage}
                    projectId={project?.project_id}
                    onRowUpdatedInResults={handleRowUpdatedInResults}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 opacity-40">
                    <Table2 className="h-10 w-10 mb-3 opacity-20" />
                    <p className="text-sm font-medium">Execute a query to view results</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="explanation" className="h-full m-0 p-4 overflow-auto absolute inset-0">
                {queryResponse?.explanation ? (
                  <div className="space-y-4 w-full">
                    <div className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden">
                      {queryResponse.explanation.map((line: string, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-2.5 border-b last:border-0 border-border/40 hover:bg-muted/50 font-mono text-xs">
                          <span className="text-muted-foreground w-6 text-right select-none opacity-50">{i + 1}</span>
                          <span className="text-foreground/90">{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm opacity-60">
                    <ListRestart className="h-8 w-8 mb-2 opacity-20" />
                    No execution plan available
                  </div>
                )}
              </TabsContent>

              <TabsContent value="messages" className="h-full m-0 p-4 overflow-auto absolute inset-0">
                {queryResponse?.error ? (
                  <div className="w-full mt-4">
                    <Alert variant="destructive" className="border-red-900/50 bg-red-900/10 shadow-sm text-red-500">
                      <AlertCircle className="h-5 w-5" />
                      <AlertTitle className="font-mono text-sm font-bold flex items-center gap-2">
                        Execution Failed
                      </AlertTitle>
                      <AlertDescription className="mt-3">
                        <div className="font-mono text-sm p-3 bg-red-950/30 rounded border border-red-900/30">
                          {queryResponse.error.message}
                        </div>
                        {queryResponse.error.hint && (
                          <div className="mt-4 flex gap-2 text-xs opacity-90">
                            <span className="font-bold uppercase tracking-wider shrink-0">Suggestion:</span>
                            <span>{queryResponse.error.hint}</span>
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : queryResponse?.result?.message ? (
                  <Alert className="bg-green-500/10 border-green-500/20 text-emerald-400 w-full mt-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <AlertTitle className="font-medium">Success</AlertTitle>
                    </div>
                    <AlertDescription className="mt-2 font-mono text-sm pl-6 opacity-90">
                      {queryResponse.result.message}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm opacity-60">
                    <TerminalSquare className="h-8 w-8 mb-2 opacity-20" />
                    No active messages
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </ResizablePanel>

      </ResizablePanelGroup>
    </div>
  );
}
