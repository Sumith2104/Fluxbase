import { POST as executeSqlPost, OPTIONS as executeSqlOptions } from '@/app/api/execute-sql/route';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sql
 * Standard v1 REST SQL execution endpoint.
 * Accepts: { projectId: string, query: string, params?: any[] }
 * Returns: { success: boolean, rows: any[], rowCount: number, columns?: string[], ... }
 */
export async function POST(req: NextRequest) {
    return executeSqlPost(req);
}

export async function OPTIONS(req: NextRequest) {
    return executeSqlOptions(req);
}
