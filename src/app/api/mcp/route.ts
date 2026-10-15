import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { getProjectsForCurrentUser } from '@/lib/data';
import { createProject } from '@/lib/data';
import { TenantProvisioner } from '@/lib/tenant-engine';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

const MCP_TOOLS = [
  {
    name: 'create_project',
    description: 'Creates a new serverless PostgreSQL or MySQL database project on Fluxbase.',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Name of the project' },
        dialect: { type: 'string', enum: ['postgresql', 'mysql'], description: 'Database dialect (postgresql or mysql)' },
        userRole: { type: 'string', enum: ['student', 'employee', 'org_owner'], description: 'Role of the creator' },
        description: { type: 'string', description: 'Optional project description' }
      },
      required: ['projectName', 'dialect']
    }
  },
  {
    name: 'list_projects',
    description: 'Lists all database projects owned by or shared with the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_schema',
    description: 'Fetches database schema, table structures, and column data types for a given project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID to inspect' }
      },
      required: ['projectId']
    }
  },
  {
    name: 'run_sql',
    description: 'Executes a raw SQL statement against the selected project database.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The target project ID' },
        query: { type: 'string', description: 'SQL query to execute' }
      },
      required: ['projectId', 'query']
    }
  }
];

export async function GET(req: NextRequest) {
  // Support SSE stream for clients requesting text/event-stream
  const acceptHeader = req.headers.get('accept') || '';
  if (acceptHeader.includes('text/event-stream')) {
    let timer: NodeJS.Timeout | null = null;
    const stream = new ReadableStream({
      start(controller) {
        try {
          // MCP HTTP/SSE transport announcement
          const message = `event: endpoint\ndata: /api/mcp\n\n`;
          controller.enqueue(new TextEncoder().encode(message));

          // Keep-alive heartbeat comment every 15s to keep proxy alive
          timer = setInterval(() => {
            try {
              if (req.signal.aborted) {
                if (timer) clearInterval(timer);
                try { controller.close(); } catch {}
                return;
              }
              controller.enqueue(new TextEncoder().encode(': ping\n\n'));
            } catch {
              if (timer) clearInterval(timer);
            }
          }, 15000);
        } catch {
          if (timer) clearInterval(timer);
        }
      },
      cancel() {
        if (timer) clearInterval(timer);
      }
    });

    req.signal.addEventListener('abort', () => {
      if (timer) clearInterval(timer);
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  }

  const auth = await getAuthContextFromRequest(req);
  if (!auth?.userId) {
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Unauthorized: Valid session or Bearer API key required.' }
    }, { status: 401 });
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'fluxbase',
        version: '1.0.0'
      },
      tools: MCP_TOOLS
    }
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { method, params, id } = body;

    // 0. initialize Handshake (Crucial for Antigravity & MCP Spec - must precede auth)
    if (method === 'initialize') {
      const clientVersion = params?.protocolVersion || '2024-11-05';
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          protocolVersion: clientVersion,
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: 'fluxbase',
            version: '1.0.0'
          }
        }
      });
    }

    // 0.1 notifications/initialized
    if (method === 'notifications/initialized' || method === 'initialized') {
      return new NextResponse(null, { status: 204 });
    }

    // 0.2 ping
    if (method === 'ping') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {}
      });
    }

    // Auth check for all operational commands and tool executions
    const auth = await getAuthContextFromRequest(req);
    if (!auth?.userId) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32600, message: 'Unauthorized: Valid session or Bearer API key required.' }
      }, { status: 401 });
    }

    // 1. tools/list
    if (method === 'tools/list' || method === 'list_tools') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        result: {
          tools: MCP_TOOLS
        }
      });
    }

    // 2. tools/call
    if (method === 'tools/call' || method === 'call_tool') {
      const toolName = params?.name || body?.name;
      const args = params?.arguments || body?.arguments || {};

      if (toolName === 'create_project') {
        const projectName = args.projectName || args.name;
        const dialect = args.dialect === 'mysql' ? 'mysql' : 'postgresql';
        const userRole = args.userRole || 'employee';
        const description = args.description || 'Created via MCP Gateway';

        if (!projectName) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            error: { code: -32602, message: 'Invalid params: "projectName" is required.' }
          });
        }

        const project = await createProject(
          projectName,
          description,
          dialect,
          'Asia/Kolkata',
          'internal',
          {},
          userRole,
          auth.userId
        );

        // Provision instant serverless schema
        try {
          const tenantResult = await TenantProvisioner.createTenantSchema(project.project_id, dialect);
          const pool = getPgPool();
          await pool.query(
            'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
            [tenantResult.schemaName, project.project_id]
          );
        } catch (e) {
          logger.warn('[MCP] Schema provision warning:', e);
        }

        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  projectId: project.project_id,
                  displayName: project.display_name,
                  dialect: project.dialect,
                  role: userRole,
                  message: `Project "${project.display_name}" (${dialect}) created and ready.`
                }, null, 2)
              }
            ]
          }
        });
      }

      if (toolName === 'list_projects') {
        const projects = await getProjectsForCurrentUser(auth.userId);
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(projects, null, 2)
              }
            ]
          }
        });
      }

      if (toolName === 'get_schema') {
        const projectId = args.projectId;
        if (!projectId) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            error: { code: -32602, message: 'Invalid params: "projectId" is required.' }
          });
        }

        const pool = getPgPool();
        const schemaName = `flux_tenant_${projectId.toLowerCase().replace(/[^a-z0-9_]/g, '')}`;

        // Live database schema inspection
        const tablesRes = await pool.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name NOT LIKE '\\_%'
          ORDER BY table_name ASC
        `, [schemaName]);

        const tables = await Promise.all(
          tablesRes.rows.map(async (row) => {
            const colsRes = await pool.query(`
              SELECT column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
              ORDER BY ordinal_position ASC
            `, [schemaName, row.table_name]);

            return {
              tableName: row.table_name,
              columns: colsRes.rows.map((c) => ({
                name: c.column_name,
                type: c.data_type,
                isNullable: c.is_nullable === 'YES',
                defaultValue: c.column_default
              }))
            };
          })
        );

        return NextResponse.json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ projectId, schemaName, tables }, null, 2)
              }
            ]
          }
        });
      }

      if (toolName === 'run_sql') {
        const { projectId, query } = args;
        if (!projectId || !query) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            error: { code: -32602, message: 'Invalid params: "projectId" and "query" are required.' }
          });
        }

        const pool = getPgPool();
        const projRes = await pool.query(
          'SELECT project_id, dialect FROM fluxbase_global.projects WHERE project_id = $1',
          [projectId]
        );

        if (projRes.rows.length === 0) {
          return NextResponse.json({
            jsonrpc: '2.0',
            id: id || 1,
            error: { code: -32602, message: `Project "${projectId}" not found.` }
          });
        }

        const project = projRes.rows[0];
        const schemaName = `flux_tenant_${projectId.toLowerCase().replace(/[^a-z0-9_]/g, '')}`;

        if (project.dialect === 'mysql') {
          const mysql = await import('mysql2/promise');
          const conn = await mysql.default.createConnection({
            host: process.env.AWS_RDS_MYSQL_HOST || 'localhost',
            user: process.env.AWS_RDS_MYSQL_USER || 'root',
            password: process.env.AWS_RDS_MYSQL_PASSWORD || '',
            port: parseInt(process.env.AWS_RDS_MYSQL_PORT || '3306', 10),
            database: schemaName
          });
          try {
            const [rows] = await conn.query(query);
            return NextResponse.json({
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ success: true, rows, rowCount: Array.isArray(rows) ? rows.length : 1 }, null, 2)
                  }
                ]
              }
            });
          } finally {
            await conn.end();
          }
        } else {
          // PostgreSQL
          const client = await pool.connect();
          try {
            await client.query(`SET search_path TO "${schemaName}", public;`);
            const sqlResult = await client.query(query);
            return NextResponse.json({
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      command: sqlResult.command,
                      rowCount: sqlResult.rowCount,
                      rows: sqlResult.rows
                    }, null, 2)
                  }
                ]
              }
            });
          } finally {
            client.release();
          }
        }
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id: id || 1,
        error: { code: -32601, message: `Tool "${toolName}" not found.` }
      });
    }

    // Default discovery response with standard protocolVersion
    return NextResponse.json({
      jsonrpc: '2.0',
      id: id || 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: 'fluxbase',
          version: '1.0.0'
        },
        tools: MCP_TOOLS
      }
    });

  } catch (error: any) {
    logger.error('MCP Gateway Error:', error);
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: error.message || 'Internal MCP Gateway error.' }
    }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
