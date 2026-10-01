import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireReadScope, requireWriteScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getProjectById } from '@/lib/data';
import { encryptEnvValue, decryptEnvValue, parseEnvFile, saveSiteEnvVars } from '@/lib/hosting-env';
import { checkHostingEnvVarLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const env = searchParams.get('environment'); // 'preview' | 'production' | null

    if (!siteId) {
        return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });
    }

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        let query = 'SELECT id, site_id, environment, key, value, is_secret, created_at, updated_at FROM fluxbase_global.hosting_env_vars WHERE site_id = $1';
        const params: any[] = [siteId];

        if (env && env !== 'all') {
            query += ' AND (environment = $2 OR environment = \'all\')';
            params.push(env);
        }

        query += ' ORDER BY key ASC';

        const res = await pool.query(query, params);

        const envVars = res.rows.map(row => {
            const isSecret = Boolean(row.is_secret);
            const decrypted = decryptEnvValue(row.value);
            return {
                id: row.id,
                environment: row.environment,
                key: row.key,
                // If it is secret, mask in response
                value: isSecret ? '••••••••••••' : decrypted,
                isSecret,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };
        });

        return NextResponse.json({ success: true, envVars });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { siteId, key, value, environment = 'production', isSecret, rawEnvText, envVars } = body;

        if (!siteId) {
            return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });
        }

        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        // Bulk paste or multiple variables handler
        if (rawEnvText || envVars) {
            const result = await saveSiteEnvVars({
                siteId,
                projectId: site.project_id,
                envVars,
                rawEnvText,
                environment
            });

            return NextResponse.json({
                success: true,
                message: `Saved ${result.savedCount} environment variables`,
                count: result.savedCount,
                items: result.items
            });
        }

        // Single key-value add or update
        if (!key || value === undefined) {
            return NextResponse.json({ success: false, error: 'key and value or envVars/rawEnvText are required' }, { status: 400 });
        }

        const result = await saveSiteEnvVars({
            siteId,
            projectId: site.project_id,
            envVars: [{ key, value, isSecret, environment }],
            environment
        });

        return NextResponse.json({ success: true, envVar: result.items[0] });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const siteId = searchParams.get('siteId');
    const key = searchParams.get('key');
    const environment = searchParams.get('environment');

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const pool = getPgPool();
        if (id) {
            await pool.query('DELETE FROM fluxbase_global.hosting_env_vars WHERE id = $1', [id]);
            return NextResponse.json({ success: true, message: 'Deleted variable' });
        } else if (siteId && key) {
            let q = 'DELETE FROM fluxbase_global.hosting_env_vars WHERE site_id = $1 AND key = $2';
            const params: any[] = [siteId, key];
            if (environment) {
                q += ' AND environment = $3';
                params.push(environment);
            }
            await pool.query(q, params);
            return NextResponse.json({ success: true, message: 'Deleted variable' });
        }
        return NextResponse.json({ success: false, error: 'id or (siteId and key) required' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
