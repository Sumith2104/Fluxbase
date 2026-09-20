import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import logger from '@/lib/logger';
import { SqlEngine } from '@/lib/sql-engine';
import { getProjectById } from '@/lib/data';
import { getProjectDbAndSchema } from '@/lib/tenant-pools';
import { getRagContext } from '@/lib/rag-service';
import { getSqlCapabilityPrompt } from '@/lib/sql-capabilities';
import { ModelGateway, ModelMessage } from '@/lib/agent-core/gateway';
import { createAgentSseTransformStream } from '@/lib/agent-core/stream';

// ── Schema Cache ──────────────────────────────────────────────────────────────
// Avoids querying information_schema on every chat message.
// TTL: 5 minutes (300s) per project. Invalidate on DDL via DELETE endpoint.
const schemaCache = new Map<string, { data: string; expires: number }>();
const SCHEMA_TTL_MS = 300_000;

function isCasualOrGreeting(msg: string): boolean {
    if (!msg) return true;
    const trimmed = msg.trim().toLowerCase().replace(/[!?.,]/g, '');
    if (trimmed.length <= 2) return true; // e.g. "hi", "yo"
    return /^(hi|hello|hey|hiya|yo|greetings|howdy|sup|good (morning|afternoon|evening)|who are you|what can you do|help|thanks|thank you|bye|goodbye)$/i.test(trimmed);
}

async function getSchemaContext(projectId: string | undefined, userId: string, projectInfo: any): Promise<string> {
    if (!projectId) return '';

    const cached = schemaCache.get(projectId);
    if (cached && Date.now() < cached.expires) return cached.data;

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return '';

        const { dbName, schemaName } = getProjectDbAndSchema(project);
        const isMysql = project.dialect?.toLowerCase() === 'mysql';
        const targetSchemaOrDb = isMysql ? dbName : schemaName;
        const escaped = (targetSchemaOrDb || '').replace(/'/g, "''");
        const engine = new SqlEngine(projectId, userId, undefined, undefined, project);

        const colQuery = isMysql
            ? `SELECT table_name, column_name, data_type, is_nullable, column_key FROM information_schema.columns WHERE table_schema = '${escaped}' AND table_name NOT LIKE '\\_flux\\_internal\\_%' ORDER BY table_name, ordinal_position;`
            : `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = '${escaped}' AND table_name NOT LIKE '\\_flux\\_internal\\_%' ORDER BY table_name, ordinal_position;`;

        const fkQuery = isMysql
            ? `SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, REFERENCED_TABLE_NAME as referenced_table, REFERENCED_COLUMN_NAME as referenced_column
               FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
               WHERE TABLE_SCHEMA = '${escaped}' AND REFERENCED_TABLE_NAME IS NOT NULL;`
            : `SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
               FROM information_schema.table_constraints AS tc
               JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
               JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
               WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${escaped}';`;

        const rowCountQuery = isMysql
            ? `SELECT TABLE_NAME as table_name, COALESCE(TABLE_ROWS, 0) as row_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${escaped}' AND TABLE_NAME NOT LIKE '\\_flux\\_%';`
            : `SELECT c.relname as table_name, GREATEST(0, c.reltuples::bigint) as row_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE (n.nspname = '${escaped}' OR n.nspname = 'public') AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE '_flux_%';`;

        const [colRes, fkRes, rowCountRes] = await Promise.all([
            engine.execute(colQuery).catch((err) => { logger.warn('[AI Chat] Schema columns introspection error:', err?.message || err); return null; }),
            engine.execute(fkQuery).catch((err) => { logger.warn('[AI Chat] Schema FK introspection error:', err?.message || err); return null; }),
            engine.execute(rowCountQuery).catch((err) => { logger.warn('[AI Chat] Schema row count error:', err?.message || err); return null; })
        ]);

        const rowCountMap: Record<string, { count: number; isApproximate: boolean }> = {};
        if (rowCountRes?.rows?.length) {
            await Promise.all(rowCountRes.rows.map(async (r: any) => {
                const t = r.table_name || r.TABLE_NAME;
                let cnt = parseInt(r.row_count || r.ROW_COUNT || '0', 10);
                const isApproximate = cnt >= 100000;
                if (!isMysql && !isApproximate && t) {
                    try {
                        const exactRes = await engine.execute(`SELECT COUNT(*) as c FROM "${t}"`);
                        if (exactRes?.rows?.[0]?.c !== undefined) {
                            cnt = parseInt(exactRes.rows[0].c, 10);
                        }
                    } catch {}
                }
                if (t) rowCountMap[t] = { count: cnt, isApproximate };
            }));
        }

        let result = '';
        if (colRes?.rows?.length) {
            const schemaMap: Record<string, string[]> = {};
            colRes.rows.forEach((r: any) => {
                const t = r.table_name || r.TABLE_NAME;
                const c = r.column_name || r.COLUMN_NAME;
                const dt = r.data_type || r.DATA_TYPE || '';
                const key = (r.column_key || r.COLUMN_KEY) === 'PRI' ? ' [PK]' : '';
                if (!schemaMap[t]) schemaMap[t] = [];
                schemaMap[t].push(`${c} (${dt}${key})`);
            });

            const fkList: string[] = [];
            if (fkRes?.rows?.length) {
                fkRes.rows.forEach((r: any) => {
                    fkList.push(`  ${r.table_name}.${r.column_name} -> ${r.referenced_table}.${r.referenced_column}`);
                });
            }

            result = `\n\n=== LIVE DATABASE SCHEMA ===\n` +
                Object.entries(schemaMap)
                    .map(([tbl, cols]) => {
                        const info = rowCountMap[tbl];
                        const countStr = info !== undefined
                            ? (info.isApproximate ? ` (~${info.count.toLocaleString()} rows)` : ` (${info.count.toLocaleString()} rows)`)
                            : '';
                        return `- ${tbl}${countStr}: [${cols.join(', ')}]`;
                    })
                    .join('\n') +
                (fkList.length > 0 ? `\n- Foreign Keys:\n${fkList.join('\n')}` : '') +
                `\n\nCRITICAL: Use EXACT table/column names above. NEVER invent fake tables or columns.\n============================\n`;
        }

        schemaCache.set(projectId, { data: result, expires: Date.now() + SCHEMA_TTL_MS });
        return result;
    } catch (err) {
        logger.warn('[AI Chat] Schema introspection failed:', err);
        return '';
    }
}

