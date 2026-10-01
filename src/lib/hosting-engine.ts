import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import JSZip from 'jszip';
import crypto from 'crypto';
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

        // Skip committed dependency, build cache, and VCS directories
        // These bloat memory and are cleanly created/installed during the build pipeline.
        if (
            cleanPath.startsWith('node_modules/') ||
            cleanPath.includes('/node_modules/') ||
            cleanPath.startsWith('.git/') ||
            cleanPath.includes('/.git/') ||
            cleanPath.startsWith('.next/') ||
            cleanPath.includes('/.next/')
        ) {
            continue;
        }

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
 * Reads a local repository directory as ExtractedFile array (skipping node_modules, .git, .next)
 */
export async function readDirectoryAsExtractedFiles(dirPath: string): Promise<ExtractedFile[]> {
    const results: ExtractedFile[] = [];

    async function walk(currentDir: string, relativeDir: string = '') {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            const normPath = sanitizePath(relPath);
            if (!normPath) continue;

            if (
                normPath.startsWith('node_modules') ||
                normPath.includes('/node_modules') ||
                normPath.startsWith('.git') ||
                normPath.includes('/.git') ||
                normPath.startsWith('.next') ||
                normPath.includes('/.next')
            ) {
                continue;
            }

            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath, normPath);
            } else if (entry.isFile()) {
                const buffer = await fs.promises.readFile(fullPath);
                results.push({
                    path: normPath,
                    buffer,
                    size: buffer.length,
                    mimeType: detectMimeType(normPath)
                });
            }
        }
    }

    await walk(dirPath);
    return results;
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

    // Concurrently upload in batches of 30 for high-throughput S3 ingestion
    const BATCH_SIZE = 30;
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
 * Deploys files directly to the dedicated top-tier hosting edge server (/var/www/tenants/<domain>)
 */
export interface DeployToEdgeOptions {
    customDomains?: string[];
    isFullstack?: boolean;
    backendPort?: number;
    framework?: string;
    envVars?: Record<string, string>;
    standaloneS3Key?: string;
    proxyTarget?: string;
}

export async function deployToTenantsEdge(
    subdomain: string,
    files: ExtractedFile[],
    options: string[] | DeployToEdgeOptions = []
): Promise<{ success: boolean; error?: string }> {
    const edgeUrl = process.env.HOSTING_EDGE_URL || 'http://13.207.235.61:9000';
    const edgeSecret = process.env.HOSTING_EDGE_SECRET || '9e1e726a895a56318a934c340329d11362adf922fd3afd86';

    const fullDomain = subdomain.includes('.') ? subdomain : `${subdomain}.fluxbasedb.me`;
    const customDomains = Array.isArray(options) ? options : (options.customDomains || []);
    const isFullstack = Array.isArray(options) ? false : (options.isFullstack || false);
    const backendPort = Array.isArray(options) ? undefined : options.backendPort;
    const framework = Array.isArray(options) ? undefined : options.framework;
    const envVars = Array.isArray(options) ? {} : (options.envVars || {});
    const standaloneS3Key = Array.isArray(options) ? undefined : options.standaloneS3Key;
    const proxyTarget = Array.isArray(options) ? undefined : (options.proxyTarget || (isFullstack ? `https://fluxbasedb.me/api/hosting/serve?host=${fullDomain}` : undefined));

    try {
        const payload = JSON.stringify({
            domain: fullDomain,
            customDomains,
            isFullstack,
            backendPort,
            framework,
            envVars,
            standaloneS3Key,
            proxyTarget,
            files: files.map(f => ({
                path: f.path,
                content: f.buffer.toString('base64')
            }))
        });

        const res = await fetch(`${edgeUrl}/api/deploy-tenant`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-fluxbase-secret': edgeSecret
            },
            body: payload
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.warn(`Failed to deploy to tenants edge (${res.status}): ${errText}`);
            return { success: false, error: errText };
        }

        logger.info(`Successfully deployed ${files.length} files to tenants edge for ${fullDomain}`);
        return { success: true };
    } catch (err: any) {
        logger.warn(`Error deploying to tenants edge: ${err?.message}`);
        return { success: false, error: err?.message };
    }
}

