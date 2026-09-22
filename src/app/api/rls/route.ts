import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { getAuthContextFromRequest } from '@/lib/auth';
import { jsonError, requireProjectAccess } from '@/lib/project-auth';
import {
    quotePgIdentifier,
    quotePgProjectSchema,
    validateRlsCommand,
    validateRlsExpression,
} from '@/lib/sql-safety';
import { ERROR_CODES, FluxbaseError } from '@/lib/error-codes';
import { assertReadScope, assertWriteScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const ensureRlsCatalog = async (pool: any) => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS fluxbase_global.rls_policies (
            id SERIAL PRIMARY KEY,
            project_id TEXT NOT NULL,
            table_name TEXT NOT NULL,
            policy_name TEXT NOT NULL,
            command TEXT NOT NULL DEFAULT 'ALL',
            expression TEXT NOT NULL DEFAULT 'true',
            enabled BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(project_id, table_name, policy_name)
        )
    `);
};

async function assertTableExists(pool: any, schemaName: string, tableName: string) {
    const tableRes = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'`,
        [schemaName, tableName]
    );
    if (tableRes.rows.length === 0) {
        throw new FluxbaseError('Table not found', ERROR_CODES.TABLE_NOT_FOUND, 404);
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');
        const auth = await getAuthContextFromRequest(req);
        assertReadScope(auth);
        if (!projectId) throw new FluxbaseError('projectId is required', ERROR_CODES.MISSING_FIELD, 400);

        const project = await requireProjectAccess(projectId, auth);
        const { getProjectDbAndSchema } = await import('@/lib/tenant-pools');
        const { schemaName } = getProjectDbAndSchema(project);

        const pool = getPgPool();

        let tablesRes = await pool.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name NOT LIKE '_flux_internal_%' ORDER BY table_name`,
            [schemaName]
        );

        if (tablesRes.rows.length === 0 && schemaName !== 'public') {
            tablesRes = await pool.query(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name NOT LIKE '_flux_internal_%' ORDER BY table_name`
            );
        }

        await ensureRlsCatalog(pool);

        const policiesRes = await pool.query(
            `SELECT id, table_name as "tableName", policy_name as "policyName", command, expression, enabled, created_at as "createdAt"
             FROM fluxbase_global.rls_policies WHERE project_id = $1 ORDER BY table_name, policy_name`,
            [projectId]
        );

        return NextResponse.json({
            tables: tablesRes.rows.map(r => r.table_name),
            policies: policiesRes.rows,
        });
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, tableName, policyName } = body;
        const auth = await getAuthContextFromRequest(req);
        assertWriteScope(auth);
        if (!projectId || !tableName || !policyName) {
            throw new FluxbaseError('projectId, tableName, and policyName are required', ERROR_CODES.MISSING_FIELD, 400);
        }

        await requireProjectAccess(projectId, auth, ['admin']);

        const pool = getPgPool();
        const schemaName = `project_${projectId}`;
        const schemaIdent = quotePgProjectSchema(projectId);
        const tableIdent = quotePgIdentifier(tableName, 'tableName');
        const policyIdent = quotePgIdentifier(policyName, 'policyName');
        const sqlCommand = validateRlsCommand(body.command);
        const safeExpression = validateRlsExpression(body.expression ?? 'true');

        await ensureRlsCatalog(pool);
        await assertTableExists(pool, schemaName, tableName);

        await pool.query(
            `INSERT INTO fluxbase_global.rls_policies (project_id, table_name, policy_name, command, expression)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (project_id, table_name, policy_name)
             DO UPDATE SET expression = EXCLUDED.expression, command = EXCLUDED.command`,
            [projectId, tableName, policyName, sqlCommand, safeExpression]
        );

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`ALTER TABLE ${schemaIdent}.${tableIdent} ENABLE ROW LEVEL SECURITY`);
            await client.query(`ALTER TABLE ${schemaIdent}.${tableIdent} FORCE ROW LEVEL SECURITY`);
            await client.query(`DROP POLICY IF EXISTS ${policyIdent} ON ${schemaIdent}.${tableIdent}`);
            await client.query(`CREATE POLICY ${policyIdent} ON ${schemaIdent}.${tableIdent} FOR ${sqlCommand} TO PUBLIC USING (${safeExpression})`);
            await client.query('COMMIT');
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('[RLS Save Error]', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');
        const tableName = searchParams.get('tableName');
        const policyName = searchParams.get('policyName');
        const auth = await getAuthContextFromRequest(req);
        assertWriteScope(auth);
        if (!projectId || !tableName || !policyName) {
            throw new FluxbaseError('projectId, tableName, and policyName are required', ERROR_CODES.MISSING_FIELD, 400);
        }

        await requireProjectAccess(projectId, auth, ['admin']);

        const pool = getPgPool();
        const schemaName = `project_${projectId}`;
        const schemaIdent = quotePgProjectSchema(projectId);
        const tableIdent = quotePgIdentifier(tableName, 'tableName');
        const policyIdent = quotePgIdentifier(policyName, 'policyName');

        await ensureRlsCatalog(pool);
        await assertTableExists(pool, schemaName, tableName);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DROP POLICY IF EXISTS ${policyIdent} ON ${schemaIdent}.${tableIdent}`);
            await client.query(
                `DELETE FROM fluxbase_global.rls_policies WHERE project_id = $1 AND table_name = $2 AND policy_name = $3`,
                [projectId, tableName, policyName]
            );

            const others = await client.query(
                `SELECT id FROM fluxbase_global.rls_policies WHERE project_id = $1 AND table_name = $2 AND enabled = true`,
                [projectId, tableName]
            );
            if (others.rows.length === 0) {
                await client.query(`ALTER TABLE ${schemaIdent}.${tableIdent} DISABLE ROW LEVEL SECURITY`);
            }

            await client.query('COMMIT');
            return NextResponse.json({ success: true });
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }
    } catch (error) {
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
