import { NextRequest, NextResponse } from 'next/server';
import { getPgPool } from '@/lib/pg';
import { ModelGateway } from '@/lib/agent-core/gateway';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function getHostFromHeader(header: string | null): string {
    if (!header) return '';
    try {
        const u = new URL(header.startsWith('http') ? header : `https://${header}`);
        return u.hostname.toLowerCase();
    } catch {
        return header.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
    }
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin') || '*';
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}

export async function POST(req: NextRequest) {
    const originHeader = req.headers.get('origin');
    const refererHeader = req.headers.get('referer');
    const callingHost = getHostFromHeader(originHeader) || getHostFromHeader(refererHeader);

    if (!callingHost) {
        return NextResponse.json({ success: false, error: 'Origin or Referer header required' }, { status: 403 });
    }

    const pool = getPgPool();
    let site: any = null;

    if (callingHost.endsWith('.preview.fluxbasedb.me')) {
        const deployId = callingHost.replace('.preview.fluxbasedb.me', '');
        const res = await pool.query(
            `SELECT s.* FROM fluxbase_global.hosting_sites s 
             JOIN fluxbase_global.hosting_deployments d ON d.site_id = s.site_id 
             WHERE d.deploy_id = $1`,
            [deployId]
        );
        site = res.rows[0];
    } else if (callingHost.endsWith('.fluxbasedb.me')) {
        const subdomain = callingHost.replace('.fluxbasedb.me', '');
        const res = await pool.query(
            'SELECT * FROM fluxbase_global.hosting_sites WHERE subdomain = $1',
            [subdomain]
        );
        site = res.rows[0];
    } else {
        // Custom domain lookup
        const res = await pool.query(
            'SELECT * FROM fluxbase_global.hosting_sites WHERE custom_domain = $1',
            [callingHost]
        );
        site = res.rows[0];
    }

    if (!site) {
        return NextResponse.json({ success: false, error: 'Origin is not an authorized Flux-hosted site' }, { status: 403 });
    }

    if (!site.ai_models_enabled) {
        return NextResponse.json({
            success: false,
            error: 'Flux AI Models access is not enabled for this site. Enable it in your Fluxbase Hosting dashboard.'
        }, { status: 403 });
    }

    const origin = originHeader || (refererHeader ? new URL(refererHeader).origin : '*');
    const cors = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        const body = await req.json();
        const { messages, model = 'flux-pro', temperature = 0.7, max_tokens } = body;

        if (!messages || !Array.isArray(messages)) {
            return NextResponse.json({ success: false, error: 'messages array is required' }, { status: 400, headers: cors });
        }

        // Execute inference via ModelGateway
        const result = await ModelGateway.generate({
            model,
            messages,
            temperature,
            max_tokens
        });

        return NextResponse.json({
            success: true,
            model: result.model,
            provider: result.provider,
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: result.text
                    }
                }
            ],
            usage: result.usage
        }, { headers: cors });

    } catch (err: any) {
        logger.error('[Hosting AI Proxy Error]:', err);
        return NextResponse.json({ success: false, error: err.message || 'AI generation failed' }, { status: 500, headers: cors });
    }
}
