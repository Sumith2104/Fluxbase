import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope, requireReadScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getProjectById } from '@/lib/data';
import { checkHostingCustomDomainLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    if (!siteId) return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireReadScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    try {
        const pool = getPgPool();
        const verRes = await pool.query(
            'SELECT * FROM fluxbase_global.hosting_domain_verifications WHERE site_id = $1 ORDER BY created_at DESC',
            [siteId]
        );
        return NextResponse.json({ success: true, verifications: verRes.rows });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await req.json();
        const { siteId, domain } = body;

        if (!siteId || !domain) {
            return NextResponse.json({ success: false, error: 'siteId and domain are required' }, { status: 400 });
        }

        const cleanDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(cleanDomain)) {
            return NextResponse.json({ success: false, error: 'Invalid domain format' }, { status: 400 });
        }

        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        await checkHostingCustomDomainLimit(site.project_id);

        // Check if domain is already in use
        const conflict = await pool.query(
            'SELECT site_id FROM fluxbase_global.hosting_sites WHERE custom_domain = $1 AND site_id != $2',
            [cleanDomain, siteId]
        );
        if (conflict.rows.length > 0) {
            return NextResponse.json({ success: false, error: 'This domain is already mapped to another site' }, { status: 409 });
        }

        // Expected CNAME points to <subdomain>.fluxbasedb.me
        const expectedCname = `${site.subdomain}.fluxbasedb.me`;
        const verificationKey = `_fluxbase.${cleanDomain}`;
        const verificationValue = `fluxbase-verify=${site.site_id}`;

        const verRes = await pool.query(
            `INSERT INTO fluxbase_global.hosting_domain_verifications (
                site_id, domain, verification_type, verification_key, verification_value, verified
            ) VALUES ($1, $2, 'CNAME', $3, $4, false)
            RETURNING *`,
            [siteId, cleanDomain, verificationKey, expectedCname]
        );

        await pool.query(
            `UPDATE fluxbase_global.hosting_sites
             SET custom_domain = $1, custom_domain_verified = false, updated_at = CURRENT_TIMESTAMP
             WHERE site_id = $2`,
            [cleanDomain, siteId]
        );

        return NextResponse.json({
            success: true,
            domain: cleanDomain,
            cnameTarget: expectedCname,
            verification: verRes.rows[0],
            dnsInstructions: {
                type: 'CNAME',
                name: cleanDomain.startsWith('www.') ? 'www' : '@',
                value: expectedCname
            }
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    if (!siteId) return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });

    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    try {
        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site) return NextResponse.json({ success: false, error: 'Site not found' }, { status: 404 });

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        if (site.custom_domain) {
            try {
                const { redis } = await import('@/lib/redis');
                await redis.del(`hosting:site:${site.custom_domain}`);
            } catch {}
        }

        await pool.query(
            `UPDATE fluxbase_global.hosting_sites 
             SET custom_domain = NULL, custom_domain_verified = false, updated_at = CURRENT_TIMESTAMP 
             WHERE site_id = $1`,
            [siteId]
        );

        await pool.query('DELETE FROM fluxbase_global.hosting_domain_verifications WHERE site_id = $1', [siteId]);

        return NextResponse.json({ success: true, message: 'Custom domain removed' });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
