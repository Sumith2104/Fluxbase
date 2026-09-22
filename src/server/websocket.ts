import { config } from 'dotenv';
config({ path: '.env.local' });

import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import http from 'http';
import fs from 'fs';
import path from 'path';
import logger from '@/lib/logger';
import { redis } from '@/lib/redis';

let docsContext = '';
try {
    const docsPath = path.join(process.cwd(), 'fluxbase-client', 'INTEGRATION_GUIDE.md');
    if (fs.existsSync(docsPath)) {
        docsContext = fs.readFileSync(docsPath, 'utf-8');
    } else {
        docsContext = "Fluxbase Integration Guide: To upload files, POST to /api/storage/upload with multipart/form-data (bucketId, projectId, file). To execute SQL, POST to /api/execute-sql with JSON { query: '...' }. To listen for realtime changes, connect to /api/realtime/subscribe via SSE.";
    }
} catch (e) {
    logger.warn("Could not load integration guide for WS context", e);
}

function getWsSecret(): Uint8Array { const s = process.env.JWT_SECRET; if (!s || s.trim() === '') throw new Error('JWT_SECRET required'); return new TextEncoder().encode(s); }
const PORT = parseInt(process.env.WS_PORT || '4000', 10);
const wss = new WebSocketServer({ port: PORT });
logger.info(`[WS] Server starting on port ${PORT}...`);
const clients = new Map<string, Set<WebSocket>>();
const userConnectionCounts = new Map<string, number>();

if (!process.env.AWS_RDS_POSTGRES_URL) {
    throw new Error('Missing AWS_RDS_POSTGRES_URL');
}

const pool = new Pool({
    connectionString: process.env.AWS_RDS_POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 300000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
});

pool.on('error', (err: any) => {
    logger.warn('[WS Pool Error handled]:', err?.message || err);
});

// Extended WebSocket interface
interface ExtWebSocket extends WebSocket {
    isAlive?: boolean;
    userId?: string;
}

// Broadcast helper
function broadcastToSubscribers(payload: any) {
    try {
        const cleanProjectId = String(payload.project_id || '').replace(/^project_/, '');
        const cleanTable = String(payload.table || payload.table_name || '').replace(/^.*?\./, '');
        const action = String(payload.action || payload.operation || 'UPDATE').toUpperCase();
        const record = payload.record || payload.data || {};

        const outboundPayload = {
            table: cleanTable,
            project_id: cleanProjectId,
            action: action,
            operation: action,
            record: record,
            data: record,
            ...payload
        };

        const outboundMessage = JSON.stringify({
            type: 'db_event',
            payload: outboundPayload,
            table: cleanTable,
            project_id: cleanProjectId,
            action: action,
            operation: action,
            record: record,
            data: record
        });

        const isGlobal = cleanTable === 'projects' || cleanProjectId === 'global' || !cleanProjectId;

        if (isGlobal) {
            logger.info(`[WS Broadcast] Global event (table: ${cleanTable}, action: ${action}). Notifying all clients...`);
            wss.clients.forEach((ws) => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.send(outboundMessage); } catch {}
                }
            });
            return;
        }

        // Collect subscribers from all matching rooms
        const recipientSockets = new Set<WebSocket>();

        const roomsToCheck = [
            `project_${cleanProjectId}`,
            cleanProjectId,
            `${cleanProjectId}:*`,
            `${cleanProjectId}:${cleanTable}`,
            'global'
        ];

        for (const r of roomsToCheck) {
            const subs = clients.get(r);
            if (subs) {
                for (const ws of subs) {
                    recipientSockets.add(ws);
                }
            }
        }

        if (recipientSockets.size === 0) {
            logger.info(`[WS Broadcast] No active subscribers for ${cleanProjectId}:${cleanTable} (${action})`);
            return;
        }

        logger.info(`[WS Broadcast] Delivering ${action} on ${cleanProjectId}:${cleanTable} to ${recipientSockets.size} subscriber(s)`);
        for (const ws of recipientSockets) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(outboundMessage); } catch (err) {
                    logger.warn('[WS Broadcast] Error sending to socket:', err);
                }
            }
        }
    } catch (err) {
        logger.error('[WS Broadcast] Error in broadcastToSubscribers:', err);
    }
}

