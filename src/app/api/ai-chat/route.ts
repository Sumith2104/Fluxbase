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
import { recordAiUsage } from '@/lib/ai-gateway/usage-ledger';
import { checkOffTopicPolicy } from '@/lib/ai-policy-guard';

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

        let messages: Array<{ role: string; content: any; images?: string[]; hidden?: boolean }> = [];
        if (Array.isArray(body.messages)) {
            messages = body.messages;
        } else if (typeof body.message === 'string' && body.message.trim()) {
            messages = [{ role: 'user', content: body.message.trim() }];
        }

        const lastMsgObj = messages[messages.length - 1];
        let userLastMsg = '';
        if (lastMsgObj) {
            if (typeof lastMsgObj.content === 'string') {
                userLastMsg = lastMsgObj.content;
            } else if (Array.isArray(lastMsgObj.content)) {
                const txt = lastMsgObj.content.find((p: any) => p && p.type === 'text');
                userLastMsg = txt?.text || '';
            }
        }
        const hasAttachedImages = messages.some((m: any) => (Array.isArray(m.images) && m.images.length > 0) || (Array.isArray(m.content) && m.content.some((p: any) => p?.type === 'image_url')));
        const dialect = activeProject?.dialect || 'postgresql';

        // ── Deterministic Scope Policy Guard (Layer 1) ───────────────────────
        const policyCheck = checkOffTopicPolicy(userLastMsg, hasAttachedImages);
        if (policyCheck.isOffTopic && policyCheck.refusalText) {
            logger.info('[AI Chat] Request intercepted by Fluxbase Policy Guard:', {
                userId: auth.userId,
                reason: policyCheck.reason,
                queryPreview: userLastMsg.slice(0, 100)
            });

            const refusalText = policyCheck.refusalText;
            const wantsStream = Boolean(stream) || req.headers.get('accept')?.includes('text/event-stream');

            if (wantsStream) {
                const encoder = new TextEncoder();
                const customStream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', token: refusalText })}\n\n`));
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', fullText: refusalText })}\n\n`));
                        controller.close();
                    }
                });

                return new Response(customStream, {
                    headers: {
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'Cache-Control': 'no-cache, no-transform',
                        'Connection': 'keep-alive',
                        'X-Accel-Buffering': 'no',
                    }
                });
            }

            return NextResponse.json({
                success: true,
                text: refusalText,
                sources: [],
                provider: 'fluxbase-guard',
                model: 'scope-policy-guard'
            });
        }

        const isGreeting = !hasAttachedImages && isCasualOrGreeting(userLastMsg);

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
            ? `You are Flux AI, an autonomous Staff Database Engineer and BI Architect inside Fluxbase (https://fluxbasedb.me). You are strictly dedicated to Fluxbase database management, SQL architecture, storage, and developer app integrations. Greet the user warmly and concisely explain what you can do (query databases, generate charts, inspect schemas, create tables, run Auto-Pilot workflows, and navigate the app). Keep your response concise.`
            : `You are Flux AI, a production-grade Staff Database Engineer, SQL Architect, and Lead BI Analyst inside Fluxbase (https://fluxbasedb.me).
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
0. STRICT FLUXBASE-ONLY SCOPE (FOUR PERMITTED PILLARS ONLY):
   - You are STRICTLY AND EXCLUSIVELY the dedicated AI Database Architect, Engineer, and Developer Assistant for FLUXBASE (https://fluxbasedb.me).
   - You MUST ONLY assist with and generate responses for the following FOUR PERMITTED PILLARS:
     1) FLUXBASE OPERATIONS: Database tables, schema DDL, columns, data types, primary/foreign keys, indexes, AWS S3 storage buckets, file uploads, webhooks, API keys, project configurations, and settings.
     2) QUERY: Formulating, explaining, optimizing, diagnosing, and executing PostgreSQL and MySQL queries via [EXECUTE_SQL:...], analyzing query plans, and generating visual analytics charts via [RENDER_CHART:...].
     3) NAVIGATION: Teleporting the user across Fluxbase dashboard pages via [NAVIGATE:/path], clicking UI buttons via [CLICK:<label>], and typing form inputs via [TYPE:<val>:<input>].
     4) AUTOMATION TASKS: Auto-Pilot multi-step database workflows, high-speed set-based mock data seeding via generate_series, table triggers, web scraper ingestion into database tables, and goal completion via [GOAL_ACCOMPLISHED:<summary>].

   - ABSOLUTE PROHIBITION ON LEAF/PLANT & NON-DATABASE IMAGES:
     * Multimodal vision is strictly restricted to database ER diagrams, relational schemas, database architecture diagrams, and SQL/UI error screenshots.
     * You are STRICTLY FORBIDDEN from analyzing photos of leaves, plants, crops, diseases, biology, animals, food, or general photography.
     * If the user provides a picture of a leaf, plant, crop, or any non-database/non-UI photo, or asks to diagnose plant diseases, you MUST IMMEDIATELY DECLINE:
       "I am Flux AI, strictly dedicated to Fluxbase database management, SQL queries, UI navigation, and workspace automation. I cannot analyze plant or leaf images, diagnose agricultural diseases, or process non-database media. Please provide database ER diagrams, relational schemas, or SQL error screenshots."

   - ABSOLUTE PROHIBITION ON STANDALONE / GENERAL PYTHON SCRIPTS:
     * You are STRICTLY FORBIDDEN from generating general Python programs, standalone scripts, or machine learning code (e.g. leaf disease classifiers, OpenCV image processing, PyTorch, TensorFlow, CNNs, web frameworks, games, or general utility scripts).
     * The ONLY Python code permitted is establishing a database connection to Fluxbase (e.g. SQLAlchemy, psycopg2, asyncpg connecting to postgresql://postgres:...@fluxbasedb.me:5432) or calling Fluxbase REST SQL / Storage APIs.
     * If asked to write general Python code or machine learning scripts, decline and reiterate that you only handle Fluxbase database operations, queries, navigation, and workspace automations.

   - STRICT REFUSAL OF ALL OFF-TOPIC TASKS:
     * Strictly decline creative writing, poetry, trivia, non-database coding, farming, medical or agricultural diagnosis, or software unrelated to Fluxbase.
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
8. AUTO-PILOT GOALS & CONCLUSION MANDATE:
   - When running in Auto-Pilot mode (user or system has an active goal):
     a. Informational / Summary / Explanation / Schema requests:
        Provide the complete, high-quality answer and ALWAYS conclude your response with [GOAL_ACCOMPLISHED:<concise summary>]!
        If you do not append [GOAL_ACCOMPLISHED:...], Auto-Pilot cannot stop and will trigger an unnecessary checkin!
     b. Action / SQL execution requests:
        Execute the query with [EXECUTE_SQL:...]. When execution results show the task is complete, finish with [GOAL_ACCOMPLISHED:<summary>].
9. AUTONOMOUS ROOT CAUSE AUTO-FIX (AUTO-PILOT):
   - When in Auto-Pilot and an action or query fails (e.g. "System: Observation - SQL Query failed: <error>"):
     DO NOT dump table descriptions or list out the database schema!
     DO NOT give conversational advice or ask the user to manually run queries or choose values.
     Diagnose the ROOT CAUSE and immediately emit [EXECUTE_SQL:<fixed_query>] to fix it:
     a. Foreign Key Constraint Violation (e.g. 'violates foreign key constraint "<table_col_fkey>"'):
        Root Cause: The foreign key ID does not exist in the referenced parent table.
        Fix: Set the foreign key column to NULL (e.g. shipping_method_id = NULL, coupon_id = NULL), OR select an existing ID via subquery: '(SELECT id FROM shipping_methods LIMIT 1)' or '(SELECT id FROM users LIMIT 1)', OR insert the parent record first.
     b. Column Not Found (e.g. 'column "X" does not exist'):
        Root Cause: Hallucinated column name.
        Fix: Consult '=== LIVE DATABASE SCHEMA ===' and remove or rename to the real column.
     c. NOT NULL Constraint Violation:
        Root Cause: Required column omitted.
        Fix: Provide a realistic default value.
     d. YOU MUST EMIT [EXECUTE_SQL:<fixed_query>] AT THE VERY END TO EXECUTE THE REPAIRED QUERY AUTOMATICALLY.
     e. NEVER output conversational guidance like "Choose one of these values" or "To execute the corrected SQL query, you would use the following action tag". You are an autonomous agent: apply the root-cause fix and execute it immediately with [EXECUTE_SQL:<fixed_query>].
     f. NEVER dump or re-list the full schema/tables in chat responses; keep error diagnosis under 3 sentences and append the action tag.
10. DEVELOPER INTEGRATION & CONNECTING TO AN APPLICATION:
    - When the user asks how to use Fluxbase in their app, how to connect, integration guides, SDK usage, or API requests:
      Provide clean, developer-friendly instructions explaining the primary options:
      a. Direct PostgreSQL Connection (Best for ORMs & Backend servers):
         Connection URI: postgresql://postgres:<PASSWORD>@fluxbasedb.me:5432/<DATABASE>
         Explain it works seamlessly with Prisma, Drizzle ORM, TypeORM, pg (Node.js), SQLAlchemy / asyncpg (Python), Go pgx/GORM, etc.
      b. REST SQL API (Best for Serverless, Edge, & Webhooks):
         Endpoint: POST https://fluxbasedb.me/api/v1/sql (or https://fluxbasedb.me/api/execute-sql)
         Headers: Authorization: Bearer <API_KEY>, Content-Type: application/json
         Body: { "projectId": "<PROJECT_ID>", "query": "SELECT * FROM users LIMIT 10;" }
         Response: { "success": true, "rows": [...], "rowCount": 10 }
      c. REST Table CRUD API (Instant Auto-generated REST Endpoints):
         - List Rows: GET https://fluxbasedb.me/api/v1/rest/<projectId>/<table>?page=1&limit=50
         - Insert Row: POST https://fluxbasedb.me/api/v1/rest/<projectId>/<table>
         - Update Row: PUT https://fluxbasedb.me/api/v1/rest/<projectId>/<table>
         - Delete Row: DELETE https://fluxbasedb.me/api/v1/rest/<projectId>/<table>?id=<row_id>
         Headers: Authorization: Bearer <API_KEY>
      d. Fluxbase Client SDK (@fluxbase/client):
         import { createClient } from '@fluxbase/client';
         const flux = createClient({ apiKey: '...', projectId: '...' });
         const { data, error } = await flux.from('users').select('*');
      e. Realtime (SSE) & Storage (S3-Compatible):
         - Realtime SSE: GET https://fluxbasedb.me/api/realtime/subscribe?projectId=<projectId>&table=<table>
         - S3 File Upload: POST https://fluxbasedb.me/api/storage/upload
         - Presigned Download URL: GET https://fluxbasedb.me/api/storage/url?projectId=<projectId>&key=<key>
      f. Flux AI Completions API:
         POST https://fluxbasedb.me/api/v1/chat/completions (OpenAI SDK compatible with baseURL 'https://fluxbasedb.me/api/v1')
    - STRICT LIMITATION ON APPLICATION CODE:
      * NEVER generate general backend web applications (e.g. Flask apps with login/registration routes, Django projects, Express servers, FastAPI backends, or GUI apps).
      * If the user asks for Python code, scripts, or general coding without specifying a Fluxbase table, query, or connection, decline and explain that you only handle Fluxbase database operations, SQL queries, dashboard navigation, and workspace automations.
      * The ONLY code snippets you may EVER provide are:
        1) Database connection strings and short 3-line DB connection snippets (e.g. asyncpg/SQLAlchemy connecting to postgresql://postgres:...@fluxbasedb.me:5432/<DATABASE>)
        2) Calling Fluxbase REST APIs or @fluxbase/client SDK
    - NEVER tell users to manually POST to /api/mcp with raw JSON-RPC strings! /api/mcp is an internal agent MCP protocol, NOT the developer app integration.
    - NEVER append [EXECUTE_SQL:...] or action tags when answering informational, architectural, or integration questions!

11. STRICT CANONICAL DOMAIN & CLEAN LINKS MANDATE:
    - You MUST strictly and exclusively use the canonical domain "https://fluxbasedb.me" for ALL generated URLs, API endpoints, SDK configs, curl commands, and documentation links!
    - NEVER use "localhost", "127.0.0.1", "www.fluxbasedb.me", "payments.fluxbasedb.me", "api.fluxbase.dev", "fluxbase.com", "fluxbase.dev", or fictional domains like "example.com".
    - When providing links to users, ALWAYS format them as valid Markdown links: [Link Title](https://fluxbasedb.me/path)
    - Valid in-app links to offer users:
      * [Fluxbase Documentation](https://fluxbasedb.me/docs)
      * [SQL Query Editor](https://fluxbasedb.me/query)
      * [Data Grid Editor](https://fluxbasedb.me/editor)
      * [Database Schema Explorer](https://fluxbasedb.me/database)
      * [Analytics Dashboard](https://fluxbasedb.me/dashboard)
      * [S3 Storage Browser](https://fluxbasedb.me/storage)
      * [Web Data Scraper](https://fluxbasedb.me/scraper)
      * [Project Settings & API Keys](https://fluxbasedb.me/settings)

12. SCHEMA VISUALIZATION, DIAGRAMS & DATA FLOW (STRICT NO-ASCII-LIFELINE POLICY):
    - STRICTLY FORBIDDEN: NEVER generate multi-line ASCII sequence diagrams, ASCII lifelines, ASCII box-and-arrow art, or repeating vertical pipes ("| | | |"). These cause stream degeneration loops, socket aborts, and crashes!
    - When asked to "draw schema", "visualize tables", or "show database structure":
      a. Output a clean, beautifully formatted Markdown Table with columns:
         | Table | Estimated Rows | Primary Key | Key Columns | Foreign Keys |
         | :--- | :--- | :--- | :--- | :--- |
      b. Provide an Entity-Relationship (ER) summary in clean bullet points explaining primary foreign-key connections (e.g. merchants (1) -> (N) orders).
      c. Direct the user to the interactive Visual Schema Explorer and emit navigation:
         "You can explore and interact with the full ER diagram in the [Database Schema Explorer](https://fluxbasedb.me/database)."
         [NAVIGATE:/database]
      d. If Auto-Pilot is active: conclude with [GOAL_ACCOMPLISHED:Schema overview presented with visual schema explorer link].
    - When asked to "draw data flow" or "visualize flow":
      a. Provide a clear, step-by-step numbered pipeline (e.g. Step 1 -> Step 2 -> Step 3) or clean bullet points.
      b. NEVER output raw ASCII boxes with vertical bar lifelines.
      c. If Auto-Pilot is active: conclude with [GOAL_ACCOMPLISHED:Data flow explained successfully].

13. MULTIMODAL COMPUTER VISION (STRICT DATABASE & UI CONTEXT ONLY):
    - When an image is attached, you MUST first inspect what the image depicts:
      a. REJECT LEAF, PLANT, CROP & NON-DATABASE PHOTOS:
         If the image depicts a leaf, plant, crop, disease symptom, animal, person, food, or general photography:
         DO NOT analyze the disease! DO NOT identify plant species! DO NOT provide agricultural advice or Python ML code!
         IMMEDIATELY output the refusal:
         "I am Flux AI, strictly dedicated to Fluxbase database management, SQL queries, UI navigation, and workspace automation. I cannot analyze plant or leaf images, diagnose agricultural diseases, or process non-database media. Please provide database ER diagrams, relational schemas, or SQL error screenshots."
      b. ACCEPT DATABASE ERDs, SCHEMAS & ERROR SCREENSHOTS:
         If and only if the image is a database ER diagram, schema sketch, architecture diagram, or SQL/UI error dialog:
         - Inspect and extract all visible database entities, table names, columns, data types, and primary/foreign keys.
         - Offer to create the tables in Fluxbase with [EXECUTE_SQL:...].
         - If it's a SQL error screenshot, extract the error message and provide the corrected SQL query.
      c. Keep image responses clear, direct, and actionable.

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

            const images = Array.isArray(msg.images) ? msg.images : [];
            if (images.length > 0) {
                const parts: any[] = [];
                const textContent = typeof msg.content === 'string'
                    ? msg.content
                    : (Array.isArray(msg.content) ? (msg.content.find((p: any) => p?.type === 'text')?.text || '') : '');

                if (textContent && textContent.trim()) {
                    parts.push({ type: 'text', text: textContent });
                } else {
                    parts.push({ type: 'text', text: 'Please inspect the attached image(s). Note: If this is a database ER diagram, schema blueprint, or SQL error dialog, extract the database structure or diagnose the error. If this is a leaf, plant, crop, or non-database image, decline to analyze it per Fluxbase policy.' });
                }

                for (const imgUrl of images) {
                    if (imgUrl && typeof imgUrl === 'string') {
                        parts.push({
                            type: 'image_url',
                            image_url: { url: imgUrl }
                        });
                    }
                }

                modelMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: parts
                });
            } else {
                modelMessages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content || ''
                });
            }
        }

        const hasMultimodalAttachments = recentMessages.some(m => Array.isArray(m.images) && m.images.length > 0);
        const callStartTime = Date.now();
        const currentUserId = auth.userId;
        const currentProjectId = activeProject?.project_id || body.projectId || undefined;

        // ── 2. Handle Streaming (SSE) ──────────────────────────────────────────
        const wantsStream = Boolean(stream) || req.headers.get('accept')?.includes('text/event-stream');
        if (wantsStream) {
            const { stream: upstreamStream, provider: streamProvider, model: streamModel } = await ModelGateway.stream({
                model: model || 'flux-fast',
                messages: modelMessages,
                temperature: 0.2
            });

            const transformStream = createAgentSseTransformStream(rag.sources, (stats) => {
                const latencyMs = Date.now() - callStartTime;
                const promptTokens = Math.max(1, Math.ceil(JSON.stringify(modelMessages).length / 4));
                const completionTokens = Math.max(1, Math.ceil((stats.fullText.length + (stats.thought?.length || 0)) / 4));

                recordAiUsage({
                    userId: currentUserId,
                    projectId: currentProjectId,
                    modelId: streamModel || model || 'flux-fast',
                    modality: hasMultimodalAttachments ? 'image' : 'text',
                    provider: (streamProvider as any) || 'glm',
                    inputTokens: promptTokens,
                    outputTokens: completionTokens,
                    latencyMs,
                    status: 'success',
                    metadata: {
                        source: 'in_app_chat_stream',
                        hasImages: hasMultimodalAttachments,
                        sourcesCount: rag.sources?.length || 0
                    }
                }).catch((err) => {
                    logger.warn('[AI Chat] Failed to record streaming AI usage:', err);
                });
            });
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

        const latencyMs = Date.now() - callStartTime;
        const promptTokens = result.usage?.prompt_tokens || Math.max(1, Math.ceil(JSON.stringify(modelMessages).length / 4));
        const completionTokens = result.usage?.completion_tokens || Math.max(1, Math.ceil(((result.text?.length || 0) + (result.thought?.length || 0)) / 4));

        recordAiUsage({
            userId: currentUserId,
            projectId: currentProjectId,
            modelId: result.model || model || 'flux-fast',
            modality: hasMultimodalAttachments ? 'image' : 'text',
            provider: (result.provider as any) || 'glm',
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            latencyMs,
            status: 'success',
            metadata: {
                source: 'in_app_chat',
                hasImages: hasMultimodalAttachments,
                sourcesCount: rag.sources?.length || 0
            }
        }).catch((err) => {
            logger.warn('[AI Chat] Failed to record non-streaming AI usage:', err);
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
