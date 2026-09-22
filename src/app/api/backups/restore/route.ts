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
import { assertAdminScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function normalizePgType(dataType: string, udtName?: string): string {
    const rawType = (dataType || 'text').toUpperCase().trim();
    const udt = (udtName || '').toLowerCase().trim();

    if (udt === 'uuid') return 'UUID';
    if (udt === 'timestamptz' || rawType.includes('WITH TIME ZONE')) return 'TIMESTAMPTZ';
    if (udt === 'timestamp' || rawType.includes('WITHOUT TIME ZONE')) return 'TIMESTAMP';
    if (udt === 'jsonb') return 'JSONB';
    if (udt === 'json') return 'JSON';
    if (udt === 'bool' || rawType === 'BOOLEAN') return 'BOOLEAN';
    if (udt === 'int4' || rawType === 'INTEGER') return 'INT';
    if (udt === 'int8' || rawType === 'BIGINT') return 'BIGINT';
    if (udt === 'int2' || rawType === 'SMALLINT') return 'SMALLINT';
    if (udt === 'float4' || udt === 'float8' || rawType.includes('DOUBLE') || rawType.includes('FLOAT')) return 'DOUBLE PRECISION';
    if (udt === 'numeric' || rawType.startsWith('NUMERIC') || rawType.startsWith('DECIMAL')) return 'NUMERIC';
    if (rawType.startsWith('VARCHAR') || rawType.startsWith('CHARACTER VARYING')) return 'VARCHAR(255)';
    if (rawType.startsWith('CHAR')) return 'CHAR(255)';
    if (rawType === 'DATE') return 'DATE';
    if (rawType === 'TIME' || rawType.includes('TIME WITHOUT')) return 'TIME';
    if (rawType === 'ARRAY') return 'TEXT[]';
    if (rawType === 'USER-DEFINED') return 'TEXT';
    
    return 'TEXT';
}

function normalizeMysqlType(dataType: string): string {
    const raw = (dataType || 'text').toUpperCase().trim();
    if (raw === 'NUMBER' || raw === 'NUMERIC' || raw.includes('DOUBLE') || raw.includes('FLOAT')) return 'DOUBLE';
    if (raw.startsWith('VARCHAR') || raw.startsWith('CHARACTER VARYING')) return 'VARCHAR(255)';
    if (raw === 'BOOLEAN' || raw === 'BOOL' || raw === 'TINYINT') return 'TINYINT(1)';
    if (raw === 'JSONB' || raw === 'JSON') return 'JSON';
    if (raw === 'INT' || raw === 'INTEGER') return 'INT';
    if (raw === 'BIGINT') return 'BIGINT';
    if (raw === 'DATETIME' || raw === 'TIMESTAMPTZ' || raw === 'TIMESTAMP') return 'DATETIME';
    if (raw === 'DATE') return 'DATE';
    if (raw === 'TEXT' || raw === 'LONGTEXT') return 'LONGTEXT';
    return 'TEXT';
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, backupId } = body;
        const auth = await getAuthContextFromRequest(req);
        assertAdminScope(auth);

        if (!projectId || !backupId) {
            throw new FluxbaseError('projectId and backupId are required', ERROR_CODES.MISSING_FIELD, 400);
        }

        const project = await requireProjectAccess(projectId, auth, ['admin']);
        const globalPool = getPgPool();

        // Fetch backup payload
        const backupRes = await globalPool.query(
            `SELECT data, label FROM fluxbase_global.backups WHERE id = $1 AND project_id = $2`,
            [backupId, projectId]
        );

        if (backupRes.rows.length === 0) {
            return NextResponse.json({ success: false, error: { message: 'Backup not found' } }, { status: 404 });
        }

        let backupData = backupRes.rows[0]?.data;
        if (typeof backupData === 'string') {
            try {
                backupData = JSON.parse(backupData);
            } catch {
                throw new FluxbaseError('Backup data could not be parsed.', ERROR_CODES.BAD_REQUEST, 400);
            }
        }

        const tables = backupData?.tables;
        if (!tables || typeof tables !== 'object') {
            throw new FluxbaseError('Backup has invalid or empty tables payload.', ERROR_CODES.BAD_REQUEST, 400);
        }

        const isMysql = project.dialect?.toLowerCase() === 'mysql';
        const { dbName, schemaName } = getProjectDbAndSchema(project);

        if (isMysql) {
            const mysqlPool = await getTenantMysqlPool(project);
            const targetDb = dbName ? quoteMysqlIdentifier(dbName, 'dbName') : '';

            if (dbName) {
                await (mysqlPool as any).query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
            }

            for (const [tableName, tableInfo] of Object.entries(tables)) {
                const { columns = [], primaryKeys = [], rows = [] } = tableInfo as any;
                if (!Array.isArray(columns) || columns.length === 0) continue;

                const tableIdent = quoteMysqlIdentifier(tableName, 'tableName');
                const tableFullRef = targetDb ? `${targetDb}.${tableIdent}` : tableIdent;

                await (mysqlPool as any).query(`DROP TABLE IF EXISTS ${tableFullRef}`);

                const colDefs = columns.map((c: any) => {
                    const colName = quoteMysqlIdentifier(c.column_name, 'columnName');
                    const colType = normalizeMysqlType(c.data_type);
                    return `${colName} ${colType}`;
                });

                let pkClause = '';
                if (Array.isArray(primaryKeys) && primaryKeys.length > 0) {
                    const pkList = primaryKeys.map((k: string) => quoteMysqlIdentifier(k, 'columnName')).join(', ');
                    pkClause = `, PRIMARY KEY (${pkList})`;
                }

                await (mysqlPool as any).query(`CREATE TABLE ${tableFullRef} (${colDefs.join(', ')}${pkClause})`);

                if (Array.isArray(rows) && rows.length > 0) {
                    const colNamesArr = columns.map((c: any) => c.column_name);
                    const quotedCols = colNamesArr.map((name: string) => quoteMysqlIdentifier(name, 'columnName')).join(', ');
                    const BATCH_SIZE = 250;

                    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                        const chunk = rows.slice(i, i + BATCH_SIZE);
                        const placeholders: string[] = [];
                        const values: any[] = [];

                        for (const row of chunk) {
                            const rowPhs: string[] = [];
                            for (const col of colNamesArr) {
                                let val = row[col];
                                if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
                                    val = JSON.stringify(val);
                                }
                                values.push(val);
                                rowPhs.push('?');
                            }
                            placeholders.push(`(${rowPhs.join(', ')})`);
                        }

                        const query = `INSERT INTO ${tableFullRef} (${quotedCols}) VALUES ${placeholders.join(', ')}`;
                        await (mysqlPool as any).query(query, values);
                    }
                }
            }
        } else {
            const tenantPgPool = await getTenantPgPool(project);
            const client = await tenantPgPool.connect();

            try {
                await client.query('BEGIN');
                const schemaIdent = quotePgIdentifier(schemaName, 'schemaName');
                await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`);

                for (const [tableName, tableInfo] of Object.entries(tables)) {
                    const { columns = [], primaryKeys = [], rows = [] } = tableInfo as any;
                    if (!Array.isArray(columns) || columns.length === 0) continue;

                    const tableIdent = quotePgIdentifier(tableName, 'tableName');
                    await client.query(`DROP TABLE IF EXISTS ${schemaIdent}.${tableIdent} CASCADE`);

                    const colDefs = columns.map((c: any) => {
                        const colName = quotePgIdentifier(c.column_name, 'columnName');
                        const colType = normalizePgType(c.data_type, c.udt_name);
                        return `${colName} ${colType}`;
                    });

                    let pkClause = '';
                    if (Array.isArray(primaryKeys) && primaryKeys.length > 0) {
                        const pkList = primaryKeys.map((k: string) => quotePgIdentifier(k, 'columnName')).join(', ');
                        pkClause = `, PRIMARY KEY (${pkList})`;
                    }

                    await client.query(`CREATE TABLE ${schemaIdent}.${tableIdent} (${colDefs.join(', ')}${pkClause})`);

                    if (Array.isArray(rows) && rows.length > 0) {
                        const colNamesArr = columns.map((c: any) => c.column_name);
                        const quotedCols = colNamesArr.map((name: string) => quotePgIdentifier(name, 'columnName')).join(', ');
                        const BATCH_SIZE = 250;

                        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                            const chunk = rows.slice(i, i + BATCH_SIZE);
                            const placeholders: string[] = [];
                            const values: any[] = [];
                            let paramIdx = 1;

                            for (const row of chunk) {
                                const rowPhs: string[] = [];
                                for (const col of colNamesArr) {
                                    let val = row[col];
                                    if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
                                        val = JSON.stringify(val);
                                    }
                                    values.push(val);
                                    rowPhs.push(`$${paramIdx++}`);
                                }
                                placeholders.push(`(${rowPhs.join(', ')})`);
                            }

                            const query = `INSERT INTO ${schemaIdent}.${tableIdent} (${quotedCols}) VALUES ${placeholders.join(', ')}`;
                            await client.query(query, values);
                        }
                    }
                }

                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }

        // Invalidate Redis caches so dashboard & editor immediately update
        try {
            const { redis } = await import('@/lib/redis');
            await redis.del(`project_analytics_${projectId}`, `schema_inference_${projectId}`);
        } catch {}

        return NextResponse.json({ success: true, message: 'Database restored successfully' });
    } catch (error) {
        logger.error('Restore failed:', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
