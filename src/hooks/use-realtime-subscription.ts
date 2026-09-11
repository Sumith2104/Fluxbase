'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import logger from '@/lib/logger';

// Native SSE-based realtime subscription.
// MODULE-LEVEL SINGLETON: All consumers of this hook share ONE SSE connection per projectId.
// This prevents the thundering herd of N connections when N hooks call useRealtimeSubscription.

export interface RealtimeEvent {
    type: 'live' | 'update' | 'subscribed' | 'error' | 'connected' | 'schema_update' | 'db_event' | 'raw_sql_mutation';
    project_id?: string;
    table?: string;
    table_id?: string;
    table_name?: string;
    operation?: string;
    event_type?: string;
    data?: any;
    timestamp?: string;
    [key: string]: any;
}

// --- Singleton state per projectId ---

type Listener = (event: RealtimeEvent) => void;

interface ConnectionState {
    status: 'idle' | 'connecting' | 'open' | 'closed';
    lastEvent: RealtimeEvent | null;
    listeners: Set<Listener>;
    abortController: AbortController | null;
    retryTimer: ReturnType<typeof setTimeout> | null;
    retryCount: number;
    watchdogTimer: ReturnType<typeof setTimeout> | null;
    useSSEOnly?: boolean;
}

const connections = new Map<string, ConnectionState>();

function getOrCreateState(projectId: string): ConnectionState {
    if (!connections.has(projectId)) {
        connections.set(projectId, {
            status: 'idle',  // 'idle' = not started yet, distinct from 'connecting'
            lastEvent: null,
            listeners: new Set(),
            abortController: null,
            retryTimer: null,
            retryCount: 0,
            watchdogTimer: null,
            useSSEOnly: false,
        });
    }
    return connections.get(projectId)!;
}

function notifyListeners(projectId: string, event: RealtimeEvent) {
    const state = connections.get(projectId);
    if (!state) return;
    state.lastEvent = event;
    state.listeners.forEach(fn => fn(event));
}

function scheduleReconnect(projectId: string) {
    const state = connections.get(projectId);
    if (!state) return;
    if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
    }
    state.status = 'closed';
    state.retryCount += 1;

    // Guaranteed backoff: 2.5s -> 3.75s -> 5.6s ... up to 20s (Never 0ms!)
    const delay = Math.min(2500 * Math.pow(1.5, state.retryCount - 1), 20000);
    logger.info(`[Realtime:${projectId}] Reconnecting in ${Math.round(delay)}ms… (attempt ${state.retryCount})`);
    state.retryTimer = setTimeout(() => {
        if (connections.has(projectId) && connections.get(projectId)!.listeners.size > 0) {
            startConnection(projectId);
        }
    }, delay);
}

function resetWatchdog(projectId: string) {
    const state = connections.get(projectId);
    if (!state) return;

    if (state.watchdogTimer) {
        clearTimeout(state.watchdogTimer);
    }

    // 45s threshold (server pings every 30s)
    state.watchdogTimer = setTimeout(() => {
        logger.warn(`[Realtime:${projectId}] Watchdog timeout — connection stale. Reconnecting…`);
        const s = (state as any).socket;
        if (s) s.close();
    }, 45000);
}

