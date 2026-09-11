"use client";

import { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, Code, Loader2, ExternalLink, Copy, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { LiquidButton } from "@/components/ui/button";

export interface ApprovalRequestData {
    id: string;
    actionType: 'EXECUTE_SQL' | 'INJECT_SQL' | 'DROP_TABLE' | 'CREATE_PROJECT' | 'MUTATION';
    summary: string;
    payload: string; // The SQL query or payload details
    projectId?: string;
    status?: 'pending' | 'approved' | 'rejected';
}

interface FluxAiApprovalCardProps {
    data: ApprovalRequestData;
    onDecision: (decision: 'approved' | 'rejected', result?: any) => void;
}

export function FluxAiApprovalCard({ data, onDecision }: FluxAiApprovalCardProps) {
    const router = useRouter();
    const [status, setStatus] = useState<'pending' | 'executing' | 'approved' | 'rejected'>(data.status || 'pending');
    const [copied, setCopied] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const isDestructive = /drop|truncate|delete\s+from|alter\s+table.*drop/i.test(data.payload || '') || data.actionType === 'DROP_TABLE';

    const handleCopy = () => {
        if (typeof navigator !== 'undefined' && data.payload) {
            navigator.clipboard.writeText(data.payload);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleApprove = async () => {
        setStatus('executing');
        setErrorMsg(null);
        try {
            const res = await fetch('/api/ai-chat/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    approvalId: data.id,
                    actionType: data.actionType,
                    query: data.payload,
                    projectId: data.projectId,
                    payload: { query: data.payload }
                })
            });

            const result = await res.json();
            if (result.success) {
                setStatus('approved');
                onDecision('approved', result);
            } else {
                setErrorMsg(result.error || 'Execution failed.');
                setStatus('pending');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Network error.');
            setStatus('pending');
        }
    };

    const handleReject = () => {
        setStatus('rejected');
        onDecision('rejected', { reason: 'User explicitly cancelled or rejected the operation.' });
    };

    const handleOpenInEditor = () => {
        try {
            localStorage.setItem('flux_pending_sql_inject', JSON.stringify({
                query: data.payload,
                projectId: data.projectId,
                timestamp: Date.now()
            }));
            window.dispatchEvent(new CustomEvent('flux:inject-sql', { detail: { query: data.payload, projectId: data.projectId } }));
        } catch {}
        const queryPath = `/query${data.projectId ? `?projectId=${data.projectId}` : ''}`;
        router.push(queryPath);
    };

    return (
        <div className="my-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 backdrop-blur-sm overflow-hidden text-xs shadow-md">
            {/* Header */}
            <div className="px-3.5 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldAlert size={15} className={isDestructive ? 'text-red-500 animate-pulse' : 'text-amber-500'} />
                    <span className="font-semibold text-foreground tracking-tight">
                        {isDestructive ? 'Destructive Action Review' : 'Action Approval Required'}
                    </span>
                </div>
                <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] uppercase font-bold tracking-wider ${
                    isDestructive ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                }`}>
                    {data.actionType}
                </span>
            </div>

            {/* Summary & Explanation */}
            <div className="p-3.5 space-y-2.5">
                <p className="text-foreground/90 font-medium leading-relaxed">
                    {data.summary || 'The agent proposed the following operation that requires your confirmation before proceeding:'}
                </p>

                {/* SQL / Payload Preview */}
                {data.payload && (
                    <div className="relative rounded-lg border border-border/80 bg-background/80 overflow-hidden font-mono text-[11px]">
                        <div className="flex items-center justify-between px-3 py-1 bg-muted/60 border-b border-border/60 text-[10px] text-muted-foreground font-semibold">
                            <span className="flex items-center gap-1.5"><Code size={11} /> Proposed SQL Query</span>
                            <button onClick={handleCopy} className="hover:text-foreground flex items-center gap-1 transition-colors" title="Copy SQL">
                                {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                                <span>{copied ? 'Copied' : 'Copy'}</span>
                            </button>
                        </div>
                        <pre className="p-3 overflow-x-auto text-foreground/90 max-h-48 leading-relaxed whitespace-pre-wrap break-words">
                            {data.payload}
                        </pre>
                    </div>
                )}

                {errorMsg && (
                    <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-[11px] flex items-center gap-1.5">
                        <XCircle size={13} className="shrink-0" />
                        <span>{errorMsg}</span>
                    </div>
                )}

                {/* Decision Buttons */}
                {status === 'pending' && (
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                        <LiquidButton
                            onClick={handleApprove}
                            size="sm"
                            className="flex-1 h-8 px-3 text-emerald-400 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            <CheckCircle2 size={13} /> Approve & Run
                        </LiquidButton>
                        <LiquidButton
                            onClick={handleReject}
                            variant="destructive"
                            size="sm"
                            className="h-8 px-3 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            <XCircle size={13} /> Reject
                        </LiquidButton>
                        <LiquidButton
                            onClick={handleOpenInEditor}
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 text-muted-foreground hover:text-foreground font-medium flex items-center justify-center gap-1 cursor-pointer"
                            title="Inspect in Monaco SQL Editor"
                        >
                            <ExternalLink size={12} /> <span className="hidden sm:inline">Editor</span>
                        </LiquidButton>
                    </div>
                )}

                {status === 'executing' && (
                    <div className="py-2.5 px-3 rounded-lg bg-secondary/80 border border-border/80 flex items-center justify-center gap-2 text-foreground font-medium">
                        <Loader2 size={14} className="animate-spin text-primary" />
                        <span>Executing approved operation...</span>
                    </div>
                )}

                {status === 'approved' && (
                    <div className="py-2 px-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-2">
                        <CheckCircle2 size={14} />
                        <span>Approved and executed. Feeding result back to agent...</span>
                    </div>
                )}

                {status === 'rejected' && (
                    <div className="py-2 px-3 rounded-lg bg-secondary border border-border text-muted-foreground font-semibold flex items-center gap-2">
                        <XCircle size={14} className="text-red-400" />
                        <span>Operation rejected by user.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
