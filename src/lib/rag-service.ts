import fs from 'fs';
import path from 'path';
import logger from '@/lib/logger';
import { getRelevantErrorLessons, formatLessonsForPrompt } from '@/lib/ai-memory';

export interface RagDocChunk {
    id: string;
    source: string;
    title: string;
    content: string;
    keywords: string[];
}

export interface RagContextResult {
    schemaSnippet: string;
    docSnippet: string;
    errorMemorySnippet: string;
    sources: string[];
}

// ── In-Memory Document Knowledge Base ────────────────────────────────────────

const STATIC_DOC_CHUNKS: RagDocChunk[] = [
    {
        id: 'fluxbase_app_scope_rules',
        source: 'Operating Rules',
        title: 'Fluxbase Application-Specific Operating Rules & Scope Guardrails (4 Core Pillars)',
        content: `STRICT APPLICATION-SPECIFIC OPERATING RULES (4 CORE PILLARS ONLY):
1. EXCLUSIVE FLUXBASE SCOPE (FOUR PERMITTED PILLARS ONLY):
   - You are strictly the dedicated intelligence engine, database architect, and technical co-pilot for FLUXBASE (https://fluxbasedb.me).
   - You must ONLY generate responses that belong strictly to the 4 Core Pillars:
     1) FLUXBASE OPERATIONS: Database tables, schema DDL, columns, foreign keys, indexes, AWS S3 storage buckets, file uploads, webhooks, API keys, project configurations, and settings.
     2) QUERY: Writing, optimizing, explaining, diagnosing, and executing PostgreSQL and MySQL queries via [EXECUTE_SQL:...], analyzing explain plans, and generating visual analytics charts.
     3) NAVIGATION: Teleporting the user across Fluxbase dashboard pages via [NAVIGATE:/path], clicking UI buttons via [CLICK:<label>], and typing form inputs via [TYPE:<val>:<input>].
     4) AUTOMATION TASKS: Auto-Pilot multi-step database workflows, high-speed set-based mock data seeding via generate_series, table triggers, web scraper ingestion into database tables, and goal completion via [GOAL_ACCOMPLISHED:<summary>].

2. ABSOLUTE PROHIBITION ON LEAF/PLANT & NON-DATABASE IMAGES:
   - Multimodal vision is strictly reserved for database ER diagrams, relational schemas, architecture blueprints, and SQL/UI error screenshots.
   - NEVER analyze photos of leaves, plants, crops, diseases, or general photography. If a user uploads a leaf or plant image, decline immediately:
     "I am Flux AI, strictly dedicated to Fluxbase database management, SQL queries, UI navigation, and workspace automation. I cannot analyze plant or leaf images, diagnose agricultural diseases, or process non-database media. Please provide database ER diagrams, relational schemas, or SQL error screenshots."

3. ABSOLUTE PROHIBITION ON STANDALONE / GENERAL PYTHON SCRIPTS:
   - NEVER generate general Python scripts, machine learning models, leaf disease classifiers, OpenCV image processing, PyTorch, TensorFlow, or non-Fluxbase software.
   - The ONLY permitted Python code is connecting to Fluxbase via SDK or direct PostgreSQL connection URIs (e.g. psycopg2, asyncpg, SQLAlchemy).

4. REFUSAL OF UNRELATED / OFF-TOPIC QUERIES:
   - If the user asks general questions unrelated to Fluxbase (e.g., leaf diseases, agriculture, cooking recipes, creative writing, political discussions, general trivia, weather, or non-database coding), you MUST politely decline:
     "I am Flux AI, the specialized database architect and developer assistant for Fluxbase. I can only assist with Fluxbase platform operations, database queries, SQL architecture, storage, webhooks, and integrating your applications with Fluxbase. How can I help you with your Fluxbase workspace today?"

5. FLUXBASE-NATIVE SOLUTIONS & CANONICAL DOMAIN:
   - Always formulate developer solutions using Fluxbase primitives: PostgreSQL/MySQL direct connections, @fluxbase/client SDK, Fluxbase REST SQL (/api/v1/sql), Fluxbase Table CRUD (/api/v1/rest/...), Fluxbase S3 Storage (/api/storage/...), and Fluxbase Realtime SSE (/api/realtime/subscribe).
   - Strictly and exclusively use https://fluxbasedb.me for all endpoints, docs, links, and code snippets.`,
        keywords: ['rules', 'scope', 'app specific', 'guardrails', 'fluxbase rules', 'system rules', 'who are you', 'capabilities', 'off topic', 'refusal', 'app-specific', 'policy', 'leaf', 'python', 'disease', 'vision', 'pillars']
    },
    {
        id: 'fluxbase_master_architecture',
        source: 'System Architecture',
        title: 'Fluxbase Infrastructure, Microservices & Network Topology',
        content: `FLUXBASE ARCHITECTURAL SPECIFICATION:
- Production Domain: https://fluxbasedb.me (Port 80/443, Caddy 2 Reverse Proxy with Let's Encrypt TLS & HTTP/3 QUIC).
- Server Environment: AWS EC2 Graviton t4g.large (2 vCPU, 8 GB RAM, ap-south-1 Mumbai, IP: 13.206.125.88).
- Docker Microservices (Internal Network: fluxbase-network):
  1. fluxbase-app (Port 3000): Next.js 15.5 App Router standalone web app, SQL REST execution engine, Table CRUD, auth, MCP gateway.
  2. fluxbase-websocket (Port 4000, mapped to /ws*): Real-time WebSocket gateway listening to PostgreSQL LISTEN flux_realtime triggers.
  3. fluxbase-redis (Port 6379): Redis 7 Alpine, LRU cache (512MB limit), rate limiting, query caching.
  4. fluxbase-proxy (Ports 80/443): Caddy 2 reverse proxy with automatic SSL for fluxbasedb.me and payments.fluxbasedb.me.
  5. fluxbase-scraper-engine (Port 8080): Headless Playwright autonomous web scraper engine.
  6. fluxbase-gateway (Port 3001, payments.fluxbasedb.me): FluxPay hosted UPI payment gateway, QR codes, bank SMS webhook ingestion.
- AWS Cloud Infrastructure:
  - Primary RDS: PostgreSQL 17.9 (fluxbase-master-db-new).
  - Multi-Tenant RDS: MySQL 8.4.8 (database-1-new).
  - Object Storage: Amazon S3 (fluxbase-storage) with 15-min presigned URLs.
  - Transactional Email: Amazon SES (support@fluxbasedb.me).
  - DNS: AWS Route 53 Public Hosted Zone (Z00637411I9ALMVMC5GBN).`,
        keywords: ['architecture', 'infrastructure', 'services', 'docker', 'caddy', 'ports', 'aws', 'rds', 'ec2', 'topology', 'microservices', 'production', 'server']
    },
    {
        id: 'fluxbase_database_engines_full',
        source: 'Database Guide',
        title: 'PostgreSQL 17 & MySQL 8 Multi-Tenant Database Engines',
        content: `DATABASE ENGINES & DIRECT CONNECTIONS:
1. PostgreSQL 17.9 (Primary Enterprise Dialect):
   - Port: 5432
   - Connection URI: postgresql://postgres:<PASSWORD>@fluxbasedb.me:5432/<DATABASE_NAME>
   - Multi-Tenant Isolation: Each project is isolated in its dedicated PostgreSQL schema named 'flux_tenant_<projectId>'.
   - Automatic Search Path: Queries and client connections automatically search 'flux_tenant_<projectId>, public'.
   - Capabilities: Full support for JSONB, Generated Columns, Triggers, Views, Foreign Keys, LISTEN/NOTIFY, UUIDs, Full-Text Search.
2. MySQL 8.4.8 (High-Throughput Relational Dialect):
   - Port: 3306
   - Connection URI: mysql://user:<PASSWORD>@fluxbasedb.me:3306/<DATABASE_NAME>
   - Dedicated MySQL tenant databases with InnoDB engine.
3. ORM & Language Connection Recipes:
   - Prisma (schema.prisma):
     datasource db {
       provider = "postgresql"
       url      = env("DATABASE_URL")
     }
   - Drizzle ORM:
     import { drizzle } from 'drizzle-orm/postgres-js';
     import postgres from 'postgres';
     const db = drizzle(postgres(process.env.DATABASE_URL));
   - Node.js pg:
     import { Pool } from 'pg';
     const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
   - Python (SQLAlchemy + asyncpg):
     from sqlalchemy.ext.asyncio import create_async_engine
     engine = create_async_engine("postgresql+asyncpg://postgres:PASS@fluxbasedb.me:5432/DB")
   - Go (pgx):
     conn, err := pgx.Connect(context.Background(), "postgres://postgres:PASS@fluxbasedb.me:5432/DB")`,
        keywords: ['postgresql', 'mysql', 'database', 'connection', 'connection string', 'prisma', 'drizzle', 'typeorm', 'sqlalchemy', 'asyncpg', 'pgx', 'schema', 'tenant', 'flux_tenant', 'search_path', 'orm']
    },
    {
        id: 'fluxbase_rest_and_crud_api',
        source: 'API Reference',
        title: 'Fluxbase REST SQL & Auto-Generated Table CRUD APIs',
        content: `REST & CRUD API SPECIFICATION:
1. REST SQL Endpoint (Parameterized & Raw Query Execution):
   - URL: POST https://fluxbasedb.me/api/v1/sql (or /api/execute-sql)
   - Headers:
     Authorization: Bearer <FLUX_API_KEY>
     Content-Type: application/json
   - Request Body:
     {
       "projectId": "<PROJECT_UUID>",
       "query": "SELECT id, name, email FROM users WHERE status = $1 LIMIT 50;",
       "params": ["active"]
     }
   - Response: { "success": true, "columns": ["id", "name", "email"], "rows": [...], "rowCount": 50 }

2. Instant Auto-Generated Table CRUD Endpoints:
   - List Rows: GET https://fluxbasedb.me/api/v1/rest/<projectId>/<table>?page=1&limit=50&sort=created_at&order=desc
   - Insert Row: POST https://fluxbasedb.me/api/v1/rest/<projectId>/<table>
     Body: { "name": "Jane Doe", "email": "jane@example.com" }
   - Update Row: PUT https://fluxbasedb.me/api/v1/rest/<projectId>/<table>
     Body: { "id": "123", "name": "Jane Smith" }
   - Delete Row: DELETE https://fluxbasedb.me/api/v1/rest/<projectId>/<table>?id=123
   - All CRUD endpoints require 'Authorization: Bearer <API_KEY>' and enforce project row limits and tenant boundaries.`,
        keywords: ['rest', 'crud', 'api', 'execute-sql', 'sql api', 'rest api', 'endpoints', 'insert row', 'delete row', 'update row', 'table api', 'table crud']
    },
    {
        id: 'fluxbase_client_sdk_full',
        source: 'SDK Reference',
        title: 'Fluxbase Client SDK (@fluxbase/client & Python Client)',
        content: `FLUXBASE CLIENT SDK REFERENCE:
1. TypeScript / JavaScript Installation:
   npm install @fluxbase/client
2. Client Initialization:
   import { createClient } from '@fluxbase/client';
   const flux = createClient({
     apiKey: process.env.FLUX_API_KEY,
     projectId: process.env.FLUX_PROJECT_ID,
     endpoint: 'https://fluxbasedb.me'
   });
3. Querying Tables:
   const { data, error } = await flux
     .from('users')
     .select('id, name, email, created_at')
     .eq('status', 'active')
     .order('created_at', { ascending: false })
     .limit(25);
4. Mutation Methods:
   - Insert: await flux.from('orders').insert({ customer_id: 'c1', total: 49.99 });
   - Update: await flux.from('users').update({ role: 'admin' }).eq('id', 'u123');
   - Delete: await flux.from('logs').delete().lt('created_at', '2026-01-01');
5. Realtime Subscriptions via SDK:
   const subscription = flux
     .from('notifications')
     .on('INSERT', (payload) => console.log('New notification:', payload.record))
     .subscribe();
6. Python Client:
   from fluxbase import FluxbaseClient
   flux = FluxbaseClient(api_key="flx_live_...", project_id="...")
   users = flux.table("users").select("*").limit(20).execute()`,
        keywords: ['sdk', 'client', '@fluxbase/client', 'javascript', 'typescript', 'python', 'npm', 'createclient', 'from', 'select', 'insert', 'mutation']
    },
    {
        id: 'fluxbase_storage_engine_v2',
        source: 'Storage Guide',
        title: 'AWS S3 File Storage Engine, Presigned URLs & Quotas',
        content: `FLUXBASE FILE STORAGE V2 (AWS S3-BACKED):
- Architecture: Backed by Amazon S3 ('fluxbase-storage') in ap-south-1 with private-by-default access and multi-tenant project isolation.
- File Upload:
  POST https://fluxbasedb.me/api/storage/upload
  Content-Type: multipart/form-data
  Fields:
    file: <binary>
    projectId: <UUID>
    bucketId: <optional bucket name, defaults to 'default'>
  Response: { "success": true, "key": "...", "url": "...", "size": 1048576, "mimeType": "image/png" }
- Presigned Download URL (15-Minute Expiry):
  GET https://fluxbasedb.me/api/storage/url?projectId=<UUID>&key=<s3Key>
  Response: { "url": "https://fluxbase-storage.s3.ap-south-1.amazonaws.com/..." }
- List Files & Buckets:
  GET https://fluxbasedb.me/api/storage/files?projectId=<UUID>
  GET https://fluxbasedb.me/api/storage/buckets?projectId=<UUID>
- Plan Storage Quotas:
  - Free: 1 GB total storage
  - Pro: 10 GB total storage
  - Max: 100 GB total storage
  - Pay-As-You-Go / Unlimited: 500 GB total storage`,
        keywords: ['storage', 's3', 'upload', 'presigned', 'download', 'bucket', 'file', 'files', 'image', 'assets', 'quotas', 'storage limits']
    },
    {
        id: 'fluxbase_realtime_and_websockets',
        source: 'Realtime Guide',
        title: 'Real-Time SSE, WebSockets & Database Mutation Broadcasts',
        content: `FLUXBASE REAL-TIME EVENT STREAMING:
1. Server-Sent Events (SSE):
   - Endpoint: GET https://fluxbasedb.me/api/realtime/subscribe?projectId=<UUID>&table=<TABLE_NAME>
   - Header: Accept: text/event-stream
   - Event Types:
     - event: INSERT -> data: { "type": "INSERT", "table": "orders", "record": {...} }
     - event: UPDATE -> data: { "type": "UPDATE", "table": "orders", "record": {...}, "old": {...} }
     - event: DELETE -> data: { "type": "DELETE", "table": "orders", "id": "..." }
2. Real-Time WebSocket Gateway:
   - WebSocket URL: wss://fluxbasedb.me/ws
   - Sub-second latency powered by 'fluxbase-websocket' container on port 4000.
   - Internal Mechanism: PostgreSQL triggers invoke 'pg_notify('flux_realtime', payload)'. The standalone WebSocket server listens to 'flux_realtime', publishes to Redis channels, and fans out directly to connected client sockets.`,
        keywords: ['realtime', 'sse', 'websocket', 'wss', 'eventsource', 'subscribe', 'stream', 'live updates', 'listeners', 'triggers', 'mutation']
    },
    {
        id: 'fluxbase_ai_and_vision_gateway',
        source: 'AI Gateway Reference',
        title: 'Flux AI Multimodal Gateway, Computer Vision & Models',
        content: `FLUX AI MULTIMODAL GATEWAY:
- Production Base URL: https://fluxbasedb.me/api/v1
- OpenAI SDK Parity: Use standard OpenAI SDK by changing baseURL to 'https://fluxbasedb.me/api/v1' and setting your Fluxbase API Key as api_key.
  Example:
  import OpenAI from 'openai';
  const client = new OpenAI({ baseURL: 'https://fluxbasedb.me/api/v1', apiKey: process.env.FLUX_API_KEY });
  const res = await client.chat.completions.create({ model: 'flux', messages: [{ role: 'user', content: 'Explain schema' }] });
- Model Catalog:
  - 'flux' (Default): General reasoning, SQL generation (GLM-4 Flash / Groq)
  - 'flux-flash': Fast autocomplete, low latency
  - 'flux-pro': Complex schema design, JSON mode
  - 'flux-ultra': Deep reasoning, multi-step system audits (GLM-4 Plus)
  - 'flux-omni': Multimodal vision, image analysis (Gemini 2.0 Flash)
- Multimodal Computer Vision:
  Supports uploading ERD diagrams, schema whiteboard sketches, system architectures, and error dialog screenshots. The vision pipeline uses 'glm-4v-flash' to automatically extract database entities, columns, primary/foreign keys, and diagnose SQL errors.`,
        keywords: ['ai', 'flux ai', 'gateway', 'openai', 'models', 'vision', 'multimodal', 'glm-4', 'gemini', 'chat completions', 'embeddings', 'images']
    },
    {
        id: 'fluxbase_mcp_server_reference',
        source: 'MCP Protocol Reference',
        title: 'Fluxbase Model Context Protocol (MCP) Server for Agents',
        content: `FLUXBASE MODEL CONTEXT PROTOCOL (MCP) SERVER:
- Gateway Endpoint: https://fluxbasedb.me/api/mcp
- Protocol: JSON-RPC 2.0
- Integration: Compatible with Cursor, Claude Desktop, Windsurf, and custom autonomous agents.
- Core MCP Tools:
  1. create_project: { projectName, dialect: "postgresql" | "mysql", userRole?, description? }
  2. list_projects: {}
  3. get_schema: { projectId }
  4. run_sql: { projectId, query }
- Security: MCP Guard intercepts incoming tool calls and verifies workspace API permissions.`,
        keywords: ['mcp', 'model context protocol', 'cursor', 'claude desktop', 'mcp server', 'json-rpc', 'agent tools', 'mcp tools']
    },
    {
        id: 'fluxbase_fluxpay_payment_gateway',
        source: 'FluxPay Payment Guide',
        title: 'FluxPay Automated UPI Payment Gateway & Checkout Engine',
        content: `FLUXPAY PAYMENT GATEWAY SPECIFICATION:
- Production Subdomain: https://payments.fluxbasedb.me
- Architecture: Autonomous UPI payment gateway container ('fluxbase-gateway' on port 3001).
- Key Features:
  1. Instant UPI Dynamic QR generation via slot-engine (allocateSlot with 90-second atomic TTL).
  2. Automated Bank SMS Webhook Parser: POST https://payments.fluxbasedb.me/api/v1/webhook/incoming parses bank SMS UTR references and matches orders instantaneously.
  3. Hosted Checkout Pages: https://payments.fluxbasedb.me/pay/<orderId> and payment links /pay/link/<linkId>.
  4. Merchant Portal: /dashboard/apikeys, /dashboard/links, /dashboard/coupons, /dashboard/withdrawals.
  5. Multi-Tenant Settlements: Instant payout tracking, UTR matching, and automated balance ledger.`,
        keywords: ['fluxpay', 'payment', 'gateway', 'upi', 'qr code', 'checkout', 'merchant', 'orders', 'sms webhook', 'settlements', 'payout']
    },
    {
        id: 'fluxbase_web_scraper_engine',
        source: 'Scraper Guide',
        title: 'Headless Playwright Web Scraper Engine',
        content: `FLUXBASE HEADLESS WEB SCRAPER ENGINE:
- Container: fluxbase-scraper-engine on port 8080 (node:20-bookworm-slim with Chromium).
- Capabilities: Autonomous web page crawling, JavaScript rendering, CSS selector and XPath extraction.
- Database Integration: Extracted records are automatically structured and inserted into designated project tables.
- Web Console: Configurable directly from https://fluxbasedb.me/scraper with scheduled cron runs and execution status monitors.`,
        keywords: ['scraper', 'web scraper', 'playwright', 'crawling', 'extraction', 'scraping', 'automation', 'crawler']
    },
    {
        id: 'fluxbase_plans_billing_and_meters',
        source: 'Billing Reference',
        title: 'Subscription Plans, Resource Quotas & PAYG Ledger',
        content: `FLUXBASE PLANS & RESOURCE QUOTAS:
- Free Tier ($0/mo): 1 Project, 500 MB Database, 1 GB Storage, 50,000 API calls/month, community support.
- Pro Tier ($29/mo): 5 Projects, 5 GB Database, 10 GB Storage, 500,000 API calls/month, priority email support.
- Max Tier ($99/mo): 20 Projects, 25 GB Database, 100 GB Storage, 5,000,000 API calls/month, 24/7 dedicated support.
- Pay-As-You-Go (PAYG) & Unlimited Tier:
  - Unlimited access for 'employee', 'org_owner', and 'pay_as_you_go' subscriptions.
  - Dynamically tracked via high-performance Redis cache with RDS checkpointing.
  - Itemized real-time API Bills and resource meters accessible directly in [Project Settings](https://fluxbasedb.me/settings).`,
        keywords: ['pricing', 'plans', 'billing', 'quota', 'free', 'pro', 'max', 'payg', 'pay-as-you-go', 'bills', 'api calls', 'meters', 'limits']
    },
    {
        id: 'fluxbase_navigation_and_actions',
        source: 'Navigation & Action Guide',
        title: 'In-App Navigation Map & Agentic Action Tags',
        content: `FLUXBASE IN-APP NAVIGATION & ACTION PROTOCOL:
1. Canonical Navigation Routes:
   - [Fluxbase Home](https://fluxbasedb.me/) - Platform overview
   - [Analytics Dashboard](https://fluxbasedb.me/dashboard) - Queries, latency, API throughput
   - [Project Switcher & Manager](https://fluxbasedb.me/dashboard/projects) - Create/manage databases
   - [Data Grid Editor](https://fluxbasedb.me/editor) - Spreadsheet-style table view & row mutations
   - [SQL Query Editor](https://fluxbasedb.me/query) - Monaco IDE with query history and explain plans
   - [Database Schema Explorer](https://fluxbasedb.me/database) - Visual ER diagrams, foreign keys
   - [S3 Storage Browser](https://fluxbasedb.me/storage) - Bucket explorer and file uploader
   - [Web Data Scraper](https://fluxbasedb.me/scraper) - Autonomous scraper manager
   - [Fluxbase Documentation](https://fluxbasedb.me/docs) - API and SDK guides
   - [Project Settings & API Keys](https://fluxbasedb.me/settings) - Manage keys, webhooks, bills
2. Agentic Action Tags:
   - SQL Execution: [EXECUTE_SQL:<exact_sql_query>]
   - Destructive Operations: [REQUEST_APPROVAL:appr_<id>:EXECUTE_SQL:<summary>:<sql>]
   - Data Visualizations: [RENDER_CHART:{"type":"bar"|"line"|"pie"|"area","title":"...","data":[...],"xKey":"...","yKey":"..."}]
   - Navigation: [NAVIGATE:/path]
   - Button Click: [CLICK:<label>]
   - Form Fill: [TYPE:<value>:<input_name>]
   - Goal Conclusion: [GOAL_ACCOMPLISHED:<summary>]`,
        keywords: ['navigation', 'routes', 'pages', 'actions', 'action tags', 'navigate', 'click', 'type', 'execute_sql', 'render_chart', 'sitemap']
    },
    {
        id: 'foreign_keys_and_relations',
        source: 'Database Best Practices',
        title: 'Relationships and Foreign Keys in PostgreSQL / MySQL',
        content: `To find tables with zero foreign keys or zero relations:
In PostgreSQL:
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
AND table_name NOT IN (
    SELECT DISTINCT tc.table_name FROM information_schema.table_constraints tc WHERE tc.constraint_type = 'FOREIGN KEY'
)
AND table_name NOT IN (
    SELECT DISTINCT ccu.table_name FROM information_schema.constraint_column_usage ccu
    JOIN information_schema.table_constraints tc ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
);

In MySQL:
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
AND TABLE_NAME NOT IN (
    SELECT DISTINCT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL
)
AND TABLE_NAME NOT IN (
    SELECT DISTINCT REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL
);`,
        keywords: ['relation', 'relations', 'foreign key', 'fk', 'useless', 'zero relations', 'constraints', 'table_constraints', 'orphaned', 'isolated']
    },
    {
        id: 'table_row_counts',
        source: 'Database Best Practices',
        title: 'Querying Table Row Counts in PostgreSQL vs MySQL',
        content: `CRITICAL CATALOG RULES FOR ROW COUNTS:
NEVER query 'COUNT(*) FROM information_schema.tables'! That query is WRONG and will return 1 for every table because it only counts the metadata catalog definition entry, NOT the actual table rows.

In PostgreSQL:
- Accurate live row counts are ALREADY provided for each table in "=== LIVE DATABASE SCHEMA ===" (e.g. "- predictions (~619,430 rows): [...]", "- candles_1m (52,142 rows): [...]"). Use these counts directly!
- If executing SQL to query or refresh table row counts, use pg_class:
  SELECT c.relname AS table_name, GREATEST(0, c.reltuples::bigint) AS row_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE (n.nspname = current_schema() OR n.nspname = 'public') AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE '_flux_%'
  ORDER BY row_count DESC;
- Or exact counts per table: SELECT COUNT(*) FROM "tableName";

In MySQL:
- 'information_schema.TABLES' contains TABLE_ROWS:
  SELECT TABLE_NAME AS table_name, COALESCE(TABLE_ROWS, 0) AS row_count
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE '_flux_%'
  ORDER BY TABLE_NAME;`,
        keywords: ['row count', 'count', 'row_count', 'rows', 'table count', 'how many rows', 'n_live_tup', 'table_rows', 'counts', 'rows inside it', 'record count', 'records']
    },
    {
        id: 'balance_changes_and_lag',
        source: 'Database Best Practices',
        title: 'Comparing Row Values and Balance Changes with LAG() Window Functions',
        content: `In tables like 'predictions', there is NO 'previous_balance' column!
To detect balance changes between consecutive records, use the PostgreSQL LAG() window function:
WITH balance_diff AS (
    SELECT 
        id, timestamp, symbol, price, balance,
        LAG(balance) OVER (ORDER BY id) AS prev_balance
    FROM predictions
)
SELECT 
    id, timestamp, symbol, price, balance, prev_balance,
    ROUND((balance - prev_balance)::numeric, 2) AS rupee_change
FROM balance_diff
WHERE prev_balance IS NOT NULL
  AND ABS(balance - prev_balance) >= 1.0
ORDER BY id;

Note on paisa vs whole rupee:
- "paisa" refers to decimals (cents/fractional rupee).
- To filter for changes of at least 1 whole rupee (ignoring decimals/paisa), use:
  WHERE ABS(balance - prev_balance) >= 1.0;
- To filter where the integer rupee portion changed, use:
  WHERE TRUNC(balance::numeric) != TRUNC(prev_balance::numeric);`,
        keywords: ['balance', 'balance changed', 'previous_balance', 'lag', 'paisa', 'rupee', 'rs', 'change', 'diff', 'window function', 'previous', 'not the . value', 'not paisa']
    },
    {
        id: 'timestamp_diff_and_gaps',
        source: 'Database Best Practices',
        title: 'Calculating Longest Shutdown Time or Gaps Between Timestamps',
        content: `To find the longest gap, shutdown time, or downtime between consecutive rows (e.g. in 'predictions' table):
Use Common Table Expressions (CTEs) with the LAG() window function:
WITH ordered_predictions AS (
    SELECT *,
           LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
    FROM predictions
),
time_differences AS (
    SELECT timestamp,
           prev_timestamp,
           EXTRACT(EPOCH FROM (
               timestamp - prev_timestamp
           )) / 3600.0 AS time_diff_hours
    FROM ordered_predictions
    WHERE prev_timestamp IS NOT NULL
)
SELECT MAX(time_diff_hours) AS longest_shutdown_time_hours
FROM time_differences;

SYNTAX RULES:
1. When chaining multiple CTEs, separate CTE definitions with a comma: WITH cte1 AS (...), cte2 AS (...)
2. NEVER place a comma after the last CTE closing parenthesis before SELECT:
   DO: ) SELECT MAX(...)
   DON'T: ), SELECT MAX(...) -- (Syntax Error!)
3. In PostgreSQL and MySQL, Fluxbase supports timestamp arithmetic even when the timestamp column is VARCHAR/string.`,
        keywords: ['shutdown', 'shutdown time', 'downtime', 'gap', 'longest gap', 'longest shutdown', 'time difference', 'time diff', 'lag timestamp', 'consecutive timestamp', 'epoch']
    }
];

