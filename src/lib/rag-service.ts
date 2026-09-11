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
        id: 'sql_execution_api',
        source: 'API Reference',
        title: 'SQL Execution Endpoint',
        content: `POST /api/execute-sql (or /api/ai-chat/execute-sql)
Headers: Content-Type: application/json, Authorization: Bearer <API_KEY> or active session
Body: { "query": "SELECT * FROM users LIMIT 10;", "projectId": "<PROJECT_UUID>" }
Response: { "success": true, "columns": ["id", "name"], "rows": [...], "rowCount": 10 }
Note: Safe queries (SELECT, SHOW, EXPLAIN, WITH) execute directly. Destructive operations (DROP, DELETE, TRUNCATE) require approval.`,
        keywords: ['sql', 'query', 'execute', 'select', 'api', 'endpoint', 'rows', 'columns', 'read']
    },
    {
        id: 'storage_api',
        source: 'Storage Guide',
        title: 'S3-Compatible Storage Upload & Presigned URLs',
        content: `POST /api/storage/upload
Multipart form data: file (binary), projectId (<UUID>), bucket (optional)
GET /api/storage/download?projectId=<UUID>&key=<file_key> -> returns presigned download URL
POST /api/storage/delete { projectId, key }
Storage handles AWS S3 backend, presigned URLs, MIME detection, and multi-tenant bucket prefixes.`,
        keywords: ['storage', 's3', 'upload', 'file', 'presigned', 'download', 'bucket', 'asset', 'image']
    },
    {
        id: 'realtime_api',
        source: 'Realtime Guide',
        title: 'Server-Sent Events (SSE) Realtime Subscriptions',
        content: `SSE Endpoint: GET /api/realtime/subscribe?projectId=<UUID>&table=<TABLE_NAME>
Headers: Accept: text/event-stream
Events:
- event: INSERT -> data: { "type": "INSERT", "table": "...", "record": {...} }
- event: UPDATE -> data: { "type": "UPDATE", "table": "...", "record": {...}, "old": {...} }
- event: DELETE -> data: { "type": "DELETE", "table": "...", "id": "..." }
Supports client-side listening via standard EventSource API or Fluxbase SDK.`,
        keywords: ['realtime', 'sse', 'subscribe', 'eventsource', 'live', 'websocket', 'stream', 'listen']
    },
    {
        id: 'sdk_integration',
        source: 'SDK Guide',
        title: 'Client SDK Integration (JavaScript / TypeScript / Python)',
        content: `JavaScript / TypeScript:
import { createClient } from '@fluxbase/client';
const flux = createClient({ apiKey: 'flx_live_xxx', projectId: 'uuid-xxx' });
const { data, error } = await flux.from('users').select('*').eq('role', 'admin');

Python:
from fluxbase import FluxbaseClient
flux = FluxbaseClient(api_key="flx_live_xxx", project_id="uuid-xxx")
users = flux.table("users").select("id, name, email").execute()`,
        keywords: ['sdk', 'javascript', 'typescript', 'python', 'client', 'install', 'import', 'code', 'library']
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
        id: 'mcp_integration',
        source: 'MCP Protocol Reference',
        title: 'Fluxbase Model Context Protocol (MCP) Server',
        content: `Fluxbase exposes an MCP compliant JSON-RPC 2.0 gateway at /api/mcp.
Standard Tools:
1. create_project: { projectName, dialect: "postgresql"|"mysql", userRole?, description? }
2. list_projects: {}
3. get_schema: { projectId }
4. run_sql: { projectId, query }
MCP Guard intercepts incoming connection requests and requires explicit user review.`,
        keywords: ['mcp', 'tools', 'model context protocol', 'call_mcp', 'json-rpc', 'agent', 'gateway']
    }
];

// Load external markdown docs if available
let cachedExternalDocs: RagDocChunk[] | null = null;

function loadExternalDocChunks(): RagDocChunk[] {
    if (cachedExternalDocs) return cachedExternalDocs;
    const chunks: RagDocChunk[] = [];

    const possiblePaths = [
        path.join(process.cwd(), 'packages', 'gateway', 'docs', 'INTEGRATION_GUIDE.md'),
        path.join(process.cwd(), 'fluxbase-client', 'INTEGRATION_GUIDE.md'),
        path.join(process.cwd(), 'README.md')
    ];

    for (const filePath of possiblePaths) {
        try {
            if (fs.existsSync(filePath)) {
                const text = fs.readFileSync(filePath, 'utf-8');
                // Split by H2 or H3 headers
                const sections = text.split(/(?=^##\s+)/m);
                sections.forEach((sec, idx) => {
                    const firstLine = sec.trim().split('\n')[0] || '';
                    const title = firstLine.replace(/^#+\s*/, '').trim() || `Section ${idx + 1}`;
                    const content = sec.slice(0, 1500).trim();
                    if (content.length > 50) {
                        const keywords = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
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
        const matchingDocs = searchDocumentation(userPrompt, 2);
        if (matchingDocs.length > 0) {
            docSnippet = `\n--- RELEVANT DOCUMENTATION & INTEGRATION RECIPES ---\n` +
                matchingDocs.map(d => `[${d.source} - ${d.title}]\n${d.content}`).join('\n\n') +
                `\n--- END DOCUMENTATION ---\n`;
            matchingDocs.forEach(d => sources.push(`${d.source}: ${d.title}`));
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
