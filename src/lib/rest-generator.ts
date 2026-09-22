/**
 * Auto-REST generator: creates CRUD route handlers for any table in a project schema.
 * Supabase-style: given a project and table name, returns list/create/update/delete functionality.
 */

import { getTenantPgPool } from '@/lib/tenant-pools';

export interface RestListOptions {
    page?: number;
    limit?: number;
    order_by?: string;
    order_dir?: 'asc' | 'desc';
    filters?: Record<string, any>;
}

/**
 * List rows from a table with pagination.
 */
export async function listRows(
    project: any,
    table: string,
    options: RestListOptions = {}
) {
    const { page = 1, limit = 50, order_by, order_dir = 'asc', filters = {} } = options;
    const schema = project.schema_name || `project_${project.project_id}`;
    const pool = await getTenantPgPool(project);

    const offset = (page - 1) * limit;
    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (const [col, val] of Object.entries(filters)) {
        if (val === undefined || val === null) continue;
        whereClauses.push(`"${col}" = $${paramIdx++}`);
        params.push(val);
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const orderSQL = order_by ? `ORDER BY "${order_by}" ${order_dir.toUpperCase()}` : '';

    // Run count and paginated data queries concurrently
    const [countResult, dataResult] = await Promise.all([
        pool.query(
            `SELECT COUNT(*) as total FROM "${schema}"."${table}" ${whereSQL}`,
            params
        ),
        pool.query(
            `SELECT * FROM "${schema}"."${table}" ${whereSQL} ${orderSQL} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, limit, offset]
        ),
    ]);

    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    return {
        data: dataResult.rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Get a single row by ID.
 */
export async function getRow(project: any, table: string, id: string | number) {
    const schema = project.schema_name || `project_${project.project_id}`;
    const pool = await getTenantPgPool(project);
    const result = await pool.query(
        `SELECT * FROM "${schema}"."${table}" WHERE id = $1 LIMIT 1`,
        [id]
    );
    return result.rows[0] || null;
}

/**
 * Insert a row.
 */
export async function insertRow(project: any, table: string, data: Record<string, any>) {
    const schema = project.schema_name || `project_${project.project_id}`;
    const pool = await getTenantPgPool(project);

    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const colNames = columns.map(c => `"${c}"`).join(', ');

    const result = await pool.query(
        `INSERT INTO "${schema}"."${table}" (${colNames}) VALUES (${placeholders}) RETURNING *`,
        values
    );
    return result.rows[0];
}

/**
 * Update a row by ID.
 */
export async function updateRow(project: any, table: string, id: string | number, data: Record<string, any>) {
    const schema = project.schema_name || `project_${project.project_id}`;
    const pool = await getTenantPgPool(project);

    const setClauses = Object.keys(data).map((col, i) => `"${col}" = $${i + 2}`).join(', ');
    const values = [id, ...Object.values(data)];

    const result = await pool.query(
        `UPDATE "${schema}"."${table}" SET ${setClauses} WHERE id = $1 RETURNING *`,
        values
    );
    return result.rows[0] || null;
}

/**
 * Delete a row by ID.
 */
export async function deleteRow(project: any, table: string, id: string | number) {
    const schema = project.schema_name || `project_${project.project_id}`;
    const pool = await getTenantPgPool(project);

    const result = await pool.query(
        `DELETE FROM "${schema}"."${table}" WHERE id = $1 RETURNING id`,
        [id]
    );
    return result.rows.length > 0;
}

/**
 * Sanitize a table name to prevent SQL injection.
 * Only allows alphanumeric + underscore.
 */
export function sanitizeTableName(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (cleaned !== name || !cleaned) {
        throw new Error(`Invalid table name: ${name}`);
    }
    return cleaned;
}