// Load external markdown docs if available
let cachedExternalDocs: RagDocChunk[] | null = null;

function loadExternalDocChunks(): RagDocChunk[] {
    if (cachedExternalDocs) return cachedExternalDocs;
    const chunks: RagDocChunk[] = [];

    const possiblePaths = [
        path.join(process.cwd(), 'FLUXBASE_SERVICES_INFRASTRUCTURE.md'),
        path.join(process.cwd(), 'docs', 'flux-ai-gateway.md'),
        path.join(process.cwd(), 'docs', 'supabase_comparison.md'),
        path.join(process.cwd(), 'packages', 'gateway', 'docs', 'INTEGRATION_GUIDE.md'),
        path.join(process.cwd(), 'fluxbase-client', 'INTEGRATION_GUIDE.md'),
        path.join(process.cwd(), 'README.md')
    ];

    for (const filePath of possiblePaths) {
        try {
            if (fs.existsSync(filePath)) {
                let text = fs.readFileSync(filePath, 'utf-8');
                // Enforce canonical domain across all ingested markdown documentation
                text = text.replace(/https?:\/\/(?:localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|api\.fluxbase\.dev|www\.fluxbasedb\.me)/gi, 'https://fluxbasedb.me');

                const isFluxPayDoc = filePath.includes('gateway');
                // Split by H2 or H3 headers
                const sections = text.split(/(?=^##\s+)/m);
                sections.forEach((sec, idx) => {
                    const firstLine = sec.trim().split('\n')[0] || '';
                    const title = firstLine.replace(/^#+\s*/, '').trim() || `Section ${idx + 1}`;
                    const content = sec.slice(0, 1500).trim();
                    if (content.length > 50) {
                        // For payment gateway docs, strictly scope keywords to payments so it does not hijack general database integration
                        const keywords = isFluxPayDoc
                            ? ['fluxpay', 'payment', 'upi', 'checkout', 'merchant', 'order', 'vpa', 'refund']
                            : title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
                        chunks.push({
                            id: `file_${path.basename(filePath)}_${idx}`,
                            source: path.basename(filePath),
                            title,
                            content,
                            keywords
                        });
                    }
                });
            }
        } catch (err) {
            logger.warn(`[RAG] Failed to load doc file ${filePath}:`, err);
        }
    }

    cachedExternalDocs = chunks;
    return chunks;
}

// ── TF-IDF / Keyword Scoring Engine ──────────────────────────────────────────

function tokenize(text: string): string[] {
    return text.toLowerCase()
        .replace(/[^a-z0-9_\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2);
}

export function searchDocumentation(query: string, maxResults: number = 3): RagDocChunk[] {
    const allDocs = [...STATIC_DOC_CHUNKS, ...loadExternalDocChunks()];
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0) {
        return allDocs.slice(0, maxResults);
    }

    const scored = allDocs.map(doc => {
        let score = 0;
        const docTokens = new Set([...tokenize(doc.title), ...tokenize(doc.content), ...doc.keywords]);

        for (const qt of queryTokens) {
            if (doc.title.toLowerCase().includes(qt)) score += 5;
            if (doc.keywords.some(k => k.toLowerCase().includes(qt))) score += 4;
            if (docTokens.has(qt)) score += 2;
            if (doc.content.toLowerCase().includes(qt)) score += 1;
        }

        return { doc, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(s => s.doc);
}

// ── Schema RAG ───────────────────────────────────────────────────────────────

export interface ParsedTableSchema {
    tableName: string;
    rowCount?: string;
    columns: string[];
    foreignKeys: string[];
}

export function parseRawSchemaContext(rawSchema: string): ParsedTableSchema[] {
    if (!rawSchema) return [];
    const tables: ParsedTableSchema[] = [];
    const lines = rawSchema.split('\n');
    let currentTable: ParsedTableSchema | null = null;
    let inFkSection = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- Foreign Keys:')) {
            inFkSection = true;
            continue;
        }
        if (inFkSection && trimmed.startsWith('- ') || inFkSection && trimmed.includes('->')) {
            const fkText = trimmed.replace(/^-\s*/, '');
            // e.g. "learner_profile.user_id -> app_user.id"
            const fromTable = fkText.split('.')[0]?.trim();
            const matchingTbl = tables.find(t => t.tableName === fromTable);
            if (matchingTbl) {
                matchingTbl.foreignKeys.push(fkText);
            }
            continue;
        }
        if (trimmed.startsWith('- ') && trimmed.includes(': [')) {
            // Line format: "- tableName (~619,430 rows): [col1, col2]" or "- tableName: [col1, col2]"
            const match = trimmed.match(/^-\s*([^(:[]+?)(?:\s*\(([^)]+)\))?:\s*\[(.*)\]/);
            if (match) {
                const tableName = match[1].trim();
                const rowCount = match[2]?.trim();
                const columns = match[3].split(',').map(c => c.trim()).filter(Boolean);
                currentTable = { tableName, rowCount, columns, foreignKeys: [] };
                tables.push(currentTable);
            }
        }
    }

    return tables;
}

export function rankSchemaTables(tables: ParsedTableSchema[], query: string, maxFullTables: number = 8): { prioritized: ParsedTableSchema[]; condensed: string[] } {
    if (tables.length <= maxFullTables) {
        return { prioritized: tables, condensed: [] };
    }

    const queryTokens = tokenize(query);
    const scored = tables.map(t => {
        let score = 0;
        const nameLower = t.tableName.toLowerCase();
        for (const qt of queryTokens) {
            if (nameLower === qt) score += 10;
            else if (nameLower.includes(qt) || qt.includes(nameLower)) score += 5;
            for (const col of t.columns) {
                if (col.toLowerCase().includes(qt)) score += 2;
            }
        }
        return { table: t, score };
    });

    // Sort by score descending, then alphabetical
    scored.sort((a, b) => b.score - a.score || a.table.tableName.localeCompare(b.table.tableName));

    const prioritized = scored.slice(0, maxFullTables).map(s => s.table);
    const condensed = scored.slice(maxFullTables).map(s => `${s.table.tableName}${s.table.rowCount ? ` (${s.table.rowCount})` : ''}`);

    return { prioritized, condensed };
}

// ── Master RAG Context Generator ─────────────────────────────────────────────

export async function getRagContext(
    projectId: string | undefined,
    userId: string,
    dialect: string,
    rawSchemaContext: string,
    userPrompt: string
): Promise<RagContextResult> {
    const sources: string[] = [];

    // 1. Schema RAG
    let schemaSnippet = '';
    try {
        const parsedTables = parseRawSchemaContext(rawSchemaContext);
        if (parsedTables.length > 0) {
            const { prioritized, condensed } = rankSchemaTables(parsedTables, userPrompt, 12);
            schemaSnippet = `=== LIVE DATABASE SCHEMA (RAG Filtered) ===\n`;
            schemaSnippet += prioritized.map(t => `- ${t.tableName}${t.rowCount ? ` (${t.rowCount})` : ''}: [${t.columns.join(', ')}]`).join('\n');

            const allFks = prioritized.flatMap(t => t.foreignKeys);
            if (allFks.length > 0) {
                schemaSnippet += `\n- Foreign Keys:\n` + allFks.map(f => `  ${f}`).join('\n');
            }

            if (condensed.length > 0) {
                schemaSnippet += `\n- Additional Tables in Project (${condensed.length}): ${condensed.join(', ')}`;
            }

            schemaSnippet += `\nCRITICAL: Use EXACT table/column names above. NEVER invent fake tables.\n===========================================\n`;
            sources.push(`Schema (${parsedTables.length} tables)`);
        } else if (rawSchemaContext) {
            schemaSnippet = rawSchemaContext;
        }
    } catch (e) {
        logger.warn('[RAG] Schema parsing error:', e);
        schemaSnippet = rawSchemaContext;
    }

    // 2. Documentation & Guides RAG
    let docSnippet = '';
    try {
        const matchingDocs = searchDocumentation(userPrompt, 4);

        const manifest = `=== FLUXBASE CORE PLATFORM MANIFEST & APPLICATION SCOPE ===\n` +
            `Domain: https://fluxbasedb.me | Payments: https://payments.fluxbasedb.me\n` +
            `Fluxbase is the Unified Developer Database & AI Platform.\n` +
            `- Databases: PostgreSQL 17 (:5432) & MySQL 8 (:3306) with multi-tenant schema isolation ('flux_tenant_<projectId>').\n` +
            `- APIs: REST SQL (POST /api/v1/sql) and Auto Table CRUD (/api/v1/rest/<projectId>/<table>) with Bearer token authentication.\n` +
            `- SDK: @fluxbase/client (npm) & Python FluxbaseClient with full ORM, mutation, and realtime support.\n` +
            `- File Storage: AWS S3-backed storage (POST /api/storage/upload, GET /api/storage/url 15-min presigned URLs).\n` +
            `- Realtime: Server-Sent Events (/api/realtime/subscribe) & WebSockets (wss://fluxbasedb.me/ws) with Postgres LISTEN/NOTIFY.\n` +
            `- AI Gateway: OpenAI-compatible completions (/api/v1/chat/completions) with multimodal computer vision (glm-4v-flash).\n` +
            `- Web Scraper: Headless Playwright autonomous web scraper (/scraper) ingesting directly into database tables.\n` +
            `- FluxPay: Hosted UPI payment gateway (https://payments.fluxbasedb.me) with instant QR and bank SMS matching.\n` +
            `- MCP: Model Context Protocol server (/api/mcp) for Cursor, Claude Desktop, and autonomous agents.\n` +
            `CRITICAL RULE: Answer ONLY Fluxbase-related and Fluxbase-integrated application questions. Strictly decline unrelated queries.\n` +
            `============================================================\n`;

        if (matchingDocs.length > 0) {
            docSnippet = `\n` + manifest +
                `\n--- RELEVANT FLUXBASE DOCUMENTATION & RECIPES ---\n` +
                matchingDocs.map(d => `[${d.source} - ${d.title}]\n${d.content}`).join('\n\n') +
                `\n--- END FLUXBASE DOCUMENTATION ---\n`;
            matchingDocs.forEach(d => sources.push(`${d.source}: ${d.title}`));
        } else {
            docSnippet = `\n` + manifest;
        }
    } catch (e) {
        logger.warn('[RAG] Doc retrieval error:', e);
    }

    // 3. Error Memory RAG
    let errorMemorySnippet = '';
    try {
        const lessons = await getRelevantErrorLessons(projectId, dialect, userPrompt, 4);
        if (lessons.length > 0) {
            errorMemorySnippet = formatLessonsForPrompt(lessons, dialect);
            sources.push(`Learned Error Memory (${lessons.length} rules)`);
        }
    } catch (e) {
        logger.warn('[RAG] Error lessons retrieval error:', e);
    }

    return {
        schemaSnippet,
        docSnippet,
        errorMemorySnippet,
        sources
    };
}
