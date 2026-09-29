import JSZip from 'jszip';
import { getS3Client, getS3Bucket } from '@/lib/storage';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';
import { checkHostingDeploySize } from '@/lib/limits';
export { checkHostingDeploySize };

export const RESERVED_SUBDOMAINS = new Set([
    'www', 'api', 'admin', 'mail', 'smtp', 'ftp', 'cdn', 'assets',
    'static', 'payments', 'gateway', 'superfarmer', 'docs', 'support',
    'help', 'status', 'blog', 'app', 'dashboard', 'auth', 'billing',
    'root', 'preview', 'dev', 'staging', 'test', 'demo', 'proxy'
]);

export const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'font/otf',
    '.wasm': 'application/wasm',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};


export function detectMimeType(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return 'application/octet-stream';
    const ext = filePath.slice(lastDot).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

export function validateSubdomain(subdomain: string): { valid: boolean; error?: string } {
    const clean = subdomain.trim().toLowerCase();
    if (!clean) return { valid: false, error: 'Subdomain is required' };
    if (clean.length < 3 || clean.length > 63) {
        return { valid: false, error: 'Subdomain must be between 3 and 63 characters' };
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(clean)) {
        return { valid: false, error: 'Subdomain can only contain lowercase letters, numbers, and hyphens (not leading/trailing)' };
    }
    if (RESERVED_SUBDOMAINS.has(clean)) {
        return { valid: false, error: `Subdomain '${clean}' is reserved by the platform` };
    }
    return { valid: true };
}

export function sanitizePath(rawPath: string): string {
    // Normalize slashes
    let p = rawPath.replace(/\\/g, '/');
    // Strip leading slashes
    p = p.replace(/^\/+/, '');
    // Remove ./ or duplicate slashes
    p = p.replace(/\/{2,}/g, '/');
    // Check for traversal
    const segments = p.split('/');
    const safeSegments: string[] = [];
    for (const segment of segments) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            throw new Error(`Path traversal detected in path: ${rawPath}`);
        }
        safeSegments.push(segment);
    }
    return safeSegments.join('/');
}

export interface ExtractedFile {
    path: string;
    buffer: Buffer;
    size: number;
    mimeType: string;
}

/**
 * Extracts and validates files from a Zip buffer in memory
 */
export async function extractZipArchive(zipBuffer: Buffer): Promise<ExtractedFile[]> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const extracted: ExtractedFile[] = [];

    // Find if the zip contains a single root folder (e.g. dist/ or build/ or repo-main/)
    const entries = Object.keys(zip.files);
    let commonPrefix = '';
    const nonDirEntries = entries.filter(name => !zip.files[name].dir);

    if (nonDirEntries.length === 0) {
        throw new Error('Zip archive contains no files');
    }

    // Detect common top-level directory wrapper if all files share it
    const firstSlash = nonDirEntries[0].indexOf('/');
    if (firstSlash !== -1) {
        const potentialRoot = nonDirEntries[0].slice(0, firstSlash + 1);
        if (nonDirEntries.every(name => name.startsWith(potentialRoot))) {
            commonPrefix = potentialRoot;
        }
    }

    for (const relativePath of entries) {
        const file = zip.files[relativePath];
        if (file.dir) continue;

        let cleanPath = relativePath;
        if (commonPrefix && cleanPath.startsWith(commonPrefix)) {
            cleanPath = cleanPath.slice(commonPrefix.length);
        }

        cleanPath = sanitizePath(cleanPath);
        if (!cleanPath) continue;


        const buffer = await file.async('nodebuffer');
        extracted.push({
            path: cleanPath,
            buffer,
            size: buffer.length,
            mimeType: detectMimeType(cleanPath)
        });
    }

    return extracted;
}

/**
 * Uploads all deployment files to S3 under hosting/<projectId>/<deployId>/<path>
 */
export async function uploadDeploymentAssetsToS3(
    projectId: string,
    deployId: string,
    files: ExtractedFile[],
    onProgress?: (uploaded: number, total: number) => void
): Promise<{ totalBytes: number; fileCount: number }> {
    const s3 = getS3Client();
    const bucket = getS3Bucket();
    const prefix = `hosting/${projectId}/${deployId}/`;

    let totalBytes = 0;
    let uploadedCount = 0;

    // Concurrently upload in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async (file) => {
                const s3Key = `${prefix}${file.path}`;
                await s3.send(
                    new PutObjectCommand({
                        Bucket: bucket,
                        Key: s3Key,
                        Body: file.buffer,
                        ContentType: file.mimeType,
                        // Immutable cache for fingerprinted assets, shorter cache for html
                        CacheControl: file.path.endsWith('.html')
                            ? 'public, max-age=0, must-revalidate'
                            : 'public, max-age=31536000, immutable'
                    })
                );
                totalBytes += file.size;
                uploadedCount++;
                if (onProgress) {
                    onProgress(uploadedCount, files.length);
                }
            })
        );
    }

    return { totalBytes, fileCount: files.length };
}

