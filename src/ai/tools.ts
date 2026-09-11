import { z } from 'zod';
import { ai } from './genkit';

export const getSchemaTool = ai.defineTool({
  name: "getSchemaTool",
  description: "Fetch the complete database schema for the workspace including tables and columns. Call this whenever you need to inspect existing tables before formulating queries or generating DDL.",
  inputSchema: z.object({
    projectId: z.string().describe("The Project ID/UUID to inspect."),
  }),
  outputSchema: z.object({
    schema: z.any()
  }),
}, async (input) => {
  try {
    const { SqlEngine } = await import('@/lib/sql-engine');
    const { getCurrentUserId } = await import('@/lib/auth');
    const { getProjectById } = await import('@/lib/data');
    const { getProjectDbAndSchema } = await import('@/lib/tenant-pools');

    const userId = await getCurrentUserId() || 'system_ai';
    const project = await getProjectById(input.projectId, userId);
    if (!project) throw new Error("Project not found");

    const { dbName, schemaName } = getProjectDbAndSchema(project);
    const isMysql = project.dialect?.toLowerCase() === 'mysql';
    const targetSchemaOrDb = isMysql ? dbName : schemaName;
    const engine = new SqlEngine(input.projectId, userId, undefined, undefined, project); 

    const query = isMysql
      ? `SELECT table_name, column_name, data_type, is_nullable, column_key FROM information_schema.columns WHERE table_schema = ? AND table_name NOT LIKE '\\_flux\\_internal\\_%' ORDER BY table_name, ordinal_position;`
      : `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name NOT LIKE '\\_flux\\_internal\\_%' ORDER BY table_name, ordinal_position;`;

    const tables = await engine.execute(query, [targetSchemaOrDb]);
    
    if (tables && tables.rows) {
        const schemaGraph: Record<string, { column: string; type: string; nullable?: string; key?: string }[]> = {};
        tables.rows.forEach((r: any) => {
            const t = r.table_name || r.TABLE_NAME;
            const c = r.column_name || r.COLUMN_NAME;
            const dt = r.data_type || r.DATA_TYPE || 'text';
            const nl = r.is_nullable || r.IS_NULLABLE;
            const k = r.column_key || r.COLUMN_KEY;
            if (!schemaGraph[t]) schemaGraph[t] = [];
            schemaGraph[t].push({ column: c, type: dt, nullable: nl, key: k });
        });
        return { schema: schemaGraph };
    }
    return { schema: { error: "No tables found" } };
  } catch(e: any) {
    return { schema: { error: e.message } };
  }
});

export const runSqlTool = ai.defineTool({
  name: "runSqlTool",
  description: "Prepares a SQL query to execute against the active project database. Requests explicit user confirmation.",
  inputSchema: z.object({ 
    query: z.string().describe("The exact SQL query to execute."), 
    reason: z.string().describe("Brief explanation of what the query accomplishes.") 
  }),
  outputSchema: z.object({
    action: z.string()
  }),
}, async (input) => {
  return { action: `[CONFIRM_ACTION:EXECUTE_SQL:${input.query}]` };
});

export const createTableDirectTool = ai.defineTool({
  name: "createTableDirectTool",
  description: "Formulates a complete CREATE TABLE statement with columns, types, and primary key, and queues it for execution.",
  inputSchema: z.object({
    tableName: z.string().describe("Name of the table to create (e.g. 'products', 'customers')."),
    columns: z.array(z.object({
      name: z.string(),
      type: z.string().describe("Data type, e.g., 'SERIAL', 'INT', 'VARCHAR(255)', 'TEXT', 'BOOLEAN', 'NUMERIC(10,2)', 'TIMESTAMP'"),
      isPrimaryKey: z.boolean().optional(),
      isNullable: z.boolean().optional(),
      defaultValue: z.string().optional()
    })).describe("List of columns to create in the table."),
    dialect: z.enum(['postgresql', 'mysql']).optional().describe("Database dialect.")
  }),
  outputSchema: z.object({
    action: z.string(),
    generatedSql: z.string()
  }),
}, async (input) => {
  const isMysql = input.dialect?.toLowerCase() === 'mysql';
  const quote = isMysql ? (s: string) => `\`${s}\`` : (s: string) => `"${s}"`;

  const colDefs = input.columns.map(c => {
    let def = `${quote(c.name)} ${c.type}`;
    if (c.isPrimaryKey) {
      if (isMysql && c.type.toUpperCase().includes('INT') && !c.type.toUpperCase().includes('AUTO_INCREMENT')) {
        def += ' AUTO_INCREMENT PRIMARY KEY';
      } else {
        def += ' PRIMARY KEY';
      }
    }
    if (c.isNullable === false) def += ' NOT NULL';
    if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
    return def;
  });

  const sql = `CREATE TABLE IF NOT EXISTS ${quote(input.tableName)} (\n  ${colDefs.join(',\n  ')}\n);`;
  return {
    action: `[CONFIRM_ACTION:EXECUTE_SQL:${sql}]`,
    generatedSql: sql
  };
});

