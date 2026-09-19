import { config } from 'dotenv';
config({ path: '.env.local' });

import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import http from 'http';
import { Redis } from '@upstash/redis';
import fs from 'fs';
import path from 'path';
import logger from '@/lib/logger';

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

const url = process.env.UPSTASH_REDIS_REST_URL || 'https://dummy.upstash.io';
const token = process.env.UPSTASH_REDIS_REST_TOKEN || 'dummy';
const redis = new Redis({ url, token });

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

// Broadcast helper
function broadcastToSubscribers(payload: any) {
    // payload structure from Postgres: { table, project_id, operation, data }
    if (payload.table === 'projects' || payload.project_id === 'global') {
        const message = JSON.stringify({ type: 'update', ...payload });
        for (const [_, subs] of clients) {
            for (const ws of subs) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            }
        }
        return;
    }

    const channelId = `${payload.project_id}:${payload.table}`;
    const subs = clients.get(channelId);

    // Also broadcast to users subscribing to wildcard '*' for the whole project
    const wildcardSubs = clients.get(`${payload.project_id}:*`);

    const allSubs = new Set<WebSocket>([
        ...(subs || []),
        ...(wildcardSubs || [])
    ]);

    if (allSubs.size === 0) return;

    const message = JSON.stringify({ type: 'update', ...payload });
    for (const ws of allSubs) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
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
                        
                        if (msg.channel === 'fluxbase_changes' || msg.channel === 'flux_realtime') {
                            broadcastToSubscribers(payload);
                        } else if (msg.channel === 'fluxbase_live') {
                            // Broadcast to project wildcard listeners
                            const projectId = payload.project_id;
                            if (projectId) {
                                const wildcardSubs = clients.get(`${projectId}:*`);
                                if (wildcardSubs) {
                                    const message = JSON.stringify({ type: 'live', ...payload });
                                    for (const ws of wildcardSubs) {
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(message);
                                        }
                                    }
                                }
                            }
                        }
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
    //    External WS clients cannot set Authorization headers during the upgrade,
    //    so the token query param is the standard approach.
    let apiKey = '';
    const reqUrl = req.url || '';
    const qIndex = reqUrl.indexOf('?');
    if (qIndex !== -1) {
        const params = new URLSearchParams(reqUrl.slice(qIndex + 1));
        apiKey = params.get('token') || '';
    }

    if (!apiKey) {
        // Some clients pass the token as the WebSocket sub-protocol
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
    // API key restriction: key is scoped to a specific project
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
wss.on('connection', async (ws, req) => {
    try {
        let auth: { userId: string; allowedProjectId?: string } | null = null;
        try {
            auth = await authenticateRequest(req);
        } catch (authErr) {
            logger.warn('[WS] Auth error during connection:', authErr);
        }

        if (!auth) {
            ws.close(1008, 'Unauthorized — provide a valid session cookie or ?token=<api_key>');
            return;
        }

        const { userId, allowedProjectId } = auth;

        // Rate Limiting (Phase 3 Gatekeeping)
        let planType = 'free';
        try {
            const userRes = await pool.query('SELECT plan_type FROM fluxbase_global.users WHERE id = $1', [userId]);
            planType = userRes.rows[0]?.plan_type || 'free';
        } catch (dbErr) {
            logger.warn('[WS] Could not query user plan, defaulting to free:', dbErr);
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

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'subscribe') {
                const { projectId, tableId } = data;
                if (!projectId || !tableId) return;

                const hasAccess = await verifyProjectAccess(userId, projectId, allowedProjectId);
                if (!hasAccess) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Access denied to project' }));
                    return;
                }

                const channelId = `${projectId}:${tableId}`;

                if (!clients.has(channelId)) {
                    clients.set(channelId, new Set());
                }
                clients.get(channelId)!.add(ws);
                userSubscriptions.add(channelId);
                
                // Track this active session in Redis
                await redis.incr(`live_sessions:${projectId}`).catch(() => {});

                logger.info(`[WS] Client subscribed to ${channelId}`);
                ws.send(JSON.stringify({ type: 'subscribed', channel: channelId }));
            }

            if (data.type === 'unsubscribe') {
                const { projectId, tableId } = data;
                const channelId = `${projectId}:${tableId}`;
                if (clients.has(channelId)) {
                    clients.get(channelId)!.delete(ws);
                }
                userSubscriptions.delete(channelId);
                
                // Untrack this session in Redis
                await redis.decr(`live_sessions:${projectId}`).catch(() => {});
                
                logger.info(`[WS] Client unsubscribed from ${channelId}`);
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

                const systemPrompt = `You are Flux AI, an autonomous, highly agentic AI developer assistant embedded inside the Fluxbase dashboard. 
Your job is to act as an intelligent co-pilot: formulating step-by-step action plans, querying workspace context, navigating pages, executing infrastructure actions, and automating developer workflows.

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
                        ws.send(JSON.stringify({ type: 'chat_error', message: `GLM API returned status ${response.status}: ${errText}` }));
                        return;
                    }

                    const body = response.body;
                    if (!body) {
                        ws.send(JSON.stringify({ type: 'chat_error', message: 'No response body from GLM' }));
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
        // Decrease connection count
        const currentConns = userConnectionCounts.get(userId) || 1;
        userConnectionCounts.set(userId, Math.max(0, currentConns - 1));

        for (const channelId of userSubscriptions) {
            if (clients.has(channelId)) {
                clients.get(channelId)!.delete(ws);
            }
            // Extract projectId from channelId (format: projectId:tableId)
            const projId = channelId.split(':')[0];
            if (projId) {
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
