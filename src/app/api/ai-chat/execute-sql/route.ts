import { NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import logger from '@/lib/logger';

export async function POST(req: Request) {
  try {
    const auth = await getAuthContextFromRequest(req);
    if (!auth?.userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { query, projectId } = await req.json();
    if (!query || !projectId) {
      return NextResponse.json({ success: false, error: 'Missing query or projectId' }, { status: 400 });
    }

    const { SqlEngine } = await import('@/lib/sql-engine');
    const { getProjectById } = await import('@/lib/data');

    const project = await getProjectById(projectId, auth.userId);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Block catastrophic destructive operations without explicit approval or setting
    const normalized = query.replace(/\s+/g, ' ').trim().toUpperCase();
    const isDangerous = /^(\s*\/\*)?(\s*DROP\s|\s*TRUNCATE\s|\s*DELETE\s+FROM\s+[a-zA-Z0-9_."']+\s*(?:;|$))/i.test(normalized);
    if (isDangerous && !project.ai_allow_destructive) {
      return NextResponse.json({
        success: false,
        error: 'Destructive queries (DROP, TRUNCATE, unconstrained DELETE) require approval or enabling in Project Settings -> AI Assistant.'
      }, { status: 400 });
    }

    const engine = new SqlEngine(projectId, auth.userId, undefined, undefined, project);
    const result = await engine.execute(query);

    // Return up to 50 rows to keep the chat response manageable
    const rows = (result.rows || []).slice(0, 50);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : (result.columns || []);
    const rowCount = result.rows?.length || 0;
    const rowsAffected = result.rowsAffected ?? (result as any).rowCount ?? 0;

    return NextResponse.json({
      success: true,
      columns,
      rows,
      rowCount,
      rowsAffected,
      message: result.message || (rowsAffected > 0 ? `${rowsAffected} row(s) affected.` : undefined),
      truncated: rowCount > 50
    });
  } catch (error: any) {
    logger.error('[AI Execute SQL] Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Query execution failed.' }, { status: 500 });
  }
}