async function startConnection(projectId: string) {
    const state = getOrCreateState(projectId);

    if (state.status === 'connecting' || state.status === 'open') return;

    if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
    }

    state.status = 'connecting';

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (wsUrl && !state.useSSEOnly && typeof window !== 'undefined') {
        let wsOpened = false;
        try {
            const wsTarget = `${wsUrl.replace(/\/$/, '')}?projectId=${projectId}`;
            const ws = new WebSocket(wsTarget);
            (state as any).socket = ws;

            ws.onopen = () => {
                wsOpened = true;
                state.status = 'open';
                state.retryCount = 0;
                logger.info(`[Realtime] WebSocket connected to Render for ${projectId}`);
                resetWatchdog(projectId);

                // Send subscription handshake to Render room system
                try {
                    if (projectId && projectId !== 'global') {
                        ws.send(JSON.stringify({ type: 'subscribe', roomId: `project_${projectId}` }));
                        ws.send(JSON.stringify({ type: 'subscribe', roomId: projectId }));
                    }
                    // Always subscribe to global room to receive project insertions/deletions
                    ws.send(JSON.stringify({ type: 'subscribe', roomId: 'global' }));
                } catch (err) {
                    logger.warn('[Realtime] Failed to send subscribe handshake:', err);
                }
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    resetWatchdog(projectId);
                    if (data.type === 'ping' || data.type === 'connected') return;

                    const payload = data.payload || data;
                    const tableRef = payload.table || payload.table_name || data.table || data.table_name || '';
                    const cleanTable = typeof tableRef === 'string' ? tableRef.split('.').pop() || tableRef : tableRef;
                    const rawAction = payload.action || data.action || payload.operation || data.operation || '';
                    const rawData = payload.record || payload.data || data.record || data.data;

                    const normalized: RealtimeEvent = {
                        ...data,
                        ...payload,
                        type: rawAction ? 'update' : (payload.type || data.type || 'update'),
                        table: cleanTable,
                        action: String(rawAction).toUpperCase(),
                        operation: String(rawAction).toUpperCase(),
                        data: rawData,
                    };

                    if (cleanTable === 'projects') {
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('flux:project-change', { detail: normalized }));
                        }
                    }

                    notifyListeners(projectId, normalized);
                } catch (e) {
                    logger.warn('[Realtime] WS message parse error:', e);
                }
            };

            ws.onclose = () => {
                (state as any).socket = null;
                if (!wsOpened) {
                    state.useSSEOnly = true;
                    logger.warn(`[Realtime] Render WebSocket failed to connect for ${projectId}, staying on SSE...`);
                    connectSSE(projectId, state);
                } else {
                    scheduleReconnect(projectId);
                }
            };

            ws.onerror = () => {
                try { ws.close(); } catch {}
            };
            return;
        } catch (e) {
            state.useSSEOnly = true;
            logger.warn('[Realtime] WebSocket connect failed, staying on SSE:', e);
        }
    }

    await connectSSE(projectId, state);
}

async function connectSSE(projectId: string, state: ConnectionState) {

    const abortController = new AbortController();
    state.abortController = abortController;

    logger.info(`[Realtime] Connecting SSE for project ${projectId}…`);

    try {
        const response = await fetch(`/api/realtime/subscribe?projectId=${projectId}`, {
            signal: abortController.signal,
            headers: { 'Accept': 'text/event-stream' },
            cache: 'no-store',
        });

        if (!response.ok || !response.body) {
            throw new Error(`SSE connect failed: ${response.status}`);
        }

        state.status = 'open';
        state.retryCount = 0;
        logger.info(`[Realtime] SSE connected for ${projectId}`);
        resetWatchdog(projectId);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() ?? '';

            for (const chunk of chunks) {
                if (chunk.startsWith(': ')) {
                    // heartbeat — reset watchdog
                    resetWatchdog(projectId);
                    continue;
                }
                const dataLine = chunk.split('\n').find(l => l.startsWith('data:'));
                if (!dataLine) continue;

                try {
                    const raw = dataLine.slice(5).trim();
                    const data = JSON.parse(raw);
                    resetWatchdog(projectId);

                    if (data.type === 'connected') continue;

                    // Normalize payload from DB trigger format
                    const payload = data.payload || data;
                    const tableRef = payload.table || payload.table_name || data.table || data.table_name || '';
                    const cleanTable = typeof tableRef === 'string' ? tableRef.split('.').pop() || tableRef : tableRef;
                    const rawAction = payload.action || data.action || payload.operation || data.operation || '';
                    const rawData = payload.record || payload.data || data.record || data.data;

                    const normalized: RealtimeEvent = {
                        ...data,
                        ...payload,
                        type: rawAction ? 'update' : (data.type || 'update'),
                        table: cleanTable,
                        action: String(rawAction).toUpperCase(),
                        operation: String(rawAction).toUpperCase(),
                        data: rawData,
                    };

                    if (cleanTable === 'projects') {
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('flux:project-change', { detail: normalized }));
                        }
                    }

                    notifyListeners(projectId, normalized);
                } catch (e) {
                    logger.warn('[Realtime] SSE parse error:', e);
                }
            }
        }
    } catch (err: any) {
        if (err?.name === 'AbortError') {
            logger.info(`[Realtime] SSE intentionally closed for ${projectId}.`);
            return;
        }
        logger.error(`[Realtime] SSE error for ${projectId}:`, err);
    }

    // Connection ended — schedule reconnect if still needed
    state.status = 'closed';
    (state as any).socket = null;
    if (state.watchdogTimer) clearTimeout(state.watchdogTimer);

    if (connections.has(projectId) && connections.get(projectId)!.listeners.size > 0) {
        scheduleReconnect(projectId);
    }
}

