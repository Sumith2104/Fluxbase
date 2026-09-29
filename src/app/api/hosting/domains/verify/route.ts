import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getPgPool } from '@/lib/pg';
import { getProjectById } from '@/lib/data';
import dns from 'dns/promises';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await req.json();
        const { siteId } = body;
        if (!siteId) return NextResponse.json({ success: false, error: 'siteId required' }, { status: 400 });

        const pool = getPgPool();
        const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
        const site = siteRes.rows[0];
        if (!site || !site.custom_domain) {
            return NextResponse.json({ success: false, error: 'No custom domain configured' }, { status: 400 });
        }

        const project = await getProjectById(site.project_id, auth.userId);
        if (!project) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });

        const domain = site.custom_domain;
        const expectedTarget = `${site.subdomain}.fluxbasedb.me`;
        let verified = false;
        let details = '';

        try {
            // Check CNAME records
            const cnames = await dns.resolveCname(domain);
            if (cnames.some(c => c.toLowerCase().includes(expectedTarget.toLowerCase()) || c.toLowerCase().includes('fluxbasedb.me'))) {
                verified = true;
                details = `CNAME matched: ${cnames.join(', ')}`;
            }
        } catch (dnsErr: any) {
            // Fallback: check A records if pointing directly to EC2 IP
            try {
                const aRecords = await dns.resolve4(domain);
                if (aRecords.includes('13.206.125.88')) {
                    verified = true;
                    details = `A record matches server IP: ${aRecords.join(', ')}`;
                } else {
                    details = `DNS lookup found A records: ${aRecords.join(', ')}, expected CNAME to ${expectedTarget}`;
                }
            } catch (aErr: any) {
                details = `DNS query failed: ${dnsErr.code || dnsErr.message}`;
            }
        }

        const now = new Date();
        await pool.query(
            `UPDATE fluxbase_global.hosting_domain_verifications 
             SET verified = $1, last_check_at = $2 
             WHERE site_id = $3 AND domain = $4`,
            [verified, now, siteId, domain]
        );

        if (verified) {
            await pool.query(
                `UPDATE fluxbase_global.hosting_sites 
                 SET custom_domain_verified = true, updated_at = $1 
                 WHERE site_id = $2`,
                [now, siteId]
            );
        }

        return NextResponse.json({
            success: true,
            verified,
            domain,
            details,
            cnameTarget: expectedTarget
        });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
