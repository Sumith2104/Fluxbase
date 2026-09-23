'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Receipt, 
  Sparkles, 
  Cpu, 
  Coins, 
  RefreshCw, 
  Download, 
  KeyRound, 
  Activity, 
  Eye, 
  Search, 
  Clock, 
  Layers, 
  FileText,
  Calendar,
  Zap,
  TrendingUp,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Film,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle
} from 'lucide-react';
import { 
  getApiBillsAction, 
  type ApiBillsData, 
  type ApiUsageLedgerItem 
} from '@/app/(app)/settings/api-bills-actions';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface ApiBillsManagerProps {
  projectId?: string;
}

export function ApiBillsManager({ projectId }: ApiBillsManagerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<ApiBillsData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModality, setSelectedModality] = useState<string>('all');
  const [currencyMode, setCurrencyMode] = useState<'INR' | 'USD'>('INR');
  const [isLedgerExpanded, setIsLedgerExpanded] = useState(false);

  const fetchData = async (isManualSync = false) => {
    if (isManualSync) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await getApiBillsAction(projectId);
      if (res.success && res.data) {
        setData(res.data);
        if (isManualSync) {
          toast({ title: 'Synced with Ledger', description: 'Real-time API metrics and costs updated.' });
        }
      } else {
        toast({ variant: 'destructive', title: 'Error', description: res.error || 'Failed to load API bills' });
      }
    } catch (e: any) {
      console.error('[ApiBillsManager] Error fetching data:', e);
      toast({ variant: 'destructive', title: 'Network Error', description: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [projectId]);

  // Filter ledger items
  const filteredLedger = useMemo(() => {
    if (!data?.ledger) return [];
    return data.ledger.filter((item) => {
      const matchesSearch = 
        item.modelId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.projectId && item.projectId.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const itemMod = item.modality.toLowerCase();
      const selMod = selectedModality.toLowerCase();
      const matchesModality = 
        selMod === 'all' || 
        itemMod === selMod ||
        (selMod === 'embedding' && (itemMod === 'embeddings' || itemMod === 'embedding')) ||
        (selMod === 'embeddings' && (itemMod === 'embeddings' || itemMod === 'embedding'));

      return matchesSearch && matchesModality;
    });
  }, [data?.ledger, searchQuery, selectedModality]);

  // Export CSV
  const handleExportCsv = () => {
    if (!data?.ledger || data.ledger.length === 0) {
      toast({ title: 'No Data', description: 'No ledger records available to export.' });
      return;
    }

    const headers = ['Request ID', 'Timestamp', 'Model', 'Provider', 'Modality', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Latency (ms)', 'Cost (USD)', 'Cost (INR)', 'Status'];
    const rows = data.ledger.map((item) => [
      item.id,
      item.createdAt,
      item.modelId,
      item.provider,
      item.modality,
      item.inputTokens,
      item.outputTokens,
      item.totalTokens,
      item.latencyMs,
      item.costUsd.toFixed(6),
      item.costInr.toFixed(4),
      item.status
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `fluxbase-api-bill-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: 'Exported CSV', description: 'Usage ledger downloaded successfully.' });
  };

  if (loading && !data) {
    return (
      <Card className="border-border/80 bg-card/40 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-52 mb-1.5" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-4 rounded-xl border border-border/50 bg-secondary/20 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary || {
    totalAiRequests: 0,
    totalDbRequests: 0,
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    totalCostInr: 0,
    activeApiKeys: 0,
    paygUnbilledAmountInr: 0,
    cycleStart: null,
    cycleEnd: null
  };

  const getProviderBadge = (provider: string) => {
    const p = (provider || '').toLowerCase();
    if (p.includes('bedrock') || p.includes('amazon') || p.includes('aws')) {
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] font-mono">BEDROCK</Badge>;
    }
    if (p.includes('glm') || p.includes('zhipu')) {
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-mono">GLM</Badge>;
    }
    if (p.includes('groq')) {
      return <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/20 text-[10px] font-mono">GROQ</Badge>;
    }
    if (p.includes('gemini')) {
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] font-mono">GEMINI</Badge>;
    }
    if (p.includes('openai')) {
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px] font-mono">OPENAI</Badge>;
    }
    return <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px] font-mono">{provider.toUpperCase()}</Badge>;
  };

  const getModalityIcon = (modality: string) => {
    switch (modality) {
      case 'image':
        return <ImageIcon className="h-3.5 w-3.5 text-purple-400" />;
      case 'audio-stt':
      case 'audio-tts':
        return <Mic className="h-3.5 w-3.5 text-amber-400" />;
      case 'video':
        return <Film className="h-3.5 w-3.5 text-pink-400" />;
      case 'embedding':
      case 'embeddings':
        return <Zap className="h-3.5 w-3.5 text-cyan-400" />;
      default:
        return <MessageSquare className="h-3.5 w-3.5 text-blue-400" />;
    }
  };

  return (
    <div className="space-y-6">
      
      {/* ── Header Banner ── */}
      <Card className="border border-border/70 bg-gradient-to-br from-card/90 via-card/50 to-background shadow-xl backdrop-blur-md overflow-hidden">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-inner">
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    API Bills & Usage Ledger
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border-emerald-500/30">
                    Live Verified
                  </Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  100% real-time metered billing for AI inference models, token ingestion, and database API traffic.
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Currency Toggle */}
              <div className="flex items-center bg-secondary/50 rounded-lg p-0.5 border border-border/60 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setCurrencyMode('INR')}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all text-xs font-medium",
                    currencyMode === 'INR' ? "bg-primary text-primary-foreground font-bold shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  ₹ INR
                </button>
                <button
                  type="button"
                  onClick={() => setCurrencyMode('USD')}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all text-xs font-medium",
                    currencyMode === 'USD' ? "bg-primary text-primary-foreground font-bold shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  $ USD
                </button>
              </div>

              {/* Sync Button */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground border-border/60"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin text-primary")} />
                Sync
              </Button>

              {/* Export CSV */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportCsv}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground border-border/60"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">

          {/* ── 1. Real Metric Summary Cards ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            
            {/* AI Cost Card */}
            <div className="p-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-secondary/20 to-transparent relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-primary" />
                  Total AI & Model Cost
                </span>
                <span className="text-[10px] font-mono text-primary/80">Real Meter</span>
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-foreground">
                {currencyMode === 'INR' ? `₹${summary.totalCostInr.toFixed(2)}` : `$${summary.totalCostUsd.toFixed(4)}`}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {currencyMode === 'INR' 
                  ? `Equivalent to $${summary.totalCostUsd.toFixed(4)} USD (@ ₹85/$)` 
                  : `Equivalent to ₹${summary.totalCostInr.toFixed(2)} INR`}
              </p>
            </div>

            {/* Total API Requests Card */}
            <div className="p-4 rounded-xl border border-border/60 bg-secondary/20 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-blue-400" />
                  Total API Calls
                </span>
                <span className="text-[10px] font-mono text-blue-400">All Traffic</span>
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-foreground">
                {summary.totalRequests.toLocaleString()}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {summary.totalAiRequests.toLocaleString()} AI calls • {summary.totalDbRequests.toLocaleString()} DB queries
              </p>
            </div>

            {/* Total Tokens Consumed Card */}
            <div className="p-4 rounded-xl border border-border/60 bg-secondary/20 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-purple-400" />
                  Tokens Ingested
                </span>
                <span className="text-[10px] font-mono text-purple-400">Context</span>
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-foreground">
                {summary.totalTokens.toLocaleString()}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {summary.totalInputTokens.toLocaleString()} prompt / {summary.totalOutputTokens.toLocaleString()} completion
              </p>
            </div>

            {/* Active API Keys & Unbilled PAYG Card */}
            <div className="p-4 rounded-xl border border-border/60 bg-secondary/20 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span className="font-mono uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                  API Keys & PAYG
                </span>
                <span className="text-[10px] font-mono text-amber-400">28-Day Cycle</span>
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-foreground">
                {summary.activeApiKeys} <span className="text-xs font-normal text-muted-foreground font-sans">Keys</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                PAYG Unbilled: <span className="text-foreground font-bold font-mono">₹{summary.paygUnbilledAmountInr.toFixed(2)}</span>
              </p>
            </div>

          </div>

          {/* ── 2. Breakdown Section: Models & Modalities ── */}
          <div className="grid gap-6 lg:grid-cols-2">
            
            {/* Model Breakdown */}
            <div className="p-4 rounded-xl border border-border/60 bg-secondary/10 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Consumption by Model
                </h4>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {data?.modelBreakdown.length || 0} Models Active
                </span>
              </div>

              {(!data?.modelBreakdown || data.modelBreakdown.length === 0) ? (
                <div className="text-center py-8 text-xs text-muted-foreground font-mono">
                  No model usage recorded yet for this workspace.
                </div>
              ) : (
                <div className="space-y-3.5">
                  {data.modelBreakdown.map((item) => (
                    <div key={item.modelId} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{item.label}</span>
                          {getProviderBadge(item.provider)}
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-muted-foreground">{item.requestCount} calls</span>
                          <span className="font-bold text-foreground">
                            {currencyMode === 'INR' ? `₹${item.costInr.toFixed(2)}` : `$${item.costUsd.toFixed(4)}`}
                          </span>
                        </div>
                      </div>
                      <Progress value={item.percentage} className="h-1.5 bg-secondary" />
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                        <span>{item.inputTokens.toLocaleString()} in / {item.outputTokens.toLocaleString()} out</span>
                        <span>{item.percentage}% of cost</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modality Breakdown */}
            <div className="p-4 rounded-xl border border-border/60 bg-secondary/10 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-purple-400" />
                  Consumption by Modality
                </h4>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {data?.modalityBreakdown.length || 0} Modalities
                </span>
              </div>

              {(!data?.modalityBreakdown || data.modalityBreakdown.length === 0) ? (
                <div className="text-center py-8 text-xs text-muted-foreground font-mono">
                  No multimodal requests recorded yet.
                </div>
              ) : (
                <div className="space-y-3.5">
                  {data.modalityBreakdown.map((mod) => (
                    <div key={mod.modality} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          {getModalityIcon(mod.modality)}
                          <span className="font-medium text-foreground uppercase tracking-wider text-[11px]">
                            {mod.modality}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-muted-foreground">{mod.requestCount} reqs</span>
                          <span className="font-bold text-foreground">
                            {currencyMode === 'INR' ? `₹${mod.costInr.toFixed(2)}` : `$${mod.costUsd.toFixed(4)}`}
                          </span>
                        </div>
                      </div>
                      <Progress value={mod.percentage} className="h-1.5 bg-secondary" />
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                        <span>{mod.percentage}% of requests</span>
                        <span>{currencyMode === 'INR' ? `₹${mod.costInr.toFixed(4)}` : `$${mod.costUsd.toFixed(6)}`}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* ── 3. Live Request & Billing Ledger Table (Collapsed by Default) ── */}
          <div className="rounded-xl border border-border/70 bg-secondary/15 p-4 sm:p-5 transition-all">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    Itemized Request & Usage Ledger
                  </h4>
                  <Badge variant="outline" className="text-[10px] font-mono bg-secondary/50 text-muted-foreground border-border/60">
                    {data?.ledger?.length || 0} Records Available
                  </Badge>
                  {!isLedgerExpanded ? (
                    <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                      Collapsed for Speed
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                      Expanded View
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Individual call auditing with exact timestamps, tokens, latencies, and micro-billing calculations.
                </p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsLedgerExpanded(!isLedgerExpanded)}
                  className={cn(
                    "font-mono text-xs h-9 px-3.5 flex items-center gap-2 transition-all cursor-pointer",
                    isLedgerExpanded 
                      ? "border-border/60 bg-secondary/30 text-foreground hover:bg-secondary/50"
                      : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 shadow-sm"
                  )}
                >
                  {isLedgerExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      <span>Collapse Ledger</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 animate-bounce text-primary" />
                      <span>Expand Itemized Ledger</span>
                      <span className="text-[10px] text-amber-400/90 font-mono ml-0.5">(can slowdown speed)</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Collapsed State: Performance Notice and Fast Summary */}
            {!isLedgerExpanded ? (
              <div className="mt-3.5 pt-3.5 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] text-muted-foreground font-mono">
                <div className="flex items-center gap-2 text-muted-foreground/80">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span>
                    Only expand when auditing individual queries. Rendering heavy itemized rows can slowdown page speed.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsLedgerExpanded(true)}
                  className="text-primary hover:underline font-semibold text-left sm:text-right shrink-0 cursor-pointer"
                >
                  Click to Expand Ledger &rarr;
                </button>
              </div>
            ) : (
              /* Expanded State: Controls, Filters & Full Itemized Table */
              <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                {/* Warning Alert Banner */}
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-between gap-2 font-mono">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>Expanded view active ({filteredLedger.length} items rendered). If experiencing UI lag on large datasets, collapse anytime.</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsLedgerExpanded(false)}
                    className="h-6 text-[10px] text-amber-300 hover:text-amber-100 hover:bg-amber-500/20 px-2 cursor-pointer"
                  >
                    Collapse
                  </Button>
                </div>

                {/* Filters & Search */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground font-mono">
                    Filter & Search Itemized Logs:
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative w-48 sm:w-60">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search model, ID, project..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-xs font-mono bg-secondary/30 border-border/60"
                      />
                    </div>

                    <select
                      value={selectedModality}
                      onChange={(e) => setSelectedModality(e.target.value)}
                      className="h-8 px-2 text-xs font-mono rounded-md border border-border/60 bg-secondary/30 text-foreground cursor-pointer"
                    >
                      <option value="all">All Modalities</option>
                      <option value="text">Text / Reasoning</option>
                      <option value="image">Image / Vision</option>
                      <option value="audio-stt">Audio STT</option>
                      <option value="audio-tts">Audio TTS</option>
                      <option value="embedding">Embeddings</option>
                    </select>
                  </div>
                </div>

                {filteredLedger.length === 0 ? (
                  <div className="p-8 rounded-xl border border-dashed border-border/60 text-center bg-secondary/10">
                    <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      {searchQuery || selectedModality !== 'all' 
                        ? 'No API ledger records match the selected search filters.' 
                        : 'No API calls recorded yet in this workspace. Send an in-app AI chat or invoke /api/v1/ endpoints to see real live records.'}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-secondary/10 shadow-sm">
                    <div className="overflow-x-auto max-h-[520px]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-secondary/70 text-muted-foreground border-b border-border/60 font-mono uppercase text-[10px] sticky top-0 backdrop-blur-md z-10">
                          <tr>
                            <th className="p-3">Time</th>
                            <th className="p-3">Model & Provider</th>
                            <th className="p-3">Modality</th>
                            <th className="p-3 text-right">Prompt</th>
                            <th className="p-3 text-right">Completion</th>
                            <th className="p-3 text-right">Total Tokens</th>
                            <th className="p-3 text-right">Latency</th>
                            <th className="p-3 text-right">Cost</th>
                            <th className="p-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                          {filteredLedger.map((item) => (
                            <tr key={item.id} className="hover:bg-secondary/30 transition-colors">
                              <td className="p-3 text-muted-foreground whitespace-nowrap">
                                {new Date(item.createdAt).toLocaleString(undefined, { 
                                  month: 'short', 
                                  day: 'numeric', 
                                  hour: '2-digit', 
                                  minute: '2-digit', 
                                  second: '2-digit' 
                                })}
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground">{item.modelId}</span>
                                  {getProviderBadge(item.provider)}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-1.5 capitalize text-muted-foreground">
                                  {getModalityIcon(item.modality)}
                                  <span>{item.modality}</span>
                                </div>
                              </td>
                              <td className="p-3 text-right text-muted-foreground">
                                {item.inputTokens.toLocaleString()}
                              </td>
                              <td className="p-3 text-right text-muted-foreground">
                                {item.outputTokens.toLocaleString()}
                              </td>
                              <td className="p-3 text-right font-medium text-foreground">
                                {item.totalTokens.toLocaleString()}
                              </td>
                              <td className="p-3 text-right text-muted-foreground">
                                {item.latencyMs}ms
                              </td>
                              <td className="p-3 text-right font-bold text-foreground whitespace-nowrap">
                                {currencyMode === 'INR' 
                                  ? `₹${item.costInr.toFixed(4)}` 
                                  : `$${item.costUsd.toFixed(6)}`}
                              </td>
                              <td className="p-3 text-center">
                                {item.status === 'success' ? (
                                  <Badge variant="outline" className="text-[9px] font-mono text-green-400 bg-green-500/10 border-green-500/20">
                                    OK
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] font-mono text-red-400 bg-red-500/10 border-red-500/20">
                                    {item.status}
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </CardContent>
      </Card>

    </div>
  );
}