function subscribe(projectId: string, listener: Listener): () => void {
    const state = getOrCreateState(projectId);
    state.listeners.add(listener);

    // Start the connection if not yet started or previously closed
    if (state.status === 'idle' || state.status === 'closed') {
        startConnection(projectId);
    }

    return () => {
        const s = connections.get(projectId);
        if (!s) return;
        s.listeners.delete(listener);
        if (s.listeners.size === 0) {
            // Last subscriber left — tear down
            logger.info(`[Realtime] No more subscribers for ${projectId}. Closing.`);
            if (s.retryTimer) clearTimeout(s.retryTimer);
            if (s.abortController) s.abortController.abort();
            connections.delete(projectId);
        }
    };
}

// --- React Hook (thin wrapper around singleton) ---

// Global per-project, per-table debounce timers across all hook instances (prevents duplicate refetches from multiple components)
const globalLastTableRefetch = new Map<string, number>();
const globalTableTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Global per-project schema invalidation debounce timers across all hook instances
const globalLastSchemaInvalidate = new Map<string, number>();
const globalSchemaTimer = new Map<string, ReturnType<typeof setTimeout>>();

export function useRealtimeSubscription(projectId: string | undefined) {
    const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
    const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'closed'>('connecting');
    const queryClient = useQueryClient();
    const projectIdRef = useRef(projectId);
    projectIdRef.current = projectId;

    // --- INSTANT CACHE SYNC LAYER ---
    const syncDatabase = useCallback((event: RealtimeEvent) => {
        if (!projectId) return;

        // 1. Handle Schema Changes (Tables created/dropped/altered)
        if (event.type === 'schema_update' || event.event_type === 'schema_update') {
            const pid = event.project_id || projectId;
            const now = Date.now();
            const lastTime = globalLastSchemaInvalidate.get(pid) || 0;

            // Clear any pending trailing debounce timer
            const existingTimer = globalSchemaTimer.get(pid);
            if (existingTimer) {
                clearTimeout(existingTimer);
                globalSchemaTimer.delete(pid);
            }

            const COOLDOWN_THRESHOLD = 3000; // 3s cooldown between leading-edge schema refetches

            if (now - lastTime >= COOLDOWN_THRESHOLD) {
                // Leading edge: Immediate invalidation for instant UI response (0ms)
                globalLastSchemaInvalidate.set(pid, now);
                logger.info(`[Realtime Sync] Schema changed for ${pid}. Immediate invalidation (leading edge)...`);
                queryClient.invalidateQueries({ queryKey: ['schema', pid] });
            }

            // Trailing edge: Single safety pass at 2500ms for delayed catalog propagation
            const trailingTimer = setTimeout(() => {
                globalSchemaTimer.delete(pid);
                globalLastSchemaInvalidate.set(pid, Date.now());
                logger.info(`[Realtime Sync] Schema changed for ${pid}. Consistency invalidation (trailing edge)...`);
                queryClient.invalidateQueries({ queryKey: ['schema', pid] });
            }, 2500);
            globalSchemaTimer.set(pid, trailingTimer);
            return;
        }

        // 2. Handle Data Changes (Rows deleted/inserted/updated)
        const action = String(event.action || event.operation || '').toUpperCase();
        const isDataMutation = (
            event.type === 'update' ||
            event.type === 'db_event' ||
            event.type === 'raw_sql_mutation' ||
            ['INSERT', 'UPDATE', 'DELETE'].includes(action)
        ) && event.type !== 'connected' && event.type !== 'subscribed';

        if (isDataMutation) {
            const table = event.table;

            const normalizeTable = (name: any) =>
                String(name || '')
                    .toLowerCase()
                    .replace(/['"`]/g, '')
                    .split('.')
                    .pop()
                    ?.trim() || '';

            const targetTable = normalizeTable(table);

            // Projects table mutation -> Trigger project sync across the UI
            if (targetTable === 'projects') {
                logger.info(`[Realtime Sync] Projects list updated (${action}). Dispatching flux:project-change...`);
                queryClient.invalidateQueries({ queryKey: ['projects'] });
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('flux:project-change', { detail: event }));
                }
                return;
            }

            // Telemetry / internal tables should NEVER disrupt business table refetches or trigger UI query invalidation
            if (
                targetTable === 'audit_logs' || 
                targetTable === 'api_keys' || 
                targetTable === 'analytics_rollups' ||
                targetTable.startsWith('_flux_')
            ) {
                return;
            }

            const tableKey = targetTable || '*';
            const timerKey = `${projectId}:${tableKey}`;

            // Check if there are active table-data queries for this project
            const activeQueries = queryClient.getQueryCache().getAll().filter(q => {
                return q.isActive() && q.queryKey[0] === 'table-data' && q.queryKey[1] === projectId;
            });

            // If user is currently viewing a specific table, only process if target matches
            if (activeQueries.length > 0 && targetTable) {
                const matchesAnyActive = activeQueries.some(q => {
                    const qTable = normalizeTable(q.queryKey[2]);
                    return !qTable || qTable === targetTable;
                });
                if (!matchesAnyActive) {
                    return;
                }
            }

            const executeRefetch = () => {
                globalLastTableRefetch.set(timerKey, Date.now());
                const existingTimer = globalTableTimers.get(timerKey);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    globalTableTimers.delete(timerKey);
                }

                // Surgical table refetch
                queryClient.refetchQueries({
                    predicate: (query) => {
                        if (query.queryKey[0] !== 'table-data' || query.queryKey[1] !== projectId) return false;
                        if (targetTable && query.queryKey[2]) {
                            return normalizeTable(query.queryKey[2]) === targetTable;
                        }
                        return true;
                    },
                    type: 'active'
                });

                // Invalidate analytics lazily with a 30s throttle to prevent query storms
                const lastAnalyticsInvalidate = globalLastTableRefetch.get(`${projectId}:__analytics`) || 0;
                if (Date.now() - lastAnalyticsInvalidate > 30000) {
                    globalLastTableRefetch.set(`${projectId}:__analytics`, Date.now());
                    queryClient.invalidateQueries({ queryKey: ['analytics_stats', projectId] });
                    queryClient.invalidateQueries({ queryKey: ['dashboard-analytics', projectId] });
                }
            };

            const now = Date.now();
            const lastRefetchTime = globalLastTableRefetch.get(timerKey) || 0;
            const elapsed = now - lastRefetchTime;
            const BURST_WINDOW = 3500; // 3.5s batch window for streaming bot bursts to protect DB from connection exhaustion
            const IDLE_THRESHOLD = 3500; // If idle for > 3.5s, show first row instantly

            if (elapsed >= IDLE_THRESHOLD) {
                // First event after an idle period: execute immediately for 0ms instant response!
                executeRefetch();
            } else {
                // If mutations arrive in a rapid burst, debounce the trailing edge
                if (!globalTableTimers.has(timerKey)) {
                    const timer = setTimeout(() => {
                        globalTableTimers.delete(timerKey);
                        executeRefetch();
                    }, BURST_WINDOW);
                    globalTableTimers.set(timerKey, timer);
                }
            }
        }
    }, [projectId, queryClient]);

    useEffect(() => {
        if (!projectId) return;

        const listener: Listener = (event) => {
            // 1. Update UI-facing state (Batched by React)
            setLastEvent(event);

            // 2. Trigger Database Sync (Instant, Event-driven)
            syncDatabase(event);
        };

        const unsubscribe = subscribe(projectId, listener);

        // Client-side local custom event listener fallback (handles local/serverless disconnections)
        const handleLocalSchemaChange = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.projectId === projectId) {
                logger.info(`[Realtime Sync] Local schema change event received. Triggering sync...`);
                syncDatabase({ type: 'schema_update', project_id: projectId });
            }
        };

        window.addEventListener('flux:schema-change', handleLocalSchemaChange);

        const handleLocalProjectChange = (e: Event) => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
        };
        window.addEventListener('flux:project-change', handleLocalProjectChange);

        // Sync status from singleton
        const state = connections.get(projectId);
        if (state) setStatus(state.status);

        // Poll status so UI indicator stays correct (light-weight, 1-per-hook not 1-per-project)
        const statusInterval = setInterval(() => {
            const s = connections.get(projectId);
            setStatus(s ? s.status : 'closed');
        }, 2000);

        return () => {
            unsubscribe();
            window.removeEventListener('flux:schema-change', handleLocalSchemaChange);
            window.removeEventListener('flux:project-change', handleLocalProjectChange);
            clearInterval(statusInterval);
        };
    }, [projectId, syncDatabase]);

    const sendMessage = () => {
        logger.warn('[Realtime] sendMessage is a no-op in SSE mode.');
    };

    return {
        status,
        lastEvent,
        events: lastEvent ? [lastEvent] : [],
        sendMessage,
        isConnected: status === 'open',
    };
}