/**
 * Deletes a tenant directory and any custom domain symlinks from the edge server
 */
export async function deleteFromTenantsEdge(
    subdomain: string,
    customDomains: string[] = []
): Promise<{ success: boolean; error?: string }> {
    const edgeUrl = process.env.HOSTING_EDGE_URL || 'http://13.207.235.61:9000';
    const edgeSecret = process.env.HOSTING_EDGE_SECRET || '9e1e726a895a56318a934c340329d11362adf922fd3afd86';

    const fullDomain = subdomain.includes('.') ? subdomain : `${subdomain}.fluxbasedb.me`;

    try {
        const payload = JSON.stringify({
            domain: fullDomain,
            customDomains
        });

        const res = await fetch(`${edgeUrl}/api/delete-tenant`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-fluxbase-secret': edgeSecret
            },
            body: payload
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.warn(`Failed to delete from tenants edge (${res.status}): ${errText}`);
            return { success: false, error: errText };
        }

        logger.info(`Successfully deleted tenant directory from edge for ${fullDomain}`);
        return { success: true };
    } catch (err: any) {
        logger.warn(`Error deleting from tenants edge: ${err?.message}`);
        return { success: false, error: err?.message };
    }
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
    const cleanBranch = branch ? branch.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-') : null;
    const branchUrl = cleanBranch ? `https://${site.subdomain}-git-${cleanBranch}.preview.fluxbasedb.me` : null;
    const now = new Date();
    const initialLogs = `[${now.toISOString().slice(0, 19).replace('T', ' ')}] Initializing deployment for ${site.subdomain} (v${nextVersion})...\n[System] Extracted ${files.length} files (${(totalSizeBytes / 1024).toFixed(1)} KB).\n`;

    // Insert pending deployment
    await pool.query(
        `INSERT INTO fluxbase_global.hosting_deployments (
            deploy_id, site_id, project_id, user_id, environment, version,
            commit_sha, commit_message, branch, source, s3_prefix,
            status, preview_url, branch_url, total_size_bytes, file_count,
            build_command, install_command, output_directory, build_logs
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'uploading', $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
            deployId, siteId, projectId, userId, environment, nextVersion,
            commitSha || null, commitMessage || null, branch || null, source,
            s3Prefix, previewUrl, branchUrl, totalSizeBytes, files.length,
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
            let buildRes: any = null;

            // Load site environment variables (decrypt secrets) and merge with any passed envVars
            const mergedEnvVars: Record<string, string> = {};
            try {
                const { decryptEnvValue } = await import('@/lib/hosting-env');
                const envRows = await pool.query(
                    `SELECT key, value, is_secret FROM fluxbase_global.hosting_env_vars
                     WHERE site_id = $1 AND (environment = $2 OR environment = 'all')`,
                    [siteId, environment]
                );
                for (const row of envRows.rows) {
                    mergedEnvVars[row.key] = row.is_secret ? decryptEnvValue(row.value) : row.value;
                }
            } catch {}
            if (envVars) {
                Object.assign(mergedEnvVars, envVars);
            }

            try {
                buildRes = await executeProjectBuild({
                    deployId,
                    siteId,
                    projectId,
                    subdomain: site.subdomain,
                    files,
                    buildCommand: buildCommand || site.build_command,
                    outputDirectory: outputDirectory || site.output_directory,
                    installCommand: installCommand || site.install_command,
                    envVars: mergedEnvVars
                });
                filesToUpload = buildRes.files;
                buildLogs = buildRes.buildLogs;

                if (buildRes.framework && buildRes.framework !== 'static') {
                    await pool.query(
                        'UPDATE fluxbase_global.hosting_sites SET framework = $1 WHERE site_id = $2',
                        [buildRes.framework, siteId]
                    );
                }

                if (buildRes.isFullstack && buildRes.backendPort) {
                    await pool.query(
                        `UPDATE fluxbase_global.hosting_sites 
                         SET backend_port = $1, 
                             backend_status = $2, 
                             is_fullstack = true,
                             deployment_type = 'fullstack',
                             backend_entry_script = COALESCE($3, backend_entry_script),
                             backend_working_dir = COALESCE($4, backend_working_dir)
                         WHERE site_id = $5`,
                        [buildRes.backendPort, 'running', buildRes.backendEntryScript || null, buildRes.backendWorkingDir || null, siteId]
                    );
                }
            } catch (bErr: any) {
                const isCanceled = bErr?.message?.includes('canceled by user') || bErr?.message?.includes('Deployment canceled');
                if (isCanceled) {
                    await pool.query(
                        `UPDATE fluxbase_global.hosting_deployments 
                         SET status = 'canceled', error_message = 'Deployment canceled by user' 
                         WHERE deploy_id = $1`,
                        [deployId]
                    );
                    return {
                        deployId,
                        version: nextVersion,
                        subdomain: site.subdomain,
                        previewUrl,
                        status: 'canceled',
                        fileCount: 0,
                        totalBytes: 0,
                    };
                }
                buildLogs = bErr.message || 'Build execution failed';
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments 
                     SET status = 'failed', error_message = 'Build failed', build_logs = $1 
                     WHERE deploy_id = $2`,
                    [buildLogs, deployId]
                );
                throw new Error(`Build failed: ${bErr.message}`);
            }

            // Check if deployment was canceled before upload
            const depCheck = await pool.query('SELECT status FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1', [deployId]);
            if (depCheck.rows[0]?.status === 'canceled') {
                return {
                    deployId,
                    version: nextVersion,
                    subdomain: site.subdomain,
                    previewUrl,
                    status: 'canceled',
                    fileCount: 0,
                    totalBytes: 0,
                };
            }

            // Upload files to S3
            const uploadStats = await uploadDeploymentAssetsToS3(projectId, deployId, filesToUpload);

            // Compute content-addressable SHA1 hashes for every deployed file
            const filesManifest = filesToUpload.map(f => ({
                path: f.path,
                sha: crypto.createHash('sha1').update(f.buffer).digest('hex'),
                size: f.size,
                mimeType: f.mimeType
            }));

            // Deploy files directly to the dedicated top-tier edge server (/var/www/tenants/<domain>)
            const customDomains = site.custom_domain ? [site.custom_domain] : [];
            const edgeOpts: DeployToEdgeOptions = {
                customDomains,
                isFullstack: !!buildRes?.isFullstack,
                backendPort: buildRes?.backendPort,
                framework: buildRes?.framework,
                envVars: envVars || {},
                standaloneS3Key: buildRes?.standaloneS3Key
            };
            const edgeTasks = [
                deployToTenantsEdge(site.subdomain, filesToUpload, edgeOpts)
            ];
            if (environment === 'preview') {
                edgeTasks.push(deployToTenantsEdge(`${deployId}.preview.fluxbasedb.me`, filesToUpload, { ...edgeOpts, customDomains: [] }));
            }
            if (cleanBranch) {
                edgeTasks.push(deployToTenantsEdge(`${site.subdomain}-git-${cleanBranch}.preview.fluxbasedb.me`, filesToUpload, { ...edgeOpts, customDomains: [] }));
            }
            await Promise.all(edgeTasks);

            // Update deploy status to ready
            const isProd = environment === 'production' || autoPromote;
            const finalStatus = isProd ? 'live' : 'ready';
            const deployedAt = new Date();

            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET status = $1, deployed_at = $2, build_logs = $3, file_count = $4, total_size_bytes = $5,
                     routing_manifest = $6, files_manifest = $7, framework_slug = $8
                 WHERE deploy_id = $9`,
                [
                    finalStatus,
                    isProd ? deployedAt : null,
                    buildLogs,
                    uploadStats.fileCount,
                    uploadStats.totalBytes,
                    JSON.stringify(buildRes.routingManifest || []),
                    JSON.stringify(filesManifest),
                    buildRes.framework,
                    deployId
                ]
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

                // Update site pointer and routing config
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites
                     SET production_deploy_id = $1, routing_config = $2, framework = $3, updated_at = $4
                     WHERE site_id = $5`,
                    [deployId, JSON.stringify(buildRes.routingConfig || {}), buildRes.framework, deployedAt, siteId]
                );

                // Invalidate Redis cache for instant live update
                try {
                    const { redis } = await import('@/lib/redis');
                    await redis.del(`hosting:site:${site.subdomain}`);
                    if (cleanBranch) {
                        await redis.del(`hosting:branch:${site.subdomain}:${cleanBranch}`);
                    }
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
                previewUrl,
                branchUrl
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

export interface ExecuteGitHubDeploymentParams {
    siteId: string;
    projectId?: string;
    userId?: string;
    branch?: string;
    commitSha?: string;
    commitMessage?: string;
    author?: string;
    buildCommand?: string;
    outputDirectory?: string;
    installCommand?: string;
    environment?: 'preview' | 'production';
    autoPromote?: boolean;
    asyncExecution?: boolean;
    prNumber?: number;
}

/**
 * Universal GitHub deployment executor that downloads, builds, and deploys any GitHub repository
 */
export async function executeGitHubDeployment(params: ExecuteGitHubDeploymentParams) {
    const {
        siteId,
        branch,
        commitSha,
        commitMessage,
        author,
        buildCommand,
        outputDirectory,
        installCommand,
        environment = 'production',
        autoPromote = true,
        asyncExecution = true,
        prNumber
    } = params;

    const pool = getPgPool();
    const siteRes = await pool.query('SELECT * FROM fluxbase_global.hosting_sites WHERE site_id = $1', [siteId]);
    const site = siteRes.rows[0];
    if (!site) throw new Error('Hosting site not found');
    if (!site.github_repo) throw new Error('No GitHub repository is connected to this site');

    const targetUserId = params.userId || site.user_id;
    const targetProjectId = params.projectId || site.project_id;
    const [owner, repo] = site.github_repo.split('/');
    const targetBranch = branch || site.github_branch || 'main';
    const targetEnv = environment || 'production';
    const shouldPromote = autoPromote ?? (targetEnv === 'production');

    const { getGitHubToken } = await import('@/lib/github-token');
    const token = await getGitHubToken(targetUserId);
    if (!token) throw new Error('GitHub token not found. Please reconnect GitHub in Settings.');

    const { GitHubClient } = await import('@/lib/github-client');
    const client = new GitHubClient(token);

    let sha = commitSha || '';
    let msg = commitMessage || '';
    let committer = author || 'You';

    if (!sha) {
        try {
            const cInfo = await client.getLatestCommit(owner, repo, targetBranch);
            sha = cInfo.sha;
            msg = cInfo.message;
            committer = cInfo.author;
        } catch (cErr: any) {
            logger.warn('Failed to fetch commit metadata:', cErr?.message);
        }
    }

    const verRes = await pool.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM fluxbase_global.hosting_deployments WHERE site_id = $1',
        [site.site_id]
    );
    const nextVersion = parseInt(verRes.rows[0].next_ver, 10);

    const deployId = `dep_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const previewUrl = `https://${deployId}.preview.fluxbasedb.me`;
    const cleanBranch = targetBranch ? targetBranch.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-') : null;
    const branchUrl = cleanBranch ? `https://${site.subdomain}-git-${cleanBranch}.preview.fluxbasedb.me` : null;
    const s3Prefix = `hosting/${targetProjectId}/${deployId}/`;
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const initialLogs = `[${nowStr}] Deployment initialized for ${site.github_repo}@${targetBranch} (commit ${sha ? sha.slice(0, 7) : 'latest'})\n[Commit] ${msg ? msg.trim() : 'Manual deploy'}\n[Author] ${committer}\n[System] Connecting to GitHub to download repository archive...`;

    await pool.query(
        `INSERT INTO fluxbase_global.hosting_deployments (
            deploy_id, site_id, project_id, user_id, environment, version,
            commit_sha, commit_message, branch, source, s3_prefix, status, preview_url, branch_url,
            build_command, install_command, output_directory, build_logs
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'github', $10, 'uploading', $11, $12, $13, $14, $15, $16)`,
        [
            deployId, site.site_id, targetProjectId, targetUserId, targetEnv, nextVersion,
            sha || null, msg || null, targetBranch, s3Prefix, previewUrl, branchUrl,
            buildCommand || site.build_command || null,
            installCommand || site.install_command || null,
            outputDirectory || site.output_directory || null,
            initialLogs
        ]
    );

    // Post pending commit status check to GitHub (matching Vercel deployment status)
    if (sha) {
        client.createCommitStatus(owner, repo, sha, {
            state: 'pending',
            target_url: previewUrl,
            description: `Deploying commit to ${site.subdomain}...`
        }).catch(() => {});
    }

    const runPipeline = async () => {
        const appendLog = async (m: string, statusOverride?: string) => {
            const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const line = `[${ts}] ${m}`;
            try {
                if (statusOverride) {
                    await pool.query(
                        `UPDATE fluxbase_global.hosting_deployments
                         SET build_logs = COALESCE(build_logs, '') || E'\\n' || $1, status = $2
                         WHERE deploy_id = $3`,
                        [line, statusOverride, deployId]
                    );
                } else {
                    await pool.query(
                        `UPDATE fluxbase_global.hosting_deployments
                         SET build_logs = COALESCE(build_logs, '') || E'\\n' || $1
                         WHERE deploy_id = $2`,
                        [line, deployId]
                    );
                }
            } catch {}
        };

        try {
            // 1. Fetch Source Code: Local Git shallow/incremental cache strategy (1-2s) or fallback to GitHub archive
            let files: ExtractedFile[] | null = null;
            const gitCacheDir = path.join(os.tmpdir(), 'fluxbase-git-cache', site.site_id);
            const gitDir = path.join(gitCacheDir, '.git');
            const authRemote = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

            try {
                if (fs.existsSync(gitDir)) {
                    await appendLog(`Fast-forwarding repository via local git cache...`);
                    execSync(`git remote set-url origin "${authRemote}"`, { cwd: gitCacheDir, stdio: 'ignore' });
                    execSync(`git fetch origin ${targetBranch} --depth 1`, { cwd: gitCacheDir, stdio: 'ignore', timeout: 30000 });
                    execSync(`git reset --hard FETCH_HEAD`, { cwd: gitCacheDir, stdio: 'ignore' });
                    execSync(`git clean -fd`, { cwd: gitCacheDir, stdio: 'ignore' });
                    files = await readDirectoryAsExtractedFiles(gitCacheDir);
                    await appendLog(`Source code fast-forwarded in 1.5s (${files.length} files ready).`);
                } else {
                    await appendLog(`Cloning repository shallow tree from ${site.github_repo}@${targetBranch}...`);
                    await fs.promises.mkdir(path.dirname(gitCacheDir), { recursive: true }).catch(() => {});
                    execSync(`git clone --depth 1 --single-branch -b ${targetBranch} "${authRemote}" "${gitCacheDir}"`, {
                        stdio: 'ignore',
                        timeout: 120000
                    });
                    files = await readDirectoryAsExtractedFiles(gitCacheDir);
                    await appendLog(`Cloned repository shallow tree (${files.length} files ready).`);
                }
            } catch (gitErr: any) {
                logger.warn(`[Git Cache Notice] Falling back to GitHub archive streaming: ${gitErr?.message}`);
            }

            // Fallback to streaming GitHub archive download if git CLI encountered an issue
            if (!files || files.length === 0) {
                let lastLogKb = 0;
                const zipBuffer = await client.getRepoZipball(owner, repo, sha || targetBranch, (downloaded) => {
                    const kb = Math.round(downloaded / 1024);
                    if (kb - lastLogKb >= 1024) {
                        lastLogKb = kb;
                        appendLog(`Downloading archive: ${(downloaded / (1024 * 1024)).toFixed(1)} MB...`);
                    }
                });

                const totalKb = (zipBuffer.length / 1024).toFixed(1);
                await appendLog(`Downloaded ${totalKb} KB archive. Extracting files...`);
                files = await extractZipArchive(zipBuffer);
            }
            const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
            await appendLog(`Extracted ${files.length} files (${(totalBytes / 1024).toFixed(1)} KB).`);

            // 3. Check quota
            await checkHostingDeploySize(targetProjectId, totalBytes);

            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET total_size_bytes = $1, file_count = $2, status = 'building'
                 WHERE deploy_id = $3`,
                [totalBytes, files.length, deployId]
            );

            // 4. Load site environment variables (decrypt secrets)
            const envVars: Record<string, string> = {};
            try {
                const { decryptEnvValue } = await import('@/lib/hosting-env');
                const envRows = await pool.query(
                    `SELECT key, value, is_secret FROM fluxbase_global.hosting_env_vars
                     WHERE site_id = $1 AND (environment = $2 OR environment = 'all')`,
                    [site.site_id, targetEnv]
                );
                for (const row of envRows.rows) {
                    envVars[row.key] = row.is_secret ? decryptEnvValue(row.value) : row.value;
                }
            } catch {}

            // 5. Execute build
            const { executeProjectBuild } = await import('@/lib/hosting-build');
            const buildRes = await executeProjectBuild({
                deployId,
                siteId: site.site_id,
                projectId: targetProjectId,
                subdomain: site.subdomain,
                files,
                buildCommand: buildCommand || site.build_command,
                outputDirectory: outputDirectory || site.output_directory,
                installCommand: installCommand || site.install_command,
                rootDirectory: site.root_directory,
                envVars
            });

            if (buildRes.framework && buildRes.framework !== 'static') {
                await pool.query('UPDATE fluxbase_global.hosting_sites SET framework = $1 WHERE site_id = $2', [buildRes.framework, site.site_id]);
            }

            if (buildRes.isFullstack && buildRes.backendPort) {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites 
                     SET backend_port = $1, 
                         backend_status = $2, 
                         is_fullstack = true,
                         deployment_type = 'fullstack',
                         backend_entry_script = COALESCE($3, backend_entry_script),
                         backend_working_dir = COALESCE($4, backend_working_dir)
                     WHERE site_id = $5`,
                    [buildRes.backendPort, 'running', buildRes.backendEntryScript || null, buildRes.backendWorkingDir || null, site.site_id]
                );
            }

            // Check if canceled during build
            const cancelCheck = await pool.query('SELECT status FROM fluxbase_global.hosting_deployments WHERE deploy_id = $1', [deployId]);
            if (cancelCheck.rows[0]?.status === 'canceled') {
                await appendLog('Deployment canceled before asset publication.');
                return;
            }

            // 6. Upload compiled assets to S3
            await appendLog(`Uploading ${buildRes.files.length} compiled assets to global CDN...`);
            const uploadStats = await uploadDeploymentAssetsToS3(targetProjectId, deployId, buildRes.files);

            // Compute content-addressable SHA1 hashes for every deployed file
            const filesManifest = buildRes.files.map(f => ({
                path: f.path,
                sha: crypto.createHash('sha1').update(f.buffer).digest('hex'),
                size: f.size,
                mimeType: f.mimeType
            }));

            // 7. Deploy to edge server (/var/www/tenants/<subdomain>)
            await appendLog(`Deploying to top-tier edge cluster (/var/www/tenants)...`);
            const customDomains = site.custom_domain ? [site.custom_domain] : [];
            const edgeOpts: DeployToEdgeOptions = {
                customDomains,
                isFullstack: !!buildRes?.isFullstack,
                backendPort: buildRes?.backendPort,
                framework: buildRes?.framework,
                envVars: envVars || {},
                standaloneS3Key: buildRes?.standaloneS3Key
            };
            const edgeTasks = [
                deployToTenantsEdge(site.subdomain, buildRes.files, edgeOpts)
            ];
            if (targetEnv === 'preview') {
                edgeTasks.push(deployToTenantsEdge(`${deployId}.preview.fluxbasedb.me`, buildRes.files, { ...edgeOpts, customDomains: [] }));
            }
            if (cleanBranch) {
                edgeTasks.push(deployToTenantsEdge(`${site.subdomain}-git-${cleanBranch}.preview.fluxbasedb.me`, buildRes.files, { ...edgeOpts, customDomains: [] }));
            }
            await Promise.all(edgeTasks);

            // 8. Finalize live/ready status
            const isLive = targetEnv === 'production' || shouldPromote;
            const finalStatus = isLive ? 'live' : 'ready';
            const deployedAt = new Date();

            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments
                 SET status = $1, deployed_at = $2, file_count = $3, total_size_bytes = $4,
                     routing_manifest = $5, files_manifest = $6, framework_slug = $7
                 WHERE deploy_id = $8`,
                [
                    finalStatus,
                    isLive ? deployedAt : null,
                    uploadStats.fileCount,
                    uploadStats.totalBytes,
                    JSON.stringify(buildRes.routingManifest || []),
                    JSON.stringify(filesManifest),
                    buildRes.framework,
                    deployId
                ]
            );

            if (isLive) {
                // Supersede old live deployments
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments
                     SET status = 'superseded', superseded_at = $1
                     WHERE site_id = $2 AND deploy_id != $3 AND status = 'live'`,
                    [deployedAt, site.site_id, deployId]
                );

                // Update site production pointer and routing config
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites
                     SET production_deploy_id = $1, routing_config = $2, framework = $3, updated_at = $4
                     WHERE site_id = $5`,
                    [deployId, JSON.stringify(buildRes.routingConfig || {}), buildRes.framework, deployedAt, site.site_id]
                );

                // Invalidate Redis
                try {
                    const { redis } = await import('@/lib/redis');
                    await redis.del(`hosting:site:${site.subdomain}`);
                    if (cleanBranch) await redis.del(`hosting:branch:${site.subdomain}:${cleanBranch}`);
                    if (site.custom_domain) await redis.del(`hosting:site:${site.custom_domain}`);
                } catch {}
            } else {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_sites
                     SET preview_deploy_id = $1, updated_at = $2
                     WHERE site_id = $3`,
                    [deployId, deployedAt, site.site_id]
                );
            }

            const liveUrl = `https://${site.subdomain}.fluxbasedb.me`;
            await appendLog(`Auto-deployment complete! Live at ${isLive ? liveUrl : previewUrl}`);

            // Post success commit status to GitHub
            if (sha) {
                client.createCommitStatus(owner, repo, sha, {
                    state: 'success',
                    target_url: isLive ? liveUrl : (branchUrl || previewUrl),
                    description: isLive ? `Ready at https://${site.subdomain}.fluxbasedb.me` : `Preview ready at ${branchUrl || previewUrl}`
                }).catch(() => {});
            }

            // Post preview bot comment to pull request if triggered via PR
            if (prNumber) {
                const commentBody = `### Deploy Preview ready!

| Name | Link |
| --- | --- |
| **Latest Deploy** | [${previewUrl}](${previewUrl}) |
| **Branch Preview** | [${branchUrl || previewUrl}](${branchUrl || previewUrl}) |
| **Environment** | ${targetEnv} |
| **Commit** | ${sha ? sha.slice(0, 7) : 'latest'} |

*Built with Fluxbase Hosting Engine*`;
                client.postOrUpdatePRComment(owner, repo, prNumber, commentBody).catch(() => {});
            }
        } catch (err: any) {
            const isCanceled = err?.message?.includes('canceled by user') || err?.message?.includes('Deployment canceled');
            if (isCanceled) {
                await appendLog('DEPLOYMENT CANCELED: Deployment was canceled by user.', 'canceled');
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments SET status = 'canceled', error_message = 'Deployment canceled by user' WHERE deploy_id = $1`,
                    [deployId]
                );
                return;
            }
            logger.error(`[GitHub Deployment Error] [${deployId}]:`, err);
            const errMsg = err.message || 'Deployment pipeline failed';
            await appendLog(`DEPLOYMENT FAILED: ${errMsg}`, 'failed');
            await pool.query(
                `UPDATE fluxbase_global.hosting_deployments SET status = 'failed', error_message = $1 WHERE deploy_id = $2`,
                [errMsg.slice(0, 500), deployId]
            );

            // Post failure commit status to GitHub
            if (sha) {
                client.createCommitStatus(owner, repo, sha, {
                    state: 'failure',
                    target_url: previewUrl,
                    description: `Deployment failed: ${errMsg.slice(0, 100)}`
                }).catch(() => {});
            }
        }
    };

    if (asyncExecution) {
        runPipeline().catch((err) => {
            logger.error(`[Unhandled GitHub Deployment Async Error] [${deployId}]:`, err);
        });

        return {
            deployId,
            siteId: site.site_id,
            version: nextVersion,
            status: 'uploading',
            previewUrl,
            liveUrl: `https://${site.subdomain}.fluxbasedb.me`
        };
    }

    await runPipeline();
    return {
        deployId,
        siteId: site.site_id,
        version: nextVersion,
        previewUrl,
        liveUrl: `https://${site.subdomain}.fluxbasedb.me`
    };
}