/**
 * Creates or gets the hosting site record for a project
 */
export async function getOrCreateHostingSite(
    projectId: string,
    userId: string,
    defaultSubdomain?: string
) {
    const pool = getPgPool();
    const existing = await pool.query(
        'SELECT * FROM fluxbase_global.hosting_sites WHERE project_id = $1',
        [projectId]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0];
    }

    // Determine initial subdomain
    let subdomain = defaultSubdomain ? defaultSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, '') : `app-${projectId.slice(0, 8)}`;
    const subCheck = validateSubdomain(subdomain);
    if (!subCheck.valid) {
        subdomain = `app-${projectId.slice(0, 8)}`;
    }

    // Ensure uniqueness
    const conflict = await pool.query(
        'SELECT site_id FROM fluxbase_global.hosting_sites WHERE subdomain = $1',
        [subdomain]
    );
    if (conflict.rows.length > 0) {
        subdomain = `${subdomain}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const inserted = await pool.query(
        `INSERT INTO fluxbase_global.hosting_sites (
            project_id, user_id, subdomain, is_spa, framework, status
        ) VALUES ($1, $2, $3, true, 'static', 'active')
        RETURNING *`,
        [projectId, userId, subdomain]
    );

    return inserted.rows[0];
}

/**
 * Creates a new deployment record and processes the asset upload
 */
export async function createDeployment(params: {
    siteId: string;
    projectId: string;
    userId: string;
    environment: 'preview' | 'production';
    source: 'upload' | 'github' | 'api' | 'rollback';
    files: ExtractedFile[];
    commitSha?: string;
    commitMessage?: string;
    branch?: string;
    buildCommand?: string;
    outputDirectory?: string;
    installCommand?: string;
    envVars?: Record<string, string>;
    autoPromote?: boolean;
    asyncBuild?: boolean;
}) {
    const pool = getPgPool();
    const {
        siteId,
        projectId,
        userId,
        environment,
        source,
        files,
        commitSha,
        commitMessage,
        branch,
        buildCommand,
        outputDirectory,
        installCommand,
        envVars,
        autoPromote,
        asyncBuild = false
    } = params;

    // Check deploy size quota
    const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
    await checkHostingDeploySize(projectId, totalSizeBytes);

    // Get next version number for this site
    const verRes = await pool.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM fluxbase_global.hosting_deployments WHERE site_id = $1',
        [siteId]
    );
    const nextVersion = parseInt(verRes.rows[0].next_ver, 10);

    // Fetch site to get subdomain
    const siteRes = await pool.query(
        'SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1',
        [siteId]
    );
    const site = siteRes.rows[0];
    if (!site) throw new Error('Hosting site not found');

    const deployId = `dep_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const s3Prefix = `hosting/${projectId}/${deployId}/`;
    const previewUrl = `https://${deployId}.preview.fluxbasedb.me`;
    const now = new Date();
    const initialLogs = `[${now.toISOString().slice(0, 19).replace('T', ' ')}] Initializing deployment for ${site.subdomain} (v${nextVersion})...\n[System] Extracted ${files.length} files (${(totalSizeBytes / 1024).toFixed(1)} KB).\n`;

    // Insert pending deployment
    await pool.query(
        `INSERT INTO fluxbase_global.hosting_deployments (
            deploy_id, site_id, project_id, user_id, environment, version,
            commit_sha, commit_message, branch, source, s3_prefix,
            status, preview_url, total_size_bytes, file_count,
            build_command, install_command, output_directory, build_logs
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'uploading', $12, $13, $14, $15, $16, $17, $18)`,
        [
            deployId, siteId, projectId, userId, environment, nextVersion,
            commitSha || null, commitMessage || null, branch || null, source,
            s3Prefix, previewUrl, totalSizeBytes, files.length,
            buildCommand || site.build_command || null,
            installCommand || site.install_command || null,
            outputDirectory || site.output_directory || null,
            initialLogs
        ]
    );

    const executePipeline = async () => {
        try {
            // Run framework detection & build engine with live streaming logs
            const { executeProjectBuild } = await import('@/lib/hosting-build');
            let filesToUpload = files;
            let buildLogs = '';

            try {
                const buildRes = await executeProjectBuild({
                    deployId,
                    siteId,
                    projectId,
                    files,
                    buildCommand: buildCommand || site.build_command,
                    outputDirectory: outputDirectory || site.output_directory,
                    installCommand: installCommand || site.install_command,
                    envVars: envVars || {}
                });
                filesToUpload = buildRes.files;
                buildLogs = buildRes.buildLogs;

                if (buildRes.framework && buildRes.framework !== 'static') {
                    await pool.query(
                        'UPDATE fluxbase_global.hosting_sites SET framework = $1 WHERE site_id = $2',
                        [buildRes.framework, siteId]
                    );
                }
            } catch (bErr: any) {
                buildLogs = bErr.message || 'Build execution failed';
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments 
                     SET status = 'failed', error_message = 'Build failed', build_logs = $1 
                     WHERE deploy_id = $2`,
                    [buildLogs, deployId]
                );
                throw new Error(`Build failed: ${bErr.message}`);
            }

            // Upload files to S3
            const uploadStats = await uploadDeploymentAssetsToS3(projectId, deployId, filesToUpload);

            // Update deploy status to ready
            const isProd = environment === 'production' || autoPromote;
            const finalStatus = isProd ? 'live' : 'ready';
            const deployedAt = new Date();

            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET status = $1, deployed_at = $2, build_logs = $3, file_count = $4, total_size_bytes = $5
                 WHERE deploy_id = $6`,
                [finalStatus, isProd ? deployedAt : null, buildLogs, uploadStats.fileCount, uploadStats.totalBytes, deployId]
            );

            if (isProd) {
                // Supersede previous production deployment
                if (site.production_deploy_id) {
                    await pool.query(
                        `UPDATE fluxbase_global.hosting_deployments
                         SET status = 'superseded', superseded_at = $1
                         WHERE deploy_id = $2`,
                        [deployedAt, site.production_deploy_id]
                    );
                }

                // Update site pointer
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites
                     SET production_deploy_id = $1, updated_at = $2
                     WHERE site_id = $3`,
                    [deployId, deployedAt, siteId]
                );

                // Invalidate Redis cache for instant live update
                try {
                    const { redis } = await import('@/lib/redis');
                    await redis.del(`hosting:site:${site.subdomain}`);
                    if (site.custom_domain) {
                        await redis.del(`hosting:site:${site.custom_domain}`);
                    }
                } catch (err) {
                    logger.warn('Failed to clear hosting Redis cache:', err);
                }
            } else {
                // Update preview pointer
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites
                     SET preview_deploy_id = $1, updated_at = $2
                     WHERE site_id = $3`,
                    [deployId, deployedAt, siteId]
                );
            }

            const updatedDeploy = await pool.query(
                'SELECT * FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1',
                [deployId]
            );

            return {
                deployment: updatedDeploy.rows[0],
                site: { ...site, production_deploy_id: isProd ? deployId : site.production_deploy_id },
                liveUrl: `https://${site.subdomain}.fluxbasedb.me`,
                previewUrl
            };
        } catch (err: any) {
            logger.error('Deployment execution failed:', err);
            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET status = 'failed', error_message = $1
                 WHERE deploy_id = $2`,
                [err.message || 'Asset upload failed', deployId]
            );
            throw err;
        }
    };

    if (asyncBuild) {
        // Fire-and-forget background execution
        executePipeline().catch((err) => {
            logger.error(`[Background Deployment Error] [${deployId}]:`, err);
        });

        return {
            deployment: {
                deploy_id: deployId,
                site_id: siteId,
                project_id: projectId,
                user_id: userId,
                environment,
                version: nextVersion,
                source,
                status: 'uploading',
                preview_url: previewUrl,
                total_size_bytes: totalSizeBytes,
                file_count: files.length,
                branch: branch || null
            },
            site,
            liveUrl: `https://${site.subdomain}.fluxbasedb.me`,
            previewUrl
        };
    }

    return await executePipeline();
}

