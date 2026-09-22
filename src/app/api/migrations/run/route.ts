import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { jsonError, requireProjectAccess } from '@/lib/project-auth';
import { quotePgProjectSchema } from '@/lib/sql-safety';
import { ERROR_CODES, FluxbaseError } from '@/lib/error-codes';
import { assertWriteScope } from '@/lib/require-scope';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const pool = getPgPool();
    let migrationId: string | undefined;

    try {
        const { projectId, migrationId: bodyMigrationId, direction } = await req.json();
        migrationId = bodyMigrationId;
        const auth = await getAuthContextFromRequest(req);
        assertWriteScope(auth);
        if (!projectId || !migrationId) {
            throw new FluxbaseError('projectId and migrationId are required', ERROR_CODES.MISSING_FIELD, 400);
        }

        await requireProjectAccess(projectId, auth, ['admin', 'developer']);

        const mRes = await pool.query(
            `SELECT * FROM fluxbase_global.migrations WHERE id = $1 AND project_id = $2`,
            [migrationId, projectId]
        );
        if (mRes.rows.length === 0) throw new FluxbaseError('Migration not found', ERROR_CODES.BAD_REQUEST, 404);
        const migration = mRes.rows[0];

        const sql = direction === 'down' ? migration.down_sql : migration.up_sql;
        if (!sql) throw new FluxbaseError('No SQL for this direction', ERROR_CODES.BAD_REQUEST, 400);

        const schemaIdent = quotePgProjectSchema(projectId);
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO ${schemaIdent}`);
            await client.query(sql);
            await client.query('COMMIT');
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }

        await pool.query(
            `UPDATE fluxbase_global.migrations SET status = $1, applied_at = $2, error = NULL WHERE id = $3 AND project_id = $4`,
            [direction === 'down' ? 'pending' : 'applied', direction === 'down' ? null : new Date().toISOString(), migrationId, projectId]
        );

        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (migrationId) {
            await pool.query(
                `UPDATE fluxbase_global.migrations SET status = 'failed', error = $1 WHERE id = $2`,
                [error instanceof Error ? error.message : String(error), migrationId]
            ).catch(() => undefined);
        }

        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
