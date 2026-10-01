import { getS3Client, getS3Bucket } from '@/lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getPgPool } from '@/lib/pg';
import { detectMimeType } from '@/lib/hosting-engine';
import { decryptEnvValue, injectEnvIntoHtml } from '@/lib/hosting-env';
import { evaluateSuperstaticRoute } from '@/lib/hosting-router';
import { FRAMEWORK_PRESETS } from '@/lib/hosting-frameworks';
import logger from '@/lib/logger';

export interface HostingServeResult {
    found: boolean;
    body?: Buffer | string;
    contentType?: string;
    statusCode: number;
    headers?: Record<string, string>;
    bytesServed?: number;
}

/**
 * Resolves the hosting site and deployment record from subdomain or host header.
 * Uses Redis cache when available.
 */
export async function resolveHostingSite(hostOrSubdomain: string) {
    let clean = hostOrSubdomain.toLowerCase().trim();
    // Remove port if present
    clean = clean.split(':')[0];

    let subdomain = '';
    let isPreview = false;
    let isBranchPreview = false;
    let previewDeployId = '';
    let branchName = '';
    let branchSubdomain = '';

    // Check if it's a preview domain: e.g. dep_abc123.preview.fluxbasedb.me or site-git-branch.preview.fluxbasedb.me
    if (clean.includes('.preview.fluxbasedb.me')) {
        isPreview = true;
        const prefix = clean.replace('.preview.fluxbasedb.me', '');
        if (prefix.includes('-git-')) {
            isBranchPreview = true;
            const gitIdx = prefix.indexOf('-git-');
            branchSubdomain = prefix.slice(0, gitIdx);
            branchName = prefix.slice(gitIdx + 5);
        } else {
            previewDeployId = prefix;
        }
    } else if (clean.endsWith('.fluxbasedb.me')) {
        subdomain = clean.replace('.fluxbasedb.me', '');
    } else {
        // Could be raw subdomain or custom domain
        subdomain = clean;
    }

    const redisKey = isBranchPreview
        ? `hosting:branch:${branchSubdomain}:${branchName}`
        : (isPreview ? `hosting:preview:${previewDeployId}` : `hosting:site:${subdomain}`);

    try {
        const { redis } = await import('@/lib/redis');
        const cached = await redis.get<any>(redisKey);
        if (cached && typeof cached === 'object') {
            return cached;
        }
    } catch {
        // Redis error ignored, proceed to DB
    }

    const pool = getPgPool();

    // 1. Branch Preview URL resolution: <site>-git-<branch>.preview.fluxbasedb.me
    if (isBranchPreview && branchSubdomain && branchName) {
        const depRes = await pool.query(
            `SELECT d.*, s.subdomain, s.is_spa, s.not_found_page, s.ai_models_enabled
             FROM fluxbase_global.hosting_deployments d
             JOIN fluxbase_global.hosting_sites s ON s.site_id = d.site_id
             WHERE s.subdomain = $1 AND d.branch = $2 AND d.status IN ('ready', 'live')
             ORDER BY d.version DESC LIMIT 1`,
            [branchSubdomain, branchName]
        );
        const row = depRes.rows[0];
        if (!row) return null;

        const result = {
            siteId: row.site_id,
            projectId: row.project_id,
            deployId: row.deploy_id,
            s3Prefix: row.s3_prefix,
            subdomain: row.subdomain,
            isSpa: row.is_spa,
            notFoundPage: row.not_found_page || '/404.html',
            aiModelsEnabled: row.ai_models_enabled,
            isPreview: true,
            isBranchPreview: true,
            branch: branchName,
            routingManifest: row.routing_manifest || [],
            frameworkSlug: row.framework_slug || 'static',
            isFullstack: !!row.is_fullstack
        };

        try {
            const { redis } = await import('@/lib/redis');
            await redis.set(redisKey, JSON.stringify(result), { ex: 300 });
        } catch {}

        return result;
    }

    // 2. Direct Deploy ID Preview URL: dep_xyz.preview.fluxbasedb.me
    if (isPreview && previewDeployId) {
        const depRes = await pool.query(
            `SELECT d.*, s.subdomain, s.is_spa, s.not_found_page, s.ai_models_enabled
             FROM fluxbase_global.hosting_deployments d
             JOIN fluxbase_global.hosting_sites s ON s.site_id = d.site_id
             WHERE d.deploy_id = $1`,
            [previewDeployId]
        );
        const row = depRes.rows[0];
        if (!row) return null;

        const result = {
            siteId: row.site_id,
            projectId: row.project_id,
            deployId: row.deploy_id,
            s3Prefix: row.s3_prefix,
            subdomain: row.subdomain,
            isSpa: row.is_spa,
            notFoundPage: row.not_found_page || '/404.html',
            aiModelsEnabled: row.ai_models_enabled,
            isPreview: true,
            isBranchPreview: false,
            routingManifest: row.routing_manifest || [],
            frameworkSlug: row.framework_slug || 'static',
            isFullstack: !!row.is_fullstack
        };

        try {
            const { redis } = await import('@/lib/redis');
            await redis.set(redisKey, JSON.stringify(result), { ex: 300 });
        } catch {}

        return result;
    }

    // 3. Production domain / Custom domain resolution
    const siteRes = await pool.query(
        `SELECT s.*, d.s3_prefix, d.deploy_id, d.routing_manifest, d.framework_slug
         FROM fluxbase_global.hosting_sites s
         LEFT JOIN fluxbase_global.hosting_deployments d ON d.deploy_id = s.production_deploy_id
         WHERE s.subdomain = $1 OR s.custom_domain = $1`,
        [subdomain]
    );

    const site = siteRes.rows[0];
    if (!site || !site.production_deploy_id || !site.s3_prefix) {
        return null;
    }

    const result = {
        siteId: site.site_id,
        projectId: site.project_id,
        deployId: site.production_deploy_id,
        s3Prefix: site.s3_prefix,
        subdomain: site.subdomain,
        isSpa: site.is_spa,
        notFoundPage: site.not_found_page || '/404.html',
        aiModelsEnabled: site.ai_models_enabled,
        isPreview: false,
        isBranchPreview: false,
        routingManifest: site.routing_manifest || [],
        frameworkSlug: site.framework_slug || site.framework || 'static',
        isFullstack: !!site.is_fullstack || site.deployment_type === 'fullstack'
    };

    try {
        const { redis } = await import('@/lib/redis');
        await redis.set(redisKey, JSON.stringify(result), { ex: 300 });
    } catch {}

    return result;
}

