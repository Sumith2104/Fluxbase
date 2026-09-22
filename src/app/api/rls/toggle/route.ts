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
import { assertWriteScope } from '@/lib/require-scope';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, tableName, policyName, enabled } = body;
        const auth = await getAuthContextFromRequest(req);
        assertWriteScope(auth);

        if (!projectId || !tableName || !policyName) {
            throw new FluxbaseError('projectId, tableName, and policyName are required', ERROR_CODES.MISSING_FIELD, 400);
        }

        await requireProjectAccess(projectId, auth, ['admin']);

        const pool = getPgPool();
        const schemaIdent = quotePgProjectSchema(projectId);
        const tableIdent = quotePgIdentifier(tableName, 'tableName');
        const policyIdent = quotePgIdentifier(policyName, 'policyName');

        await pool.query(
            `UPDATE fluxbase_global.rls_policies SET enabled = $1
             WHERE project_id = $2 AND table_name = $3 AND policy_name = $4`,
            [Boolean(enabled), projectId, tableName, policyName]
        );

        const policyRes = await pool.query(
            `SELECT command, expression FROM fluxbase_global.rls_policies
             WHERE project_id = $1 AND table_name = $2 AND policy_name = $3`,
            [projectId, tableName, policyName]
        );

        if (policyRes.rows.length === 0) {
            throw new FluxbaseError('Policy not found', ERROR_CODES.BAD_REQUEST, 404);
        }

        const sqlCommand = validateRlsCommand(policyRes.rows[0].command);
        const safeExpression = validateRlsExpression(policyRes.rows[0].expression);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (enabled) {
                await client.query(`ALTER TABLE ${schemaIdent}.${tableIdent} ENABLE ROW LEVEL SECURITY`);
                await client.query(`ALTER TABLE ${schemaIdent}.${tableIdent} FORCE ROW LEVEL SECURITY`);
                await client.query(`DROP POLICY IF EXISTS ${policyIdent} ON ${schemaIdent}.${tableIdent}`);
                await client.query(`CREATE POLICY ${policyIdent} ON ${schemaIdent}.${tableIdent} FOR ${sqlCommand} TO PUBLIC USING (${safeExpression})`);
            } else {
                await client.query(`DROP POLICY IF EXISTS ${policyIdent} ON ${schemaIdent}.${tableIdent}`);

                const otherPolicies = await client.query(
                    `SELECT id FROM fluxbase_global.rls_policies
                     WHERE project_id = $1 AND table_name = $2 AND enabled = true`,
                    [projectId, tableName]
                );

                if (otherPolicies.rows.length === 0) {
                    await client.query(`ALTER TABLE ${schemaIdent}.${tableIdent} DISABLE ROW LEVEL SECURITY`);
                }
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
        logger.error('[RLS Toggle Error]', error);
        const { body, status } = jsonError(error);
        return NextResponse.json(body, { status });
    }
}