/**
 * Promotes any existing deployment to production
 */
export async function promoteDeploymentToProduction(siteId: string, deployId: string) {
    const pool = getPgPool();
    const deployRes = await pool.query(
        'SELECT * FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1 AND site_id = $2',
        [deployId, siteId]
    );

    const deploy = deployRes.rows[0];
    if (!deploy) throw new Error('Deployment not found');

    const siteRes = await pool.query(
        'SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1',
        [siteId]
    );
    const site = siteRes.rows[0];
    if (!site) throw new Error('Site not found');

    const now = new Date();

    // Mark current production as superseded
    if (site.production_deploy_id && site.production_deploy_id !== deployId) {
        await pool.query(
            `UPDATE fluxbase_global.hosting_deployments
             SET status = 'superseded', superseded_at = $1
             WHERE deploy_id = $2`,
            [now, site.production_deploy_id]
        );
    }

    // Set new deployment as live
    await pool.query(
        `UPDATE fluxbase_global.hosting_deployments
         SET status = 'live', deployed_at = $1, environment = 'production'
         WHERE deploy_id = $2`,
        [now, deployId]
    );

    // Update site pointer
    await pool.query(
        `UPDATE fluxbase_global.hosting_sites
         SET production_deploy_id = $1, updated_at = $2
         WHERE site_id = $3`,
        [deployId, now, siteId]
    );

    // Invalidate Redis cache
    try {
        const { redis } = await import('@/lib/redis');
        await redis.del(`hosting:site:${site.subdomain}`);
        if (site.custom_domain) {
            await redis.del(`hosting:site:${site.custom_domain}`);
        }
    } catch (e) {
        logger.warn('Failed to clear hosting Redis cache:', e);
    }

    return {
        success: true,
        deployId,
        url: `https://${site.subdomain}.fluxbasedb.me`
    };
}