/**
 * Fetches an object buffer from S3. Returns null if NoSuchKey.
 */
async function fetchS3Object(s3Key: string): Promise<Buffer | null> {
    try {
        const s3 = getS3Client();
        const bucket = getS3Bucket();
        const res = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: s3Key
        }));

        if (!res.Body) return null;
        const bytes = await res.Body.transformToByteArray();
        return Buffer.from(bytes);
    } catch (e: any) {
        if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw e;
    }
}

/**
 * Serves an asset for a hosted site at a given path
 */
export async function serveHostedAsset(
    siteInfo: NonNullable<Awaited<ReturnType<typeof resolveHostingSite>>>,
    requestPath: string
): Promise<HostingServeResult> {
    const prefix = siteInfo.s3Prefix.endsWith('/') ? siteInfo.s3Prefix : `${siteInfo.s3Prefix}/`;
    let customHeaders: Record<string, string> = {};

    // 1. Superstatic Route Evaluation (Clean URLs, Trailing Slash, Redirects, Headers, Rewrites)
    if (siteInfo.routingManifest && siteInfo.routingManifest.length > 0) {
        const routeEval = await evaluateSuperstaticRoute({
            requestPath,
            routes: siteInfo.routingManifest,
            isSpa: siteInfo.isSpa,
            hasFile: async (filePath: string) => {
                const s3Key = `${prefix}${filePath}`;
                const buf = await fetchS3Object(s3Key);
                return buf !== null;
            }
        });

        // Redirect action
        if (routeEval.action === 'redirect') {
            return {
                found: true,
                statusCode: routeEval.statusCode,
                headers: {
                    ...routeEval.headers,
                    Location: routeEval.redirectLocation || '/',
                    'X-Flux-Hosting': 'true',
                    'X-Flux-Deploy-Id': siteInfo.deployId
                },
                bytesServed: 0
            };
        }

        // Reverse proxy action (backend API rewrites)
        if (routeEval.action === 'proxy' && routeEval.proxyTarget) {
            try {
                const proxyRes = await fetch(routeEval.proxyTarget, {
                    headers: routeEval.headers
                });
                const proxyBuffer = Buffer.from(await proxyRes.arrayBuffer());
                const proxyHeaders: Record<string, string> = {
                    ...routeEval.headers,
                    'X-Flux-Hosting': 'true',
                    'X-Flux-Deploy-Id': siteInfo.deployId
                };
                proxyRes.headers.forEach((val, key) => {
                    proxyHeaders[key] = val;
                });
                return {
                    found: true,
                    statusCode: proxyRes.status,
                    body: proxyBuffer,
                    contentType: proxyRes.headers.get('content-type') || 'application/json',
                    headers: proxyHeaders,
                    bytesServed: proxyBuffer.length
                };
            } catch (pErr: any) {
                logger.warn(`Failed to reverse-proxy to ${routeEval.proxyTarget}:`, pErr);
                return {
                    found: false,
                    statusCode: 502,
                    body: JSON.stringify({ error: 'Bad Gateway', message: `Proxy target unreachable: ${pErr?.message}` }),
                    contentType: 'application/json',
                    bytesServed: 0
                };
            }
        }

        // Explicit Not Found action (e.g. API 404)
        if (routeEval.action === 'not_found') {
            const isApi = requestPath.startsWith('/api/') || requestPath === '/api';
            return {
                found: false,
                statusCode: 404,
                body: isApi 
                    ? JSON.stringify({ error: 'Not Found', message: `API endpoint ${requestPath} not found` }) 
                    : Buffer.from('404 Not Found - Fluxbase Hosting'),
                contentType: isApi ? 'application/json' : 'text/plain; charset=utf-8',
                bytesServed: 0,
                headers: routeEval.headers
            };
        }

        customHeaders = routeEval.headers;

        if (routeEval.action === 'serve_file') {
            const buf = await fetchS3Object(`${prefix}${routeEval.resolvedPath}`);
            if (buf) {
                const mime = detectMimeType(routeEval.resolvedPath);
                if (mime.startsWith('text/html')) {
                    let htmlStr = buf.toString('utf8');
                    try {
                        const pool = getPgPool();
                        const envRes = await pool.query(
                            `SELECT key, value, is_secret FROM fluxbase_global.hosting_env_vars
                             WHERE site_id = $1 AND (environment = $2 OR environment = 'all')`,
                            [siteInfo.siteId, siteInfo.isPreview ? 'preview' : 'production']
                        );

                        const fwPreset = FRAMEWORK_PRESETS.find(f => f.slug === siteInfo.frameworkSlug);
                        const expectedPrefix = fwPreset?.envPrefix || 'NEXT_PUBLIC_';

                        const publicEnv: Record<string, string> = {};
                        for (const row of envRes.rows) {
                            const isClientKey = row.key.startsWith(expectedPrefix) ||
                                row.key.startsWith('NEXT_PUBLIC_') ||
                                row.key.startsWith('VITE_') ||
                                row.key.startsWith('PUBLIC_');
                            if (!row.is_secret || isClientKey) {
                                publicEnv[row.key] = decryptEnvValue(row.value);
                            }
                        }

                        htmlStr = injectEnvIntoHtml(htmlStr, publicEnv, {
                            projectId: siteInfo.projectId,
                            siteId: siteInfo.siteId,
                            subdomain: siteInfo.subdomain,
                            aiModelsEnabled: siteInfo.aiModelsEnabled
                        });

                        const htmlBuf = Buffer.from(htmlStr, 'utf8');
                        return {
                            found: true,
                            statusCode: 200,
                            body: htmlBuf,
                            contentType: mime,
                            headers: {
                                'Cache-Control': 'public, max-age=0, must-revalidate',
                                'X-Flux-Hosting': 'true',
                                'X-Flux-Deploy-Id': siteInfo.deployId,
                                ...customHeaders
                            },
                            bytesServed: htmlBuf.length
                        };
                    } catch (e) {
                        logger.warn('Failed to inject env into HTML:', e);
                    }
                }

                return {
                    found: true,
                    statusCode: 200,
                    body: buf,
                    contentType: mime,
                    headers: {
                        'Cache-Control': routeEval.resolvedPath.endsWith('.html')
                            ? 'public, max-age=0, must-revalidate'
                            : 'public, max-age=31536000, immutable',
                        'X-Flux-Hosting': 'true',
                        'X-Flux-Deploy-Id': siteInfo.deployId,
                        ...customHeaders
                    },
                    bytesServed: buf.length
                };
            }
        }
    }

    // 2. Fallback / Direct asset serving
    let relPath = requestPath.replace(/^\/+/, '').split('?')[0];
    if (!relPath || relPath.endsWith('/')) {
        relPath += 'index.html';
    }

    let s3Key = `${prefix}${relPath}`;
    let buffer = await fetchS3Object(s3Key);
    let resolvedPath = relPath;

    // If not found and path doesn't have an extension, try appending .html or /index.html
    if (!buffer && !relPath.includes('.')) {
        const htmlPath = `${relPath}.html`;
        buffer = await fetchS3Object(`${prefix}${htmlPath}`);
        if (buffer) {
            resolvedPath = htmlPath;
        } else {
            const indexSubPath = `${relPath}/index.html`;
            buffer = await fetchS3Object(`${prefix}${indexSubPath}`);
            if (buffer) {
                resolvedPath = indexSubPath;
            }
        }
    }

    // SPA fallback: If still not found, and SPA mode is enabled, and not an asset file or API endpoint
    const hasAssetExt = /\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|wasm|json|map)$/i.test(relPath);
    const isApiCall = relPath.startsWith('api/') || relPath === 'api';
    if (!buffer && siteInfo.isSpa && !hasAssetExt && !isApiCall) {
        buffer = await fetchS3Object(`${prefix}index.html`);
        if (buffer) {
            resolvedPath = 'index.html';
        }
    }

    // 404 Handling if still not found
    if (!buffer) {
        if (isApiCall) {
            return {
                found: false,
                statusCode: 404,
                body: JSON.stringify({ error: 'Not Found', message: `API endpoint /${relPath} not found` }),
                contentType: 'application/json',
                bytesServed: 0
            };
        }

        const notFoundKey = `${prefix}${siteInfo.notFoundPage.replace(/^\/+/, '')}`;
        const notFoundBuffer = await fetchS3Object(notFoundKey);
        if (notFoundBuffer) {
            return {
                found: true,
                statusCode: 404,
                body: notFoundBuffer,
                contentType: 'text/html; charset=utf-8',
                bytesServed: notFoundBuffer.length
            };
        }

        return {
            found: false,
            statusCode: 404,
            body: Buffer.from('404 Not Found - Fluxbase Hosting'),
            contentType: 'text/plain; charset=utf-8',
            bytesServed: 32
        };
    }

    const mime = detectMimeType(resolvedPath);

    // If serving HTML, inject runtime public environment variables
    if (mime.startsWith('text/html')) {
        let htmlStr = buffer.toString('utf8');

        try {
            const pool = getPgPool();
            const envRes = await pool.query(
                `SELECT key, value, is_secret FROM fluxbase_global.hosting_env_vars
                 WHERE site_id = $1 AND (environment = $2 OR environment = 'all')`,
                [siteInfo.siteId, siteInfo.isPreview ? 'preview' : 'production']
            );

            const fwPreset = FRAMEWORK_PRESETS.find(f => f.slug === siteInfo.frameworkSlug);
            const expectedPrefix = fwPreset?.envPrefix || 'NEXT_PUBLIC_';

            const publicEnv: Record<string, string> = {};
            for (const row of envRes.rows) {
                const isClientKey = row.key.startsWith(expectedPrefix) ||
                    row.key.startsWith('NEXT_PUBLIC_') ||
                    row.key.startsWith('VITE_') ||
                    row.key.startsWith('PUBLIC_');
                if (!row.is_secret || isClientKey) {
                    publicEnv[row.key] = decryptEnvValue(row.value);
                }
            }

            htmlStr = injectEnvIntoHtml(htmlStr, publicEnv, {
                projectId: siteInfo.projectId,
                siteId: siteInfo.siteId,
                subdomain: siteInfo.subdomain,
                aiModelsEnabled: siteInfo.aiModelsEnabled
            });

            const htmlBuf = Buffer.from(htmlStr, 'utf8');
            return {
                found: true,
                statusCode: 200,
                body: htmlBuf,
                contentType: mime,
                headers: {
                    'Cache-Control': 'public, max-age=0, must-revalidate',
                    'X-Flux-Hosting': 'true',
                    'X-Flux-Deploy-Id': siteInfo.deployId,
                    ...customHeaders
                },
                bytesServed: htmlBuf.length
            };
        } catch (e) {
            logger.warn('Failed to inject env into HTML:', e);
        }
    }

    return {
        found: true,
        statusCode: 200,
        body: buffer,
        contentType: mime,
        headers: {
            'Cache-Control': resolvedPath.endsWith('.html')
                ? 'public, max-age=0, must-revalidate'
                : 'public, max-age=31536000, immutable',
            'X-Flux-Hosting': 'true',
            'X-Flux-Deploy-Id': siteInfo.deployId
        },
        bytesServed: buffer.length
    };
}

/**
 * Asynchronously logs access to hosting_access_logs without blocking the response
 */
export function logHostingAccess(params: {
    siteId: string;
    deployId?: string;
    path: string;
    statusCode: number;
    bytesServed: number;
    ip?: string;
    userAgent?: string;
    referer?: string;
}) {
    // Fire and forget
    (async () => {
        try {
            const pool = getPgPool();
            await pool.query(
                `INSERT INTO fluxbase_global.hosting_access_logs (
                    site_id, deploy_id, path, status_code, bytes_served, ip, user_agent, referer
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    params.siteId,
                    params.deployId || null,
                    params.path.slice(0, 2048),
                    params.statusCode,
                    params.bytesServed,
                    params.ip?.slice(0, 45) || null,
                    params.userAgent?.slice(0, 1000) || null,
                    params.referer?.slice(0, 1000) || null
                ]
            );
        } catch (e) {
            // Silently ignore logging failures to not disrupt traffic
        }
    })();
}