export const insertRowsTool = ai.defineTool({
  name: "insertRowsTool",
  description: "Seeds or inserts sample records directly into a specified table.",
  inputSchema: z.object({
    tableName: z.string().describe("Table name to insert records into."),
    rows: z.array(z.record(z.any())).describe("Array of row objects with column-value pairs.")
  }),
  outputSchema: z.object({
    action: z.string(),
    generatedSql: z.string()
  }),
}, async (input) => {
  if (!input.rows.length) return { action: '', generatedSql: '' };

  const columns = Object.keys(input.rows[0]);
  const formatVal = (v: any) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  const valuesClauses = input.rows.map(r => `(${columns.map(c => formatVal(r[c])).join(', ')})`).join(',\n  ');
  const sql = `INSERT INTO "${input.tableName}" (${columns.map(c => `"${c}"`).join(', ')})\nVALUES\n  ${valuesClauses};`;

  return {
    action: `[CONFIRM_ACTION:EXECUTE_SQL:${sql}]`,
    generatedSql: sql
  };
});

export const navigatePageTool = ai.defineTool({
  name: "navigatePageTool",
  description: "Teleports the user's browser to different pages in the application.",
  inputSchema: z.object({ 
    path: z.enum([
      '/dashboard', 
      '/dashboard/projects/create', 
      '/settings', 
      '/settings/api-keys', 
      '/settings/webhooks', 
      '/settings/team',
      '/editor', 
      '/query', 
      '/storage',
      '/analytics'
    ]).describe("The absolute path to navigate to.") 
  }),
  outputSchema: z.object({
    action: z.string()
  }),
}, async (input) => {
  return { action: `[NAVIGATE:${input.path}]` };
});

export const clickElementTool = ai.defineTool({
  name: "clickElementTool",
  description: "Simulates clicking a button, tab, or link in the UI using its visible label or ID.",
  inputSchema: z.object({ 
    elementId: z.string().describe("The exact visible label or DOM id of the button/tab/link to click.") 
  }),
  outputSchema: z.object({
    action: z.string()
  }),
}, async (input) => {
  return { action: `[CLICK:${input.elementId}]` };
});

export const typeInputTool = ai.defineTool({
  name: "typeInputTool",
  description: "Types text into a form input or textarea on the current screen.",
  inputSchema: z.object({
    value: z.string().describe("The text to type."),
    locator: z.string().describe("The input label, placeholder, name, or ID.")
  }),
  outputSchema: z.object({
    action: z.string()
  }),
}, async (input) => {
  return { action: `[TYPE:${input.value}:${input.locator}]` };
});

export const createProjectTool = ai.defineTool({
  name: "createProjectTool",
  description: "Creates a new database project in Fluxbase.",
  inputSchema: z.object({
    projectName: z.string().describe("The name of the new project to create."),
    dialect: z.enum(['postgresql', 'mysql']).describe("The database dialect ('postgresql' or 'mysql')."),
  }),
  outputSchema: z.object({
    action: z.string()
  }),
}, async (input) => {
  return { action: `[CONFIRM_ACTION:CREATE_PROJECT:${input.projectName}:${input.dialect}]` };
});

export const learnErrorFixTool = ai.defineTool({
  name: "learnErrorFixTool",
  description: "Saves a database error and its verified fix into persistent RAG memory so Flux AI never repeats the mistake.",
  inputSchema: z.object({
    projectId: z.string().optional(),
    dialect: z.enum(['postgresql', 'mysql']),
    errorCategory: z.string().describe("Category, e.g. 'syntax_reserved_keyword', 'type_mismatch', 'constraint_violation'"),
    errorMessage: z.string().describe("The error message received from the database."),
    failedQuery: z.string().describe("The SQL query or tool input that failed."),
    verifiedFix: z.string().describe("The working query or instruction that fixes the problem.")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
}, async (input) => {
  const { recordAiErrorSolution } = await import('@/lib/ai-memory');
  const ok = await recordAiErrorSolution(
    input.projectId,
    input.dialect,
    input.errorCategory,
    input.errorMessage,
    input.failedQuery,
    input.verifiedFix
  );
  return {
    success: ok,
    message: ok ? "Successfully learned error resolution in RAG memory." : "Failed to record memory."
  };
});

export const executeSqlTool = ai.defineTool({
  name: "executeSqlTool",
  description: "Executes a safe read-only SQL query (SELECT, SHOW, EXPLAIN, DESCRIBE, WITH) against the active database and returns rows.",
  inputSchema: z.object({
    query: z.string().describe("The read-only SQL query to execute."),
  }),
  outputSchema: z.object({
    action: z.string(),
  }),
}, async (input) => {
  return { action: `[EXECUTE_SQL:${input.query}]` };
});

export const searchKnowledgeTool = ai.defineTool({
  name: "searchKnowledgeTool",
  description: "Searches Fluxbase documentation, API references, SDK guides, and database rules using the RAG subsystem.",
  inputSchema: z.object({
    query: z.string().describe("The search term or question to find documentation for."),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      content: z.string(),
      source: z.string(),
    })),
  }),
}, async (input) => {
  const { searchDocumentation } = await import('@/lib/rag-service');
  const docs = searchDocumentation(input.query, 3);
  return {
    results: docs.map(d => ({ title: d.title, content: d.content, source: d.source })),
  };
});

export const fluxTools = [
  getSchemaTool, 
  executeSqlTool,
  searchKnowledgeTool,
  runSqlTool, 
  createTableDirectTool,
  insertRowsTool,
  navigatePageTool, 
  clickElementTool, 
  typeInputTool, 
  createProjectTool,
  learnErrorFixTool
];