// ── Pre-warm Endpoint (GET) ──────────────────────────────────────────────────
export async function GET() {
    return NextResponse.json({ status: 'ready', timestamp: Date.now() });
}

// ── Main Handler (POST) ──────────────────────────────────────────────────────
export async function POST(req: Request) {
    try {
        const auth = await getAuthContextFromRequest(req);
        if (!auth?.userId) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { currentPath = '/', model, activeProject, screenContext, stream = false } = body;

        let messages: Array<{ role: string; content: string; hidden?: boolean }> = [];
        if (Array.isArray(body.messages)) {
            messages = body.messages;
        } else if (typeof body.message === 'string' && body.message.trim()) {
            messages = [{ role: 'user', content: body.message.trim() }];
        }

        const userLastMsg = messages[messages.length - 1]?.content || '';
        const dialect = activeProject?.dialect || 'postgresql';

        const isGreeting = isCasualOrGreeting(userLastMsg);

        let rawSchema = '';
        let rag = { schemaSnippet: '', docSnippet: '', errorMemorySnippet: '', sources: [] as string[] };

        if (!isGreeting) {
            rawSchema = await getSchemaContext(activeProject?.project_id, auth.userId, activeProject);
            rag = await getRagContext(
                activeProject?.project_id,
                auth.userId,
                dialect,
                rawSchema,
                userLastMsg
            );
        }

        const projectContext = activeProject
            ? `\nPROJECT: "${activeProject.display_name || ''}" (ID: ${activeProject.project_id}) | Dialect: ${activeProject.dialect || 'postgresql'} | TZ: ${activeProject.timezone || 'UTC'}\n`
            : '\nNo active project. Ask user to select/create one first for SQL operations.\n';

        let screenContextStr = '';
        if (screenContext) {
            screenContextStr = `\nSCREEN: Table="${screenContext.activeTable || 'none'}" Cols=${JSON.stringify(screenContext.visibleColumns?.slice(0, 15) || [])} Rows=${screenContext.rowCount || 0}${screenContext.activeError ? ` Error="${screenContext.activeError.slice(0, 300)}"` : ''}\n`;
            if (screenContext.lastSqlError && screenContext.lastSqlError.error) {
                screenContextStr += `\nEDITOR LAST FAILED SQL QUERY:\n\`\`\`sql\n${screenContext.lastSqlError.query || ''}\n\`\`\`\nDATABASE EXECUTION ERROR:\n${screenContext.lastSqlError.error}\n(CRITICAL: The user has an active SQL failure in the Query Editor. If they ask to fix the error or why the query failed, diagnose this exact query and error, explain the cause, and provide the corrected query wrapped in [EXECUTE_SQL:...])\n`;
            }
        }

        const systemPrompt = isGreeting
            ? `You are Flux AI, an autonomous Staff Database Engineer and BI Architect inside Fluxbase. Greet the user warmly and concisely explain what you can do (query databases, generate charts, inspect schemas, create tables, run Auto-Pilot workflows, and navigate the app). Keep your response concise.`
            : `You are Flux AI, a production-grade Staff Database Engineer, SQL Architect, and Lead BI Analyst inside Fluxbase.
You are capable of executing SQL queries, generating live Recharts data visualizations, inspecting schemas, navigating the UI, clicking buttons, typing in forms, and requesting human-in-the-loop approvals for sensitive operations.

AVAILABLE ROUTES:
/ (Home)
/dashboard (Real-time analytics, API throughput, query metrics)
/dashboard/projects (Project switcher, database management)
/editor (Spreadsheet-style interactive data grid for viewing/editing table rows)
/query (Monaco SQL editor with AI query generation, explain plans, data exports)
/database (Visual schema explorer, tables, relationships)
/storage (AWS S3 file browser, uploader, presigned URLs)
/scraper (Automated web data scraping into database tables)
/docs (Interactive REST API & SDK developer documentation)
/settings (Project configurations, API keys, team members, backups)

${projectContext}${screenContextStr}
${getSqlCapabilityPrompt(dialect)}
${rag.schemaSnippet}
${rag.docSnippet}
${rag.errorMemorySnippet}

CURRENT PATH: ${currentPath}

CRITICAL RULES:
1. REASONING PROTOCOL: Put your internal thinking and query planning inside <think>...</think> tags.
2. ACCURATE TABLE ROW COUNTS:
   - Live row counts are ALREADY PROVIDED in "=== LIVE DATABASE SCHEMA ===".
   - When asked for row counts, answer directly using these live schema row counts in a clean Markdown table!
   - NEVER run "SELECT COUNT(*) FROM information_schema.tables".
3. REAL SQL EXECUTION MANDATE:
   - When the user asks to query, select, count, inspect, OR insert, create, or populate mock data:
     You MUST output [EXECUTE_SQL:<exact_sql_query>] at the very end of your response!
   - NEVER say "I have executed the query" or "I will now execute this statement" without appending the [EXECUTE_SQL:...] tag!
     If you do not append [EXECUTE_SQL:...], NO QUERY WILL BE EXECUTED!
4. BULK DATA POPULATION & MOCK DATA GENERATION:
   - ALWAYS use EXACT table and column names from "=== LIVE DATABASE SCHEMA ===". NEVER invent fake columns (e.g. do not invent "order_number", "billing_address_id" if they do not exist)!
   - In PostgreSQL, for bulk data generation, ALWAYS use high-speed set-based generation:
     INSERT INTO table (col1, col2, ...) SELECT expr1, expr2, ... FROM generate_series(1, count) AS g;
   - NEVER use PL/pgSQL loops 'DO $$ ... WHILE ... $$' and NEVER write 'COMMIT;' (these fail and time out).
   - Generate up to 1,000 - 10,000 rows per batch so the operation finishes in < 2 seconds.
   - Always append [EXECUTE_SQL:<query>] at the end.
5. CONFIRMATION & "PROCEED" INTENT:
   - If the user says "proceed", "yes", "confirm", "go ahead", "run", "do it", or "execute":
     DO NOT claim the query was already executed unless you see an actual execution observation in context!
     Instead, take the SQL proposed in the conversation history and IMMEDIATELY emit [EXECUTE_SQL:<exact_sql_query>] so the query actually executes!
6. IN-CHAT INTERACTIVE CHARTS:
   - When the user asks for charts, graphs, trends, breakdowns, or visual analytics, provide the explanation, execute the aggregation query via [EXECUTE_SQL:...], and if sample/known aggregated data is available, emit [RENDER_CHART:{"type":"bar"|"line"|"pie"|"area","title":"...","data":[...],"xKey":"...","yKey":"..."}].
7. DESTRUCTIVE OPERATIONS:
   - For DROP TABLE, TRUNCATE, ALTER TABLE, or DELETE without WHERE, emit [REQUEST_APPROVAL:appr_${Date.now()}:EXECUTE_SQL:<summary>:<sql>] so the user gets an interactive confirmation card.
8. AUTO-PILOT GOALS:
   - When the task is complete, summarize results and end with [GOAL_ACCOMPLISHED:<summary>].

AVAILABLE ACTION TAGS (append at the end of response):
- Execute SQL (Read / Insert / Create / Update): [EXECUTE_SQL:<exact_sql_query>]
- Destructive SQL (Drop / Truncate / Delete all): [REQUEST_APPROVAL:appr_${Date.now()}:EXECUTE_SQL:<summary>:<sql>]
- Interactive Chart: [RENDER_CHART:{"type":"bar"|"line"|"pie"|"area","title":"...","data":[...],"xKey":"...","yKey":"..."}]
- Navigate: [NAVIGATE:/path]
- Click: [CLICK:<label_or_id>]
- Type: [TYPE:<value>:<field_or_placeholder>]
- Goal Finished: [GOAL_ACCOMPLISHED:<summary>]`;

        // Format conversation history
        const recentMessages = messages.slice(-10);
        const modelMessages: ModelMessage[] = [
            { role: 'system', content: systemPrompt }
        ];

        for (const msg of recentMessages) {
            if (msg.hidden) continue;
            modelMessages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            });
        }

        // ── 2. Handle Streaming (SSE) ──────────────────────────────────────────
        const wantsStream = Boolean(stream) || req.headers.get('accept')?.includes('text/event-stream');
        if (wantsStream) {
            const { stream: upstreamStream } = await ModelGateway.stream({
                model: model || 'flux-fast',
                messages: modelMessages,
                temperature: 0.2
            });

            const transformStream = createAgentSseTransformStream(rag.sources);
            const clientStream = upstreamStream.pipeThrough(transformStream);

            return new Response(clientStream, {
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                }
            });
        }

        // ── 3. Handle Non-Streaming JSON Mode ──────────────────────────────────
        const result = await ModelGateway.generate({
            model: model || 'flux-fast',
            messages: modelMessages,
            temperature: 0.2
        });

        let responseText = result.text || '';

        // Strip leading "ASSISTANT:" prefix if model mirrored header
        responseText = responseText.replace(/^(?:ASSISTANT|Assistant):\s*/i, '').trim();

        // Anti-hallucination defense: Strip multi-turn hallucinations
        if (/\n+(?:ASSISTANT|Assistant):\s*/i.test(responseText)) {
            const parts = responseText.split(/\n+(?:ASSISTANT|Assistant):\s*/i).filter(Boolean);
            if (parts.length > 0) responseText = parts[parts.length - 1].trim();
        }
        if (responseText.includes('\nUSER:')) responseText = responseText.split(/\nUSER:/i)[0].trim();
        else if (responseText.includes('\nUser:')) responseText = responseText.split(/\nUser:/)[0].trim();

        // If a thought was captured, preserve it at the top
        if (result.thought) {
            responseText = `<think>${result.thought}</think>\n\n${responseText}`.trim();
        }

        return NextResponse.json({
            success: true,
            text: responseText,
            thought: result.thought,
            sources: rag.sources,
            provider: result.provider,
            model: result.model
        });

    } catch (error: any) {
        logger.error('AI Chat Error:', error);
        let userFacingError = error.message || 'Failed to process request.';
        if (userFacingError.includes('1113') || userFacingError.includes('余额不足')) {
            userFacingError = 'Primary AI quota exhausted. Automatically falling back to backup provider.';
        }
        return NextResponse.json({ success: false, error: userFacingError }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const { projectId } = await req.json();
        if (projectId) {
            schemaCache.delete(projectId);
            logger.info('[AI Chat] Schema cache invalidated for', projectId);
        }
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ success: false }, { status: 400 });
    }
}
