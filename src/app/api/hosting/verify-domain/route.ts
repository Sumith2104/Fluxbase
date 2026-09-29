import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';

export const dynamic = 'force-dynamic';

/**
 * Caddy On-Demand TLS Verification Endpoint
 * Caddy calls this with ?domain=<domain_to_issue_cert_for>
 * Return 200 OK if allowed to issue SSL cert, 404 otherwise.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const domain = (searchParams.get('domain') || '').trim().toLowerCase();

    if (!domain) {
        return new NextResponse('Domain parameter missing', { status: 400 });
    }

    try {
        const pool = getPgPool();

        // 1. Check if preview deployment subdomain: dep_xxx.preview.fluxbasedb.me
        if (domain.includes('.preview.fluxbasedb.me')) {
            const deployId = domain.replace('.preview.fluxbasedb.me', '');
            const depCheck = await pool.query(
                'SELECT deploy_id FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1 LIMIT 1',
                [deployId]
            );
            if (depCheck.rows.length > 0) {
                return new NextResponse('OK', { status: 200 });
            }
        }

        // 2. Check if main production subdomain: xxx.fluxbasedb.me
        if (domain.endsWith('.fluxbasedb.me')) {
            const subdomain = domain.replace('.fluxbasedb.me', '');
            const siteCheck = await pool.query(
                `SELECT site_id FROM fluxbase_global.hosting_sites 
                 WHERE subdomain = $1 AND status = 'active' LIMIT 1`,
                [subdomain]
            );
            if (siteCheck.rows.length > 0) {
                return new NextResponse('OK', { status: 200 });
            }
        }

        // 3. Check custom domains (must be verified or pending verification)
        const customCheck = await pool.query(
            `SELECT site_id FROM fluxbase_global.hosting_sites 
             WHERE custom_domain = $1 AND status = 'active' LIMIT 1`,
            [domain]
        );
        if (customCheck.rows.length > 0) {
            return new NextResponse('OK', { status: 200 });
        }

        return new NextResponse('Domain not registered on Fluxbase Hosting', { status: 404 });
    } catch {
        return new NextResponse('Internal verification error', { status: 500 });
    }
}
