'use client';

import { useState, useContext, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectContext } from '@/contexts/project-context';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWebhooksAction, createWebhookAction, deleteWebhookAction, toggleWebhookAction } from '../actions';
import { type Webhook, type WebhookEvent } from '@/lib/webhooks';
import { CheckCircle2, XCircle, RefreshCw, Webhook as WebhookIcon, Activity, Loader2, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface DeliveryLog {
    id: string;
    webhookId: string;
    webhookName: string;
    event: string;
    url: string;
    statusCode?: number;
    responseMs?: number;
    success: boolean;
    error?: string;
    createdAt: string;
}

export default function WebhooksPage() {
    const { project: selectedProject } = useContext(ProjectContext);
    const { toast } = useToast();
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [logsLoading, setLogsLoading] = useState(false);
    const [retrying, setRetrying] = useState<string | null>(null);

    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [event, setEvent] = useState<WebhookEvent>('*');
    const [tableId, setTableId] = useState('*');
    const [secret, setSecret] = useState('');

    const loadWebhooks = useCallback(async () => {
        if (!selectedProject) return;
        const res = await getWebhooksAction(selectedProject.project_id);
        if (res.success && res.data) setWebhooks(res.data);
    }, [selectedProject]);

    const loadLogs = useCallback(async () => {
        if (!selectedProject) return;
        setLogsLoading(true);
        try {
            const res = await fetch(`/api/webhooks/logs?projectId=${selectedProject.project_id}`);
            const data = await res.json();
            setDeliveryLogs(data.logs || []);
        } catch (e) { console.error(e); }
        finally { setLogsLoading(false); }
    }, [selectedProject]);

    useEffect(() => {
        loadWebhooks();
        loadLogs();
    }, [loadWebhooks, loadLogs]);

    const handleCreate = async () => {
        if (!selectedProject || !name.trim() || !url.trim()) return;
        setLoading(true);
        const res = await createWebhookAction(selectedProject.project_id, name, url, event, tableId, secret);
        setLoading(false);
        if (res.success && res.data) {
            setWebhooks([res.data as unknown as Webhook, ...webhooks]);
            setName(''); setUrl(''); setSecret(''); setEvent('*'); setTableId('*');
            toast({ title: "Webhook created" });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
        }
    };

    const handleToggle = async (id: string, active: boolean) => {
        if (!selectedProject) return;
        const res = await toggleWebhookAction(selectedProject.project_id, id, !active);
        if (res.success) {
            setWebhooks(webhooks.map(w => w.webhook_id === id ? { ...w, is_active: !active } : w));
        }
    };

    const handleDelete = async (id: string) => {
        if (!selectedProject) return;
        const res = await deleteWebhookAction(selectedProject.project_id, id);
        if (res.success) setWebhooks(webhooks.filter(w => w.webhook_id !== id));
    };

    const handleRetry = async (logId: string) => {
        if (!selectedProject) return;
        setRetrying(logId);
        try {
            await fetch('/api/webhooks/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: selectedProject.project_id, logId }),
            });
            loadLogs();
            toast({ title: "Retry queued", description: "The webhook event will be resent shortly." });
        } catch (e) { console.error(e); }
        finally { setRetrying(null); }
    };

    if (!selectedProject) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Webhooks</CardTitle>
                    <CardDescription>Select a project to configure Webhooks.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const successLogs = deliveryLogs.filter(l => l.success);
    const failedLogs = deliveryLogs.filter(l => !l.success);
    const successRate = deliveryLogs.length > 0 ? Math.round((successLogs.length / deliveryLogs.length) * 100) : 100;

    return (
        <div className="space-y-6">
            <Tabs defaultValue="endpoints">
                <TabsList className="bg-secondary border border-border">
                    <TabsTrigger value="endpoints" id="webhooks-endpoints-tab">
                        <WebhookIcon className="h-3.5 w-3.5 mr-1.5" />
                        Endpoints ({webhooks.length})
                    </TabsTrigger>
                    <TabsTrigger value="logs" id="webhooks-logs-tab">
                        <Activity className="h-3.5 w-3.5 mr-1.5" />
                        Delivery History
                        {failedLogs.length > 0 && (
                            <Badge className="ml-1.5 h-4 text-[9px] bg-red-500/20 text-red-400 border-red-500/30">{failedLogs.length} failed</Badge>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* Endpoints Tab */}
                <TabsContent value="endpoints" className="mt-4">
                    <Card className="border-border">
                        <CardHeader>
                            <CardTitle className="text-base">Add Webhook</CardTitle>
                            <CardDescription>Configure real-time HTTP push events for database changes.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Name</Label>
                                    <Input placeholder="Slack notification" value={name} onChange={e => setName(e.target.value)} className="bg-secondary border-border/80 h-9 text-sm" id="webhook-name" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">URL Endpoint</Label>
                                    <Input placeholder="https://hooks.slack.com/..." value={url} onChange={e => setUrl(e.target.value)} className="bg-secondary border-border/80 h-9 text-sm font-mono" id="webhook-url" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Event</Label>
                                    <Select value={event} onValueChange={(e: WebhookEvent) => setEvent(e)}>
                                        <SelectTrigger className="bg-secondary border-border/80 h-9 text-sm" id="webhook-event"><SelectValue /></SelectTrigger>
                                        <SelectContent className="bg-card border-border">
                                            <SelectItem value="*">All Events (*)</SelectItem>
                                            <SelectItem value="row.inserted">row.inserted</SelectItem>
                                            <SelectItem value="row.updated">row.updated</SelectItem>
                                            <SelectItem value="row.deleted">row.deleted</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Table (or * for all)</Label>
                                    <Input placeholder="*" value={tableId} onChange={e => setTableId(e.target.value)} className="bg-secondary border-border/80 h-9 text-sm font-mono" id="webhook-table" />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Signing Secret (optional)</Label>
                                <Input placeholder="Used to verify webhook authenticity" value={secret} onChange={e => setSecret(e.target.value)} className="bg-secondary border-border/80 h-9 text-sm font-mono" id="webhook-secret" />
                            </div>
                            <Button onClick={handleCreate} disabled={loading || !name.trim() || !url.trim()} className="bg-orange-600 hover:bg-orange-500" id="webhook-add">
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <WebhookIcon className="h-4 w-4 mr-2" />}
                                Add Webhook
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Webhook List */}
                    <div className="mt-4 space-y-2">
                        {webhooks.length === 0 ? (
                            <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                                No webhooks configured yet. Add one above.
                            </div>
                        ) : webhooks.map(webhook => (
                            <Card key={webhook.webhook_id} className={cn('border-border', !webhook.is_active && 'opacity-60')}>
                                <CardContent className="flex items-center gap-4 p-4">
                                    <div className={cn('p-2 rounded-md shrink-0', webhook.is_active ? 'bg-emerald-500/10' : 'bg-muted')}>
                                        <WebhookIcon className={cn('h-4 w-4', webhook.is_active ? 'text-emerald-400' : 'text-muted-foreground/75')} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="font-medium text-sm">{webhook.name}</span>
                                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">{webhook.event}</Badge>
                                            <Badge variant="outline" className="text-[10px] h-4 px-1.5">Table: {webhook.table_id}</Badge>
                                        </div>
                                        <code className="text-xs text-muted-foreground font-mono truncate block">{webhook.url}</code>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <Switch checked={webhook.is_active} onCheckedChange={() => handleToggle(webhook.webhook_id, webhook.is_active)} id={`toggle-${webhook.webhook_id}`} />
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-red-400 h-8 text-xs" id={`delete-${webhook.webhook_id}`}>Delete</Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent className="bg-card border-border">
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete Webhook?</AlertDialogTitle>
                                                    <AlertDialogDescription>This will permanently stop all events being sent to <code className="bg-muted px-1 rounded">{webhook.url}</code>.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDelete(webhook.webhook_id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* Delivery History Tab */}
                <TabsContent value="logs" className="mt-4 space-y-4">
                    {/* Stats */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {[
                            { label: 'Total Deliveries', value: deliveryLogs.length, color: 'text-foreground' },
                            { label: 'Success Rate', value: `${successRate}%`, color: successRate === 100 ? 'text-emerald-400' : successRate > 80 ? 'text-yellow-400' : 'text-red-400' },
                            { label: 'Failed', value: failedLogs.length, color: failedLogs.length > 0 ? 'text-red-400' : 'text-emerald-400' },
                        ].map(s => (
                            <Card key={s.label} className="border-border">
                                <CardContent className="pt-4">
                                    <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
                                    <div className="text-xs text-muted-foreground">{s.label}</div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={loadLogs} disabled={logsLoading} className="h-8 text-xs" id="refresh-logs">
                            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', logsLoading && 'animate-spin')} />
                            Refresh
                        </Button>
                    </div>

                    {logsLoading ? (
                        <div className="space-y-2">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                                    <div className="flex items-center gap-3">
                                        <Skeleton className="h-5 w-5 rounded-full" />
                                        <div className="space-y-1">
                                            <Skeleton className="h-4 w-40" />
                                            <Skeleton className="h-3 w-64" />
                                        </div>
                                    </div>
                                    <Skeleton className="h-5 w-16 rounded" />
                                </div>
                            ))}
                        </div>
                    ) : deliveryLogs.length === 0 ? (
                        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                            No delivery history yet. Events will appear here after webhooks fire.
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {deliveryLogs.map(log => (
                                <div key={log.id} className={cn('flex items-start gap-3 p-3 rounded-lg border transition-colors', log.success ? 'border-border bg-secondary/60' : 'border-red-500/20 bg-red-500/5')}>
                                    <div className="shrink-0 mt-0.5">
                                        {log.success
                                            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                            : <XCircle className="h-4 w-4 text-red-400" />
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-sm font-medium">{log.webhookName}</span>
                                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">{log.event}</Badge>
                                            {log.statusCode && (
                                                <Badge variant="outline" className={cn('text-[10px] h-4 px-1.5', log.success ? 'text-emerald-400 border-emerald-500/20' : 'text-red-400 border-red-500/20')}>
                                                    {log.statusCode}
                                                </Badge>
                                            )}
                                            {log.responseMs && <span className="text-[10px] text-muted-foreground/75">{log.responseMs}ms</span>}
                                        </div>
                                        <code className="text-xs text-muted-foreground/75 font-mono truncate block">{log.url}</code>
                                        {log.error && <p className="text-xs text-red-400 mt-0.5">{log.error}</p>}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] text-muted-foreground/55">{new Date(log.createdAt).toLocaleTimeString()}</span>
                                        {!log.success && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                                onClick={() => handleRetry(log.id)} disabled={retrying === log.id} id={`retry-${log.id}`}>
                                                {retrying === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
