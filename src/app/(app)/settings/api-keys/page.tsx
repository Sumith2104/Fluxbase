'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { createApiKeyAction, getApiKeysAction, revokeApiKeyAction, getProjectsAction } from '../api-key-actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Key, Shield, ShieldAlert, ShieldCheck, Bot, Copy, Loader2, Globe, Lock, Clock, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const SCOPES = [
    { id: 'read', label: 'Read Access', description: 'Can only execute SELECT queries', icon: ShieldCheck },
    { id: 'write', label: 'Write Access', description: 'Can execute INSERT, UPDATE, DELETE', icon: Shield },
    { id: 'ai', label: 'AI Gateway Access', description: 'Access to Flux AI chat & completions', icon: Bot },
    { id: 'admin', label: 'Admin Access', description: 'Full access to schema and settings', icon: ShieldAlert },
];

export default function ApiKeysPage() {
    const { toast } = useToast();
    const [keys, setKeys] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [keyName, setKeyName] = useState('');
    const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);
    const [projects, setProjects] = useState<{ project_id: string, display_name: string }[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('global');

    useEffect(() => {
        getApiKeysAction().then(res => { if (res.success && res.data) setKeys(res.data); });
        getProjectsAction().then(res => { if (res.success && res.data) setProjects(res.data); });
    }, []);

    const handleCreateKey = async () => {
        if (!keyName.trim()) return;
        setLoading(true);
        const projectId = selectedProjectId === 'global' ? undefined : selectedProjectId;
        const res = await createApiKeyAction(keyName, projectId, selectedScopes);
        setLoading(false);

        if (res.success && res.data) {
            setNewKey(res.data.key);
            setKeys([res.data.apiKeyData, ...keys]);
            setKeyName('');
            toast({ title: "API Key Generated" });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
        }
    };

    const handleRevokeKey = async (id: string) => {
        const res = await revokeApiKeyAction(id);
        if (res.success) {
            setKeys(keys.filter(k => k.id !== id));
            toast({ title: "Key Revoked" });
        }
    };

    const toggleScope = (id: string) => {
        setSelectedScopes(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
    };

    return (
        <div className="space-y-6">
            <Card className="border-border bg-card/80">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-orange-400" />
                        API Access Keys
                    </CardTitle>
                    <CardDescription>Manage keys for programmatic access with granular scopes.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-6">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Key Name</Label>
                                <Input placeholder="Production Worker" value={keyName} onChange={e => setKeyName(e.target.value)} className="bg-secondary border-border/80 h-10" />
                            </div>
                            <div className="space-y-2">
                                <Label>Project Scope</Label>
                                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                                    <SelectTrigger className="bg-secondary border-border/80 h-10"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-card border-border">
                                        <SelectItem value="global">Global (Full Workspace)</SelectItem>
                                        {projects.map(p => <SelectItem key={p.project_id} value={p.project_id}>{p.display_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Permissions (Scopes)</Label>
                            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                                {SCOPES.map(scope => (
                                    <div key={scope.id} 
                                        className={cn(
                                            "flex flex-col gap-2 p-3 rounded-lg border transition-all cursor-pointer group hover:bg-secondary",
                                            selectedScopes.includes(scope.id) ? "border-orange-500/50 bg-orange-500/5" : "border-border bg-secondary/50"
                                        )}
                                        onClick={() => toggleScope(scope.id)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <scope.icon className={cn("h-4 w-4", selectedScopes.includes(scope.id) ? "text-orange-400" : "text-muted-foreground")} />
                                            <Checkbox checked={selectedScopes.includes(scope.id)} className="border-border/80 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium">{scope.label}</div>
                                            <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{scope.description}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Button onClick={handleCreateKey} disabled={loading || !keyName.trim() || selectedScopes.length === 0} className="w-full bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-950/20">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
                            Generate API Key
                        </Button>
                    </div>

                    {newKey && (
                        <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-yellow-500 flex items-center gap-1.5"><ShieldAlert className="h-3 w-3" />Secret Key (Save it now!)</span>
                                <Button variant="ghost" size="sm" className="h-7 text-xs text-yellow-500 hover:bg-yellow-500/10"
                                    onClick={() => { navigator.clipboard.writeText(newKey); toast({ title: "Copied!" }); }}>
                                    <Copy className="h-3 w-3 mr-1.5" />Copy
                                </Button>
                            </div>
                            <code className="block p-3 bg-background rounded-lg border border-yellow-500/20 font-mono text-sm break-all text-yellow-200/90 shadow-inner">
                                {newKey}
                            </code>
                            <p className="text-[10px] text-yellow-500/70">Warning: For security, this key won't be shown again. Lose it, and you'll have to generate a new one.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground px-1">Manage Active Keys</h3>
                {keys.length === 0 ? (
                    <div className="p-12 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                        No active API keys found.
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {keys.map(key => (
                            <Card key={key.id} className="border-border bg-card/70 group hover:border-border/80 transition-colors overflow-hidden">
                                <CardContent className="flex items-center gap-4 p-4">
                                    <div className="p-2.5 rounded-lg bg-secondary border border-border shrink-0">
                                        <Lock className="h-4 w-4 text-muted-foreground/75" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-semibold text-sm truncate">{key.name}</span>
                                            <div className="flex items-center gap-1.5">
                                                {key.scopes?.map((s: string) => (
                                                    <Badge key={s} variant="outline" className="text-[9px] h-4 px-1.5 font-bold bg-secondary/70 border-border text-muted-foreground capitalize">
                                                        {s}
                                                    </Badge>
                                                )) || <Badge variant="outline" className="text-[9px]">no-scopes</Badge>}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
                                            <code className="text-muted-foreground/55 bg-secondary/70 px-1.5 py-0.5 rounded font-mono border border-border/60">{key.preview}</code>
                                            <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{key.projectName || 'Global'}</span>
                                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(key.createdAt).toLocaleDateString()}</span>
                                            {key.lastUsedAt ? (
                                                <span className="flex items-center gap-1 text-emerald-500/80"><Clock className="h-3 w-3" />Active {formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}</span>
                                            ) : (
                                                <span className="flex items-center gap-1 opacity-50"><Clock className="h-3 w-3" />Never used</span>
                                            )}
                                        </div>
                                    </div>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-red-400 shrink-0">Revoke</Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent className="bg-card border-border">
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Revoke Key?</AlertDialogTitle>
                                                <AlertDialogDescription>This will instantly block all programmatic requests using <code className="bg-muted px-1 rounded">{key.preview}</code>. This cannot be undone.</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleRevokeKey(key.id)} className="bg-destructive hover:bg-destructive/90">Revoke Access</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
