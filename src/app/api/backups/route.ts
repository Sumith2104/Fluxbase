import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { jsonError, requireProjectAccess } from '@/lib/project-auth';
import { getTenantPgPool, getTenantMysqlPool, getProjectDbAndSchema } from '@/lib/tenant-pools';
import {
    quoteMysqlIdentifier,
    quotePgIdentifier,
} from '@/lib/sql-safety';
import { ERROR_CODES, FluxbaseError } from '@/lib/error-codes';
import { assertReadScope, assertWriteScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ensureTable = async (pool: any) => {
    await pool.query(`
        CREATE SCHEMA IF NOT EXISTS fluxbase_global;
        CREATE TABLE IF NOT EXISTS fluxbase_global.backups (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            project_id TEXT NOT NULL,
            label TEXT NOT NULL,
            type TEXT DEFAULT 'manual',
            status TEXT DEFAULT 'completed',
            size_bytes BIGINT,
            data JSONB,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        ALTER TABLE fluxbase_global.backups
        ADD COLUMN IF NOT EXISTS data JSONB;

        DO $$
        BEGIN
            ALTER TABLE fluxbase_global.backups DISABLE TRIGGER ALL;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END $$;
    `);
};

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');
        const backupId = searchParams.get('backupId');
        const auth = await getAuthContextFromRequest(req);
        assertReadScope(auth);
        if (!projectId) throw new FluxbaseError('projectId is required', ERROR_CODES.MISSING_FIELD, 400);

        await requireProjectAccess(projectId, auth);

        const pool = getPgPool();
        await ensureTable(pool);

        if (backupId) {
            const res = await pool.query(
                `SELECT id, label, type, status, size_bytes as "sizeBytes", data, expires_at as "expiresAt", created_at as "createdAt"
                 FROM fluxbase_global.backups WHERE project_id = $1 AND id = $2`,
                [projectId, backupId]
            );
            if (res.rows.length === 0) {
                return NextResponse.json({ success: false, error: { message: 'Backup not found' } }, { status: 404 });
            }
            return NextResponse.json({ success: true, backup: res.rows[0] });
        }

        const res = await pool.query(
            `SELECT id, label, type, status, size_bytes as "sizeBytes", expires_at as "expiresAt", created_at as "createdAt"
             FROM fluxbase_global.backups WHERE project_id = $1 ORDER BY created_at DESC`,
            [projectId]
        );
        return NextResponse.json({ success: true, backups: res.rows });
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId } = body;
        const auth = await getAuthContextFromRequest(req);
        assertWriteScope(auth);
        if (!projectId) throw new FluxbaseError('projectId is required', ERROR_CODES.MISSING_FIELD, 400);

        const globalPool = getPgPool();
        await ensureTable(globalPool);

        const project = await requireProjectAccess(projectId, auth, ['admin', 'developer']);
        const isMysql = project.dialect?.toLowerCase() === 'mysql';
        const { dbName, schemaName } = getProjectDbAndSchema(project);

        const label = `Manual Backup - ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

        const backupData: { tables: Record<string, { columns: any[]; primaryKeys: string[]; rows: any[] }> } = { tables: {} };
        let totalSizeBytes = 0;

        if (isMysql) {
            const mysqlPool = await getTenantMysqlPool(project);
            let [tables]: any = await mysqlPool.query(
                `SELECT TABLE_NAME as table_name, (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) as size
                 FROM information_schema.tables 
                 WHERE table_schema = ? AND table_type = 'BASE TABLE'
                 AND table_name NOT LIKE '\\_flux\\_internal\\_%'`,
                [dbName]
            );

            if (!tables || tables.length === 0) {
                [tables] = await mysqlPool.query(
                    `SELECT TABLE_NAME as table_name, (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) as size
                     FROM information_schema.tables 
                     WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') 
                     AND table_type = 'BASE TABLE'
                     AND table_name NOT LIKE '\\_flux\\_internal\\_%'`
                );
            }

            for (const table of (tables || [])) {
                const tableName = table.table_name;
                const tableIdent = quoteMysqlIdentifier(tableName, 'tableName');
                const targetDb = dbName ? quoteMysqlIdentifier(dbName, 'dbName') : '';
                const tableFullRef = targetDb ? `${targetDb}.${tableIdent}` : tableIdent;

                const [rows]: any = await mysqlPool.query(`SELECT * FROM ${tableFullRef}`);
                const [cols]: any = await mysqlPool.query(
                    `SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE as is_nullable, 
                            COLUMN_DEFAULT as column_default, COLUMN_KEY as column_key, CHARACTER_MAXIMUM_LENGTH as max_length
                     FROM information_schema.columns 
                     WHERE ${dbName ? 'TABLE_SCHEMA = ? AND' : ''} TABLE_NAME = ?`,
                    dbName ? [dbName, tableName] : [tableName]
                );

                const pkCols = (cols || []).filter((c: any) => c.column_key === 'PRI').map((c: any) => c.column_name);

                backupData.tables[tableName] = {
                    columns: cols || [],
                    primaryKeys: pkCols,
                    rows: rows || [],
                };
                totalSizeBytes += Number(table.size || 0);
            }
        } else {
            const tenantPgPool = await getTenantPgPool(project);
            let activeSchema = schemaName;

            let tablesRes = await tenantPgPool.query(
                `SELECT table_name, table_schema, COALESCE(pg_total_relation_size(format('%I.%I', table_schema, table_name)), 0) as size
                 FROM information_schema.tables 
                 WHERE table_schema = $1 AND table_type = 'BASE TABLE'
                 AND table_name NOT LIKE '_flux_internal_%'
                 AND table_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault')`,
                [schemaName]
            );

            if (tablesRes.rows.length === 0 && schemaName !== 'public') {
                tablesRes = await tenantPgPool.query(
                    `SELECT table_name, table_schema, COALESCE(pg_total_relation_size(format('%I.%I', table_schema, table_name)), 0) as size
                     FROM information_schema.tables 
                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                     AND table_name NOT LIKE '_flux_internal_%'
                     AND table_schema NOT IN ('fluxbase_global', 'pg_catalog', 'information_schema', 'cron', 'pgsodium', 'vault')`
                );
                if (tablesRes.rows.length > 0) activeSchema = 'public';
            }

            for (const row of tablesRes.rows) {
                const tableName = row.table_name;
                const tblSchema = row.table_schema || activeSchema;
                const schemaIdent = quotePgIdentifier(tblSchema, 'schemaName');
                const tableIdent = quotePgIdentifier(tableName, 'tableName');

                const dataRes = await tenantPgPool.query(`SELECT * FROM ${schemaIdent}.${tableIdent}`);
                const colRes = await tenantPgPool.query(
                    `SELECT column_name, data_type, udt_name, is_nullable, column_default
                     FROM information_schema.columns 
                     WHERE table_schema = $1 AND table_name = $2
                     ORDER BY ordinal_position ASC`,
                    [tblSchema, tableName]
                );

                const pkRes = await tenantPgPool.query(
                    `SELECT kcu.column_name
                     FROM information_schema.table_constraints tc
                     JOIN information_schema.key_column_usage kcu 
                       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
                    [tblSchema, tableName]
                );

                const primaryKeys = pkRes.rows.map(r => r.column_name);

                backupData.tables[tableName] = {
                    columns: colRes.rows,
                    primaryKeys,
                    rows: dataRes.rows,
                };
                totalSizeBytes += Number(row.size || 0);
            }
        }

        const res = await globalPool.query(
            `INSERT INTO fluxbase_global.backups (project_id, label, type, status, data, size_bytes, expires_at)
             VALUES ($1, $2, 'manual', 'completed', $3, $4, NOW() + INTERVAL '30 days')
             RETURNING id, label, status, size_bytes as "sizeBytes", created_at as "createdAt"`,
            [projectId, label, JSON.stringify(backupData), totalSizeBytes]
        );

        return NextResponse.json({ success: true, backup: res.rows[0] });
    } catch (error) {
        logger.error('Backup creation failed:', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');
        const backupId = searchParams.get('backupId');
        const auth = await getAuthContextFromRequest(req);
        assertWriteScope(auth);

        if (!projectId || !backupId) {
            throw new FluxbaseError('projectId and backupId are required', ERROR_CODES.MISSING_FIELD, 400);
        }

        await requireProjectAccess(projectId, auth, ['admin']);

        const pool = getPgPool();
        const res = await pool.query(
            `DELETE FROM fluxbase_global.backups WHERE id = $1 AND project_id = $2`,
            [backupId, projectId]
        );

        if (res.rowCount === 0) {
            return NextResponse.json({ success: false, error: { message: 'Backup not found' } }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Delete backup failed:', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
