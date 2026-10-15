"use client";

import { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, Terminal } from 'lucide-react';
import { McpConnectionRequest, McpGuard } from '@/lib/mcp-guard';

export function McpApprovalModal() {
    const [pendingRequests, setPendingRequests] = useState<McpConnectionRequest[]>([]);

    useEffect(() => {
        const handleMcpRequest = (e: any) => {
            const req = e.detail as McpConnectionRequest;
            setPendingRequests(prev => [...prev.filter(r => r.requestId !== req.requestId), req]);
        };

        const handleMcpResolved = (e: any) => {
            const { requestId } = e.detail;
            setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));
        };

        window.addEventListener('flux:mcp-request', handleMcpRequest);
        window.addEventListener('flux:mcp-resolved', handleMcpResolved);

        return () => {
            window.removeEventListener('flux:mcp-request', handleMcpRequest);
            window.removeEventListener('flux:mcp-resolved', handleMcpResolved);
        };
    }, []);

    const handleDecision = async (requestId: string, decision: 'accept' | 'reject') => {
        McpGuard.resolveRequest(requestId, decision);
        setPendingRequests(prev => prev.filter(r => r.requestId !== requestId));

        try {
            await fetch('/api/mcp/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, decision })
            });
        } catch (e) {
            console.error('[MCP Gate] Error posting decision to server:', e);
        }
    };

    if (pendingRequests.length === 0) return null;

    const currentReq = pendingRequests[0];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-md p-6 rounded-2xl border border-border bg-card shadow-2xl space-y-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                        <ShieldAlert size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-foreground leading-tight">
                            MCP Connection Request
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            An external application wants to connect to Fluxbase
                        </p>
                    </div>
                </div>

                <div className="p-3.5 rounded-xl border border-border/70 bg-muted/40 space-y-2 text-xs">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground font-medium">Application:</span>
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                            <Terminal size={12} className="text-primary" /> {currentReq.appName}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground font-medium">Origin:</span>
                        <span className="font-mono text-muted-foreground">{currentReq.origin}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground font-medium">Requested At:</span>
                        <span className="text-muted-foreground">{new Date(currentReq.requestedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} IST</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                        onClick={() => handleDecision(currentReq.requestId, 'reject')}
                        className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                        <XCircle size={14} /> Reject Access
                    </button>
                    <button
                        onClick={() => handleDecision(currentReq.requestId, 'accept')}
                        className="w-full py-2.5 px-4 text-xs font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                    >
                        <CheckCircle2 size={14} /> Accept Access
                    </button>
                </div>
            </div>
        </div>
    );
}
