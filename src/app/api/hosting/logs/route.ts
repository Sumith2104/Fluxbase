import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireReadScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getProjectById } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const deployId = searchParams.get('deployId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    if (!siteId) return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    try {
        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        let logQuery = `
            SELECT id, site_id, deploy_id, path, status_code, bytes_served, ip, user_agent, created_at 
            FROM fluxbase_global.hosting_access_logs 
            WHERE site_id = $1
        `;
        const params: any[] = [siteId];

        if (deployId) {
            logQuery += ' AND deploy_id = $2';
            params.push(deployId);
        }

        logQuery += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const logs = await pool.query(logQuery, params);

        // Aggregate stats (status code distribution and bandwidth)
        const statsRes = await pool.query(
            `SELECT 
                COUNT(*) as total_requests,
                COALESCE(SUM(bytes_served), 0) as total_bytes,
                COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as status_2xx,
                COUNT(CASE WHEN status_code >= 300 AND status_code < 400 THEN 1 END) as status_3xx,
                COUNT(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 END) as status_4xx,
                COUNT(CASE WHEN status_code >= 500 THEN 1 END) as status_5xx
             FROM fluxbase_global.hosting_access_logs
             WHERE site_id = $1 AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
            [siteId]
        );

        // Daily traffic timeseries for last 7 days
        const dailyRes = await pool.query(
            `SELECT 
                date_trunc('day', created_at) as day,
                COUNT(*) as requests,
                COALESCE(SUM(bytes_served), 0) as bytes
             FROM fluxbase_global.hosting_access_logs
             WHERE site_id = $1 AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
             GROUP BY date_trunc('day', created_at)
             ORDER BY day ASC`,
            [siteId]
        );

        // If deployId specified, fetch the build logs for this deployment
        let buildLogs = '';
        let deploymentInfo = null;
        if (deployId) {
            const depRes = await pool.query(
                `SELECT deploy_id, version, environment, status, error_message, build_logs, 
                        build_command, install_command, output_directory, created_at, deployed_at
                 FROM fluxbase_global.hosting_deployments 
                 WHERE deploy_id = $1`,
                [deployId]
            );
            if (depRes.rows.length > 0) {
                deploymentInfo = depRes.rows[0];
                buildLogs = depRes.rows[0].build_logs || '';
            }
        }

        return NextResponse.json({
            success: true,
            logs: logs.rows,
            summary: statsRes.rows[0] || {},
            daily: dailyRes.rows,
            buildLogs,
            deployment: deploymentInfo
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
