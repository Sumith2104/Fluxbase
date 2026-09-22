import { NextResponse } from 'next/server';
import { getTableData, getProjectById, ensureNotSuspended } from '@/lib/data';
import type { TableSort, TableFilter } from '@/lib/data';
import { trackApiRequest } from '@/lib/analytics';
import { getAuthContextFromRequest } from '@/lib/auth';
import logger from '@/lib/logger';
import { getCorsOrigin, corsPreflightResponse } from '@/lib/cors';
import { requireReadScope } from '@/lib/require-scope';

export const maxDuration = 60; // 1 minute
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const auth = await getAuthContextFromRequest(request);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
    }
    if (auth.status === 'suspended') {
      return NextResponse.json({ error: 'Organization suspended. Please resume the organization to access data.' }, { status: 403 });
    }
    const { userId, allowedProjectId } = auth;

    const { searchParams } = new URL(request.url);
    let projectId = searchParams.get('projectId');
    const tableName = searchParams.get('tableName');
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);

    // Parse server-side sort params: sortsJson=[{"field":"col","direction":"asc"}]
    let sorts: TableSort[] = [];
    const sortsJson = searchParams.get('sorts');
    if (sortsJson) {
      try { sorts = JSON.parse(sortsJson); } catch { sorts = []; }
    }

    // Parse server-side filter params: filtersJson=[{"field":"col","op":"contains","value":"test"}]
    let filters: TableFilter[] = [];
    const filtersJson = searchParams.get('filters');
    if (filtersJson) {
      try { filters = JSON.parse(filtersJson); } catch { filters = []; }
    }

    // Enforce Scope
    if (allowedProjectId) {
      if (projectId && projectId !== allowedProjectId) {
        return NextResponse.json({ error: `API Key is scoped to project ${allowedProjectId}, but request specified ${projectId}` }, { status: 403 });
      }
      if (!projectId) {
        projectId = allowedProjectId;
      }
    }

    if (!projectId || !tableName) {
      return NextResponse.json({ error: 'Missing required query parameters: projectId and tableName' }, { status: 400 });
    }

    // Granular Project Suspension Check
    const project = await getProjectById(projectId, userId);
    if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // This will throw a FluxbaseError if suspended
    try {
        await ensureNotSuspended(project);
    } catch (e: any) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status || 403 });
    }

    if (isNaN(page) || page < 0 || isNaN(pageSize) || pageSize < 1) {
      return NextResponse.json({ error: 'Invalid pagination parameters.' }, { status: 400 });
    }

    const data = await getTableData(projectId, tableName, page, pageSize, userId, sorts, filters, project);


    // Track analytics in the background — do NOT await, we don't want
    // these sequential DB writes blocking the HTTP response.
    Promise.all([
      trackApiRequest(projectId, 'storage_read'),
      trackApiRequest(projectId, 'api_call'),
      trackApiRequest(projectId, 'sql_select'),
    ]).catch(() => { });

    return NextResponse.json(data);

  } catch (error: any) {
    logger.error('Failed to fetch table data:', error);
    return NextResponse.json({ error: `An unexpected error occurred: ${error.message}` }, { status: 500 });
  }
}

// CORS Preflight
export async function OPTIONS(req: any) {
  return corsPreflightResponse(getCorsOrigin(req.headers.get('origin')));
}