// PostgreSQL Listener with Auto-Reconnect
async function setupPgListener() {
    while (true) {
        let pgClient: any = null;
        try {
            pgClient = await pool.connect();
            logger.info('PostgreSQL realtime listener active on "fluxbase_changes", "flux_realtime", and "fluxbase_live"');
            await pgClient.query('LISTEN fluxbase_changes');
            await pgClient.query('LISTEN flux_realtime');
            await pgClient.query('LISTEN fluxbase_live');

            pgClient.on('notification', (msg: any) => {
                try {
                    if (msg.payload) {
                        const payload = JSON.parse(msg.payload);
                        broadcastToSubscribers(payload);
                    }
                } catch (e) {
                    logger.error('Error parsing pg_notify payload:', e);
                }
            });

            // Wait until client disconnects or encounters an error before reconnecting
            await new Promise((resolve, reject) => {
                pgClient.on('error', reject);
                pgClient.on('end', resolve);
            });
        } catch (e: any) {
            logger.error('[WS] PostgreSQL listener disconnected, reconnecting in 5s:', e?.message || e);
            if (pgClient) {
                try { pgClient.release(true); } catch {}
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}
setupPgListener().catch((e) => { logger.error('[WS] Fatal listener error:', e); });

// Heartbeat Interval: Run every 30 seconds
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
        const extWs = ws as ExtWebSocket;
        if (extWs.readyState === WebSocket.OPEN) {
            if (extWs.isAlive === false) {
                logger.info('[WS Heartbeat] Terminating inactive connection.');
                return extWs.terminate();
            }
            extWs.isAlive = false;
            try {
                extWs.ping();
                extWs.send(JSON.stringify({ type: 'ping' }));
            } catch {}
        }
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// Auth helper — supports session cookies (browser) AND API keys (external clients)
async function authenticateRequest(req: http.IncomingMessage): Promise<{ userId: string; allowedProjectId?: string } | null> {
    // 1. Try session cookie first (browser clients)
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce((acc, cookieStr) => {
            const [key, ...rest] = cookieStr.trim().split('=');
            acc[key] = rest.join('=');
            return acc;
        }, {} as Record<string, string>);

        const session = cookies['session'];
        if (session) {
            try {
                const { payload: p1 } = await jwtVerify(session, getWsSecret()); const decoded = p1 as any;
                return { userId: decoded.uid };
            } catch {
                // Invalid cookie — fall through to API key check
            }
        }
    }

    // 2. Try API key from query string (?token=...) or Sec-WebSocket-Protocol header
    let apiKey = '';
    const reqUrl = req.url || '';
    const qIndex = reqUrl.indexOf('?');
    if (qIndex !== -1) {
        const params = new URLSearchParams(reqUrl.slice(qIndex + 1));
        apiKey = params.get('token') || '';
    }

    if (!apiKey) {
        const proto = req.headers['sec-websocket-protocol'];
        if (proto && proto.startsWith('token.')) {
            apiKey = proto.slice(6);
        }
    }

    if (apiKey) {
        // 2a. Try verifying as a short-lived JWT ticket first
        try {
            const { payload: p2 } = await jwtVerify(apiKey, getWsSecret()); const decoded = p2 as any;
            if (decoded && decoded.uid) {
                return { userId: decoded.uid };
            }
        } catch {
            // Not a valid JWT or expired — fall through to API key lookup
        }

        // 2b. Try looking up as a persistent API key
        try {
            const res = await pool.query(
                `SELECT ak.user_id, ak.project_id 
                 FROM fluxbase_global.api_keys ak 
                 WHERE ak.key_value = $1 AND ak.is_active = true`,
                [apiKey]
            );
            if (res.rows.length > 0) {
                return {
                    userId: res.rows[0].user_id,
                    allowedProjectId: res.rows[0].project_id || undefined,
                };
            }
        } catch (e) {
            logger.error('[WS] API key validation error:', e);
        }
    }

    return null;
}

async function verifyProjectAccess(userId: string, projectId: string, allowedProjectId?: string): Promise<boolean> {
    if (allowedProjectId && allowedProjectId !== projectId) {
        return false;
    }

    try {
        const res = await pool.query(`
            SELECT p.project_id 
            FROM fluxbase_global.projects p
            LEFT JOIN fluxbase_global.project_members pm ON p.project_id = pm.project_id AND pm.user_id = $1
            WHERE p.project_id = $2 AND (p.user_id = $1 OR pm.user_id = $1)
        `, [userId, projectId]);

        return res.rows.length > 0;
    } catch (err) {
        logger.error('[WS] verifyProjectAccess error:', err);
        return false;
    }
}

// WebSocket Connection Handler
wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const extWs = ws as ExtWebSocket;
    extWs.isAlive = true;

    ws.on('pong', () => {
        extWs.isAlive = true;
    });

    try {
        let auth: { userId: string; allowedProjectId?: string } | null = null;
        try {
            auth = await authenticateRequest(req);
        } catch (authErr) {
            logger.warn('[WS] Auth error during connection:', authErr);
        }

        const userId = auth?.userId || `anon_${Math.random().toString(36).slice(2, 10)}`;
        const allowedProjectId = auth?.allowedProjectId;
        extWs.userId = userId;

        // Rate Limiting (Phase 3 Gatekeeping)
        let planType = 'free';
        if (auth?.userId) {
            try {
                const userRes = await pool.query('SELECT plan_type FROM fluxbase_global.users WHERE id = $1', [auth.userId]);
                planType = userRes.rows[0]?.plan_type || 'free';
            } catch (dbErr) {
                logger.warn('[WS] Could not query user plan, defaulting to free:', dbErr);
            }
        }

        let maxConnections = 100;
        if (planType === 'pro' || planType === 'employee' || planType === 'pay_as_you_go') maxConnections = 500;
        if (planType === 'max' || planType === 'org_owner') maxConnections = 5000;

        const currentConns = userConnectionCounts.get(userId) || 0;
        if (currentConns >= maxConnections) {
            ws.close(1008, `Rate Limit Exceeded. Your ${planType.toUpperCase()} plan only allows ${maxConnections} concurrent WebSocket connections.`);
            return;
        }

        userConnectionCounts.set(userId, currentConns + 1);

        // Keep track of what this socket subscribed to for cleanup
        const userSubscriptions = new Set<string>();

        function addSubscription(room: string) {
            if (!room) return;
            if (!clients.has(room)) {
                clients.set(room, new Set());
            }
            clients.get(room)!.add(ws);
            userSubscriptions.add(room);
        }

        function removeSubscription(room: string) {
            if (!room) return;
            const set = clients.get(room);
            if (set) {
                set.delete(ws);
                if (set.size === 0) clients.delete(room);
            }
            userSubscriptions.delete(room);
        }

        // Auto-subscribe if projectId is provided in URL query string (e.g. /ws?projectId=...)
        const reqUrl = req.url || '';
        const qIndex = reqUrl.indexOf('?');
        const queryParams = qIndex !== -1 ? new URLSearchParams(reqUrl.slice(qIndex + 1)) : new URLSearchParams();
        const initialProjectId = queryParams.get('projectId');

        if (initialProjectId) {
            const cleanPid = initialProjectId.replace(/^project_/, '');
            addSubscription(`project_${cleanPid}`);
            addSubscription(cleanPid);
            addSubscription(`${cleanPid}:*`);
            addSubscription('global');
            redis.incr(`live_sessions:${cleanPid}`).catch(() => {});
            logger.info(`[WS] Auto-subscribed socket for user ${userId} to project ${cleanPid}`);
        }
        addSubscription('global');

        // Confirm connection
        ws.send(JSON.stringify({
            type: 'connected',
            projectId: initialProjectId || 'global',
            timestamp: new Date().toISOString()
        }));

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());

                // Message-level Ping/Pong
                if (data.type === 'ping') {
                    extWs.isAlive = true;
                    try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
                    return;
                }
                if (data.type === 'pong') {
                    extWs.isAlive = true;
                    return;
                }

                if (data.type === 'subscribe') {
                    const roomId = data.roomId || data.room || data.channel;
                    const projId = data.projectId;
                    const tableId = data.tableId || data.table;

                    if (roomId) {
                        const cleanRoom = String(roomId);
                        addSubscription(cleanRoom);
                        const cleanPid = cleanRoom.replace(/^project_/, '');
                        if (cleanPid && cleanPid !== 'global') {
                            addSubscription(cleanPid);
                            addSubscription(`project_${cleanPid}`);
                            redis.incr(`live_sessions:${cleanPid}`).catch(() => {});
                        }
                        logger.info(`[WS] Client subscribed to room: ${cleanRoom}`);
                        ws.send(JSON.stringify({ type: 'subscribed', roomId: cleanRoom, channel: cleanRoom }));
                    }

                    if (projId) {
                        const cleanPid = String(projId).replace(/^project_/, '');
                        addSubscription(`project_${cleanPid}`);
                        addSubscription(cleanPid);

                        if (tableId) {
                            const channelId = `${cleanPid}:${tableId}`;
                            addSubscription(channelId);
                            logger.info(`[WS] Client subscribed to channel: ${channelId}`);
                            ws.send(JSON.stringify({ type: 'subscribed', channel: channelId, projectId: cleanPid, tableId }));
                        } else {
                            addSubscription(`${cleanPid}:*`);
                            logger.info(`[WS] Client subscribed to wildcard: ${cleanPid}:*`);
                            ws.send(JSON.stringify({ type: 'subscribed', channel: `${cleanPid}:*`, projectId: cleanPid }));
                        }
                        redis.incr(`live_sessions:${cleanPid}`).catch(() => {});
                    }
                    return;
                }

                if (data.type === 'unsubscribe') {
                    const roomId = data.roomId || data.room || data.channel;
                    const projId = data.projectId;
                    const tableId = data.tableId || data.table;

                    if (roomId) {
                        const cleanRoom = String(roomId);
                        removeSubscription(cleanRoom);
                        const cleanPid = cleanRoom.replace(/^project_/, '');
                        if (cleanPid && cleanPid !== 'global') {
                            redis.decr(`live_sessions:${cleanPid}`).catch(() => {});
                        }
                        logger.info(`[WS] Client unsubscribed from room: ${cleanRoom}`);
                    }
                    if (projId && tableId) {
                        const cleanPid = String(projId).replace(/^project_/, '');
                        const channelId = `${cleanPid}:${tableId}`;
                        removeSubscription(channelId);
                        redis.decr(`live_sessions:${cleanPid}`).catch(() => {});
                        logger.info(`[WS] Client unsubscribed from channel: ${channelId}`);
                    }
                    return;
                }

            if (data.type === 'chat_request') {
                const { messages: clientMessages, currentPath, activeProject } = data;
                if (!clientMessages || !Array.isArray(clientMessages)) {
                    ws.send(JSON.stringify({ type: 'chat_error', message: 'Missing messages array' }));
                    return;
                }

                let projectContext = '';
                if (activeProject) {
                    projectContext = `\nACTIVE PROJECT CONTEXT:\n- Name: "${activeProject.display_name || ''}"\n- ID: "${activeProject.project_id || ''}"\n- Database Dialect: "${activeProject.dialect || 'postgresql'}"\n- Timezone: "${activeProject.timezone || 'UTC'}"\n`;
                } else {
                    projectContext = `\nACTIVE PROJECT CONTEXT: No active project is currently selected by the user. If they want to perform project-specific actions or execute SQL, instruct them to select or create a project first.\n`;
                }

                const systemPrompt = `You are Flux AI, an autonomous, highly agentic AI developer assistant embedded inside the Fluxbase dashboard (https://fluxbasedb.me). 
Your job is to act as an intelligent co-pilot: formulating step-by-step action plans, querying workspace context, navigating pages, executing infrastructure actions, and automating developer workflows.

STRICT APPLICATION-SPECIFIC OPERATING RULES:
- EXCLUSIVE FLUXBASE SCOPE: You are strictly and exclusively the dedicated AI Developer Assistant and Database Architect for FLUXBASE.
- You MUST ONLY generate responses that are directly relevant to Fluxbase: its databases, SQL execution, schemas, APIs, SDKs, File Storage, Realtime, Scraper, AI Gateway, MCP Server, Billing, and applications built with or connected to Fluxbase.
- REFUSAL POLICY: If the user asks about unrelated topics (cooking, creative writing, non-Fluxbase coding, general trivia, politics, entertainment), politely decline:
  "I am Flux AI, the specialized database architect and developer assistant for Fluxbase. I can only assist with Fluxbase platform operations, database queries, SQL architecture, storage, webhooks, and integrating your applications with Fluxbase. How can I help you with your Fluxbase workspace today?"
- FLUXBASE-CENTRIC SOLUTIONS: Always provide solutions using Fluxbase primitives (@fluxbase/client SDK, direct PostgreSQL/MySQL connections, https://fluxbasedb.me/api/v1/sql, https://fluxbasedb.me/api/storage/upload, https://fluxbasedb.me/api/realtime/subscribe). Never recommend external competing cloud backends.

AGENTIC WORKFLOW & PLANNING INSTRUCTIONS:
1. ACT AS AN AGENT, NOT A BOT: For complex tasks (e.g. creating tables, seeding data, setting up webhooks, analyzing schema), explicitly outline your multi-step action plan using Markdown formatting (e.g., "### Agent Execution Plan\n- **Step 1**: Inspect workspace schema\n- **Step 2**: Generate optimized DDL\n- **Step 3**: Request execution approval").
2. BE CONCISE & PRECISE: Keep explanations clear, structured, and professional. Do not use emojis.
3. CONTEXT AWARENESS: The user's current URL path is: "${currentPath || '/dashboard'}". Use this to understand what page they are viewing. ${projectContext}
4. AGENTIC NAVIGATION: You have the physical ability to teleport the user's browser to different pages. If you agree to take the user to a different page, YOU MUST physically output the exact navigation tag at the very end of your response: [NAVIGATE:/the_path]. If you do not include this tag, the user will be stranded.
Here are the absolute paths you can use:
- Dashboard / Projects: /dashboard
- Create Project: /dashboard/projects/create
- API Keys: /settings/api-keys
- Webhooks: /settings/webhooks
- General Settings: /settings
- Table Editor / Database Manager: /editor
- SQL Editor / Write SQL: /query
- Cloud Storage/Buckets: /storage
Example response: "I'll take you to the Table Editor right now.\n[NAVIGATE:/editor]"
5. AGENTIC EXECUTION (SAFETY GUARDRAIL): You have the power to create projects and execute SQL directly on behalf of the user. Because these modify infrastructure and data, you MUST explicitly ask for safety permission using the exact string: [CONFIRM_ACTION:CmdName:Args...].
- To Create a Project: [CONFIRM_ACTION:CREATE_PROJECT:ProjectName:dialect] (e.g. [CONFIRM_ACTION:CREATE_PROJECT:MyShop:postgresql])
- To Execute SQL (e.g. create tables, insert data): [CONFIRM_ACTION:EXECUTE_SQL:RawSQLQuery] (e.g. [CONFIRM_ACTION:EXECUTE_SQL:CREATE TABLE users (id SERIAL PRIMARY KEY, name VARCHAR(50))])
For example, if asked to 'create a sample table', output: 'I can create that table for you right now! [CONFIRM_ACTION:EXECUTE_SQL:CREATE TABLE sample (...)]'. 
6. AGENTIC CLICKING (UI CONTROL): You can physically click or tap buttons on the screen for the user! If the user asks you to click something (like "click on new table"), output a click tag with the EXACT visible text of the button: [CLICK:Button Name]. 
Example: "I am clicking the New Table button for you right now.[CLICK:New Table]"
7. AGENTIC TYPING (FORM FILLING): You have the physical capability to type into forms! If the user says "set table name to users" or asks you to type into an input box, YOU MUST physically output the exact typing tag at the very end of your response: [TYPE:InputValue:FieldLabel]. For example, if typing "users" into "Table Name", you MUST append: [TYPE:users:Table Name]. If you do not include this exact hidden bracket tag, your typing action will silently fail and the user will think you are broken!
8. EXPLICIT SETTINGS FORM LAYOUTS:
- API Keys tab (/settings/api-keys): The creation form is directly on this page (no modals, no "Create New API Key" button exists). To create a key, type into field "Key Name" (e.g. [TYPE:test:Key Name]), click scope text like "Admin Access" (e.g. [CLICK:Admin Access]), and click button "Generate API Key" (e.g. [CLICK:Generate API Key]).
- Webhooks tab (/settings/webhooks): The form is directly on the page. To add, type name into field "Name" (e.g. [TYPE:Slack:Name]), type url into field "URL Endpoint" (e.g. [TYPE:https://hooks:URL Endpoint]), and click button "Add Webhook" (e.g. [CLICK:Add Webhook]).
9. Below is the official Fluxbase Integration Guide. Use this information to answer any technical questions about API keys, SQL queries, or Webhooks/Storage.

--- START OFFICIAL INTEGRATION GUIDE ---
${docsContext.substring(0, 10000)}
--- END OFFICIAL INTEGRATION GUIDE ---

Provide your response in Markdown formatting. Do NOT use HTML. Keep code snippets short and sweet.`;

                try {
                    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.GLM_API_KEY || ''}`
                        },
                        body: JSON.stringify({
                            model: 'glm-5.2',
                            messages: [
                                { role: 'system', content: systemPrompt },
                                ...clientMessages.slice(-6).map((m: any) => ({
                                    role: m.role === 'assistant' ? 'assistant' : 'user',
                                    content: m.content
                                }))
                            ],
                            stream: true,
                            temperature: 0.2
                        })
                    });

                    if (!response.ok) {
                        const errText = await response.text();
                        ws.send(JSON.stringify({ type: 'chat_error', message: `Flux AI returned status ${response.status}: ${errText}` }));
                        return;
                    }

                    const body = response.body;
                    if (!body) {
                        ws.send(JSON.stringify({ type: 'chat_error', message: 'No response body from Flux AI' }));
                        return;
                    }

                    const reader = body.getReader();
                    const decoder = new TextDecoder();
                    let fullText = '';
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';

                        for (const line of lines) {
                            const cleanLine = line.trim();
                            if (!cleanLine || cleanLine === 'data: [DONE]') continue;
                            if (cleanLine.startsWith('data:')) {
                                try {
                                    const rawJson = cleanLine.slice(5).trim();
                                    const parsed = JSON.parse(rawJson);
                                    const content = parsed.choices?.[0]?.delta?.content || '';
                                    if (content) {
                                        fullText += content;
                                        ws.send(JSON.stringify({ type: 'chat_token', token: content }));
                                    }
                                } catch {
                                    // ignore incomplete chunk parsing errors
                                }
                            }
                        }
                    }

                    ws.send(JSON.stringify({ type: 'chat_done', text: fullText }));

                } catch (err: any) {
                    logger.error('[WS Chat Error]:', err);
                    ws.send(JSON.stringify({ type: 'chat_error', message: err.message || 'Failed to call Zhipu API' }));
                }
            }

        } catch (e) {
            logger.error('WebSocket message error:', e);
        }
    });

        ws.on('close', () => {
            const currentConns = userConnectionCounts.get(userId) || 1;
            userConnectionCounts.set(userId, Math.max(0, currentConns - 1));

            for (const room of userSubscriptions) {
                const set = clients.get(room);
                if (set) {
                    set.delete(ws);
                    if (set.size === 0) {
                        clients.delete(room);
                    }
                }
                const projId = room.replace(/^project_/, '').split(':')[0];
                if (projId && projId !== 'global') {
                    redis.decr(`live_sessions:${projId}`).catch(() => {});
                }
            }
        });
    } catch (connErr) {
        logger.error('[WS] Unhandled connection error:', connErr);
        try {
            ws.close(1011, 'Internal Server Error');
        } catch {}
    }
});

logger.info('WebSocket Realtime Server running on ws://localhost:4000');
