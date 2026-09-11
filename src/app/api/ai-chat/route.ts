import { NextResponse } from 'next/server';
import { ai } from '@/ai/genkit';
import { getAuthContextFromRequest } from '@/lib/auth';
import logger from '@/lib/logger';
import { SqlEngine } from '@/lib/sql-engine';
import { getProjectById } from '@/lib/data';
import { getProjectDbAndSchema } from '@/lib/tenant-pools';
import { getRagContext } from '@/lib/rag-service';
import { fluxTools } from '@/ai/tools';

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
                // For PostgreSQL tables under 100k rows, fetch exact count to mirror dashboard precision
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
// Pinged by client on page mount to ensure Turbopack pre-compiles the route in the background.
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

        const { messages, currentPath, model, activeProject, screenContext } = await req.json();
        const userLastMsg = messages[messages.length - 1]?.content || '';
        const dialect = activeProject?.dialect || 'postgresql';

        // ── 1. Fast-path intent check for greetings & chitchat ──────────────────
        // Greetings do not need database schema introspection or RAG error memory DB lookups.
        const isGreeting = isCasualOrGreeting(userLastMsg);

        let rawSchema = '';
        let rag = { schemaSnippet: '', docSnippet: '', errorMemorySnippet: '', sources: [] as string[] };

        if (!isGreeting) {
            // Real query: execute schema context retrieval and RAG context
            rawSchema = await getSchemaContext(activeProject?.project_id, auth.userId, activeProject);
            rag = await getRagContext(
                activeProject?.project_id,
                auth.userId,
                dialect,
                rawSchema,
                userLastMsg
            );
        }

        // Project context
        const projectContext = activeProject
            ? `\nPROJECT: "${activeProject.display_name || ''}" (ID: ${activeProject.project_id}) | Dialect: ${activeProject.dialect || 'postgresql'} | TZ: ${activeProject.timezone || 'UTC'}\n`
            : '\nNo active project. Ask user to select/create one first for SQL operations.\n';

        const screenContextStr = screenContext
            ? `\nSCREEN: Table="${screenContext.activeTable || 'none'}" Cols=${JSON.stringify(screenContext.visibleColumns?.slice(0, 15) || [])} Rows=${screenContext.rowCount || 0}${screenContext.activeError ? ` Error="${screenContext.activeError.slice(0, 100)}"` : ''}\n`
            : '';

        const systemPrompt = isGreeting
            ? `You are Flux AI, an autonomous database agent inside Fluxbase. Greet the user warmly and concisely explain what you can do (query databases, explore schemas, create tables, run Auto-Pilot workflows, and navigate the app). Keep your response concise.`
            : `You are Flux AI, an autonomous database agent inside Fluxbase. You are capable of querying databases, navigating the UI, clicking buttons, typing in forms, executing MCP tools, and requesting user review/approval for sensitive operations.

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
${rag.schemaSnippet}
${rag.docSnippet}
${rag.errorMemorySnippet}

CURRENT PATH: ${currentPath}

CRITICAL RULES:
1. NEVER simulate user responses or output "USER:". NEVER output "ASSISTANT:" or repeat your response. Provide your response once directly.
2. REASONING & THINKING PROTOCOL:
   If you need to plan, reason, or formulate SQL queries, you MUST put your internal reasoning inside <think>...</think> tags.
   NEVER output conversational filler like "To provide the row count for each table, I will execute another query...". Either put your reasoning inside <think>...</think> or emit the action tag immediately.
3. ACCURATE TABLE ROW COUNTS & DATABASE SIZES:
   - Live row counts are ALREADY PROVIDED for every table in "=== LIVE DATABASE SCHEMA ===" (e.g. "- predictions (~619,430 rows): [...]", "- candles_1m (52,142 rows): [...]", "- exported_data (13 rows): [...]").
   - When the user asks for row counts, number of rows, or how many rows are inside tables, ANSWER IMMEDIATELY using these live schema row counts formatted in a clean Markdown table! DO NOT tell the user every table has 1 row!
   - NEVER, UNDER ANY CIRCUMSTANCES, run "SELECT table_name, COUNT(*) FROM information_schema.tables"! That query is COMPLETELY INACCURATE because it only counts metadata catalog schema entries and always returns 1 for every table!
   - If you need to execute SQL to query or refresh table row counts:
     * In PostgreSQL, run:
       SELECT c.relname AS table_name, GREATEST(0, c.reltuples::bigint) AS row_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE (n.nspname = current_schema() OR n.nspname = 'public') AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE '_flux_%'
       ORDER BY row_count DESC;
     * In MySQL, run:
       SELECT TABLE_NAME AS table_name, COALESCE(TABLE_ROWS, 0) AS row_count
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE '_flux_%'
       ORDER BY TABLE_NAME;
     * For a single table exact count:
       SELECT COUNT(*) AS row_count FROM "tableName";
4. When the user asks to query, inspect, count, or analyze data, DO NOT explain that you will query. Run the query IMMEDIATELY by emitting [EXECUTE_SQL:<actual_sql_statement>].
5. For destructive operations (DROP TABLE, DELETE, TRUNCATE, ALTER, UPDATE without WHERE), you MUST request human approval using [REQUEST_APPROVAL:<id>:EXECUTE_SQL:<summary>:<sql>]. The user will receive an interactive card in the chat to approve and run it.
6. When you receive observation data (e.g. "System: Observation from SQL execution..."), analyze the rows and determine the next step or conclude the goal. Format tables using clean Markdown tables.
7. When the user's overall goal or Auto-Pilot task is accomplished, summarize your findings and end with [GOAL_ACCOMPLISHED:<summary>].
8. ACCURATE COLUMNS & ROW COMPARISONS (LAG WINDOW FUNCTION):
   - ONLY query columns that actually exist in "=== LIVE DATABASE SCHEMA ==="!
   - For example, in table "predictions", there is NO column called "previous_balance"! NEVER write "WHERE balance != previous_balance".
   - To compare values with the preceding row, ALWAYS use the LAG() window function:
     WITH changes AS (
       SELECT *, LAG(balance) OVER (ORDER BY id) AS prev_balance
       FROM predictions
     )
     SELECT *
     FROM changes
     WHERE prev_balance IS NOT NULL
       AND ABS(balance - prev_balance) >= 1.0;
   - When the user asks for balance changes of at least 1 rupee (ignoring decimals/paisa), filter with "ABS(balance - prev_balance) >= 1.0".

AVAILABLE ACTION TAGS (append at the very end of your response):
- Safe Read SQL (immediate execution): [EXECUTE_SQL:<exact_sql_query>]
  CRITICAL: You MUST replace <exact_sql_query> with the actual executable SQL statement (e.g. [EXECUTE_SQL:SELECT * FROM predictions LIMIT 10;]). NEVER output the literal placeholder text "[EXECUTE_SQL:<query>]" or literal angle brackets!
- Destructive SQL (human review required): [REQUEST_APPROVAL:appr_${Date.now()}:EXECUTE_SQL:<summary>:<sql>]
  For DROP, DELETE, TRUNCATE, ALTER, INSERT, CREATE TABLE.
- MCP Tool Call: [CALL_MCP:<toolName>:<jsonArgs>]
  Tools: "create_project", "list_projects", "get_schema", "run_sql".
- Navigate: [NAVIGATE:/path] (exact route from AVAILABLE ROUTES)
- Click: [CLICK:<label_or_id>]
- Type: [TYPE:<value>:<field_or_placeholder>]
- Goal Finished: [GOAL_ACCOMPLISHED:<summary>]

Respond concisely in Markdown. If you need data, output your thought inside <think>...</think> and the ACTION tag with your full SQL query immediately.`;

        // Build conversation
        const recentMessages = messages.slice(-10);
        let fullPrompt = systemPrompt + '\n\n--- CONVERSATION ---\n';
        for (const msg of recentMessages) {
            if (msg.hidden) continue;
            const role = msg.role.toUpperCase();
            fullPrompt += `${role}: ${msg.content}\n\n`;
        }
        fullPrompt += 'ASSISTANT: ';

        const response = await ai.generate({
            model: model || 'glm',
            prompt: fullPrompt,
            tools: isGreeting ? undefined : fluxTools,
            config: { temperature: 0.2 }
        });

        let responseText = response.text || '';

        // 1. Preserve any <think>...</think> or <thought>...</thought> block from the model
        const thinkMatch = responseText.match(/<think>[\s\S]*?<\/think>/i) || responseText.match(/<thought>[\s\S]*?<\/thought>/i);
        const thinkBlock = thinkMatch ? thinkMatch[0] : '';
        if (thinkBlock) {
            responseText = responseText.replace(thinkBlock, '').trim();
        }

        // 2. Strip leading "ASSISTANT:" prefix if model mirrored prompt header
        responseText = responseText.replace(/^(?:ASSISTANT|Assistant):\s*/i, '').trim();

        // 3. Anti-hallucination defense: If model generated multiple turns with "\nASSISTANT: ..."
        if (/\n+(?:ASSISTANT|Assistant):\s*/i.test(responseText)) {
            const parts = responseText.split(/\n+(?:ASSISTANT|Assistant):\s*/i).filter(Boolean);
            if (parts.length > 0) {
                // Keep the final authoritative answer
                responseText = parts[parts.length - 1].trim();
            }
        }

        // 4. Anti-hallucination defense: Strip any hallucinated "USER: ..." dialogue continuation
        if (responseText.includes('\nUSER:')) {
            responseText = responseText.split(/\nUSER:/i)[0].trim();
        } else if (responseText.includes('\nUser:')) {
            responseText = responseText.split(/\nUser:/)[0].trim();
        }

        // 5. Clean orphan "Query results: ```sql..." if followed by conversational answer with code
        if (/^Query results:\s*```[\s\S]*?```/i.test(responseText)) {
            const afterQueryResults = responseText.replace(/^Query results:\s*```[\s\S]*?```\s*/i, '').trim();
            if (afterQueryResults.includes('```')) {
                responseText = afterQueryResults;
            }
        }

        // 6. Restore the preserved thought block at the very top
        if (thinkBlock) {
            responseText = `${thinkBlock}\n\n${responseText}`.trim();
        }

        // Extract tool calls and append as action tags (only if not a greeting)
        if (!isGreeting) {
            try {
                const actionTags: string[] = [];
                const content = response.message?.content || (response as any).output?.content || [];
                if (Array.isArray(content)) {
                    for (const part of content) {
                        if (!part.toolRequest) continue;
                        const req = part.toolRequest;
                        if (req.name === 'navigatePageTool' && req.input?.path) {
                            const p = req.input.path.replace(/^<\/+/, '/').replace(/>+$/, '');
                            actionTags.push(`[NAVIGATE:${p}]`);
                        } else if (req.name === 'clickElementTool' && req.input?.elementId) {
                            actionTags.push(`[CLICK:${req.input.elementId}]`);
                        } else if (req.name === 'typeInputTool' && req.input?.value && req.input?.locator) {
                            actionTags.push(`[TYPE:${req.input.value}:${req.input.locator}]`);
                        } else if (req.name === 'createProjectTool' && req.input?.projectName) {
                            actionTags.push(`[REQUEST_APPROVAL:appr_${Date.now()}:CREATE_PROJECT:Create project ${req.input.projectName}:${JSON.stringify(req.input)}]`);
                        } else if (req.name === 'runSqlTool' && req.input?.query) {
                            const q = req.input.query;
                            const isDestr = /drop|delete\s+from|truncate|alter\s+table/i.test(q);
                            if (isDestr) {
                                actionTags.push(`[REQUEST_APPROVAL:appr_${Date.now()}:EXECUTE_SQL:${req.input.reason || 'Execute SQL query'}:${q}]`);
                            } else {
                                actionTags.push(`[EXECUTE_SQL:${q}]`);
                            }
                        }
                    }
                }
                const uniqueTags = [...new Set(actionTags.filter(Boolean))];
                if (uniqueTags.length > 0) {
                    responseText += '\n' + uniqueTags.join('\n');
                }
            } catch (toolErr) {
                logger.error('[AI Chat] Tool extraction failed:', toolErr);
            }
        }

        return NextResponse.json({ success: true, text: responseText, sources: rag.sources });
    } catch (error: any) {
        logger.error('AI Chat Error:', error);
        let userFacingError = error.message || 'Failed to process request.';
        if (userFacingError.includes('1113') || userFacingError.includes('余额不足')) {
            userFacingError = 'GLM quota exhausted. Add GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY to .env.local.';
        } else if (userFacingError.includes('API_KEY_INVALID') || userFacingError.includes('API key not valid')) {
            userFacingError = 'API key invalid. Configure GEMINI_API_KEY, GROQ_API_KEY, or GLM_API_KEY in .env.local.';
        }
        return NextResponse.json({ success: false, error: userFacingError }, { status: 500 });
    }
}

// Allow schema cache invalidation via DELETE (called after DDL operations)
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

