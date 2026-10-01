import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import logger from '@/lib/logger';
import { getPgPool } from '@/lib/pg';
import { decryptEnvValue } from '@/lib/hosting-env';

export interface RunningBackend {
    siteId: string;
    deployId: string;
    subdomain: string;
    port: number;
    process: ChildProcess;
    pid: number;
    startedAt: Date;
    standaloneDir: string;
    entryScript: string;
    restartCount: number;
    lastRestartAt?: Date;
}

// In-memory registry of active full-stack backend processes (keyed by siteId)
const activeProcesses = new Map<string, RunningBackend>();

// Track sites currently undergoing automatic recovery to prevent duplicate concurrent launches
const recoveringSites = new Set<string>();

/**
 * Probes whether a port is currently listening on 127.0.0.1
 */
export async function isPortListening(port: number, timeoutMs = 800): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        let resolved = false;

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(true);
            }
        });

        socket.on('timeout', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        });

        socket.on('error', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        });

        socket.connect(port, '127.0.0.1');
    });
}

/**
 * Finds an open TCP port on the local system within a specified range
 */
export async function findAvailablePort(startPort = 3200, endPort = 3900): Promise<number> {
    for (let port = startPort; port <= endPort; port++) {
        // 1. Check if port is assigned to any active in-memory process
        const isAssignedInMemory = Array.from(activeProcesses.values()).some(p => p.port === port);
        if (isAssignedInMemory) continue;

        // 2. Check if port is actively listening at the OS network level
        const isOccupied = await isPortListening(port, 200);
        if (isOccupied) continue;

        // 3. Test binding directly
        const isAvailable = await new Promise<boolean>((resolve) => {
            const server = net.createServer();
            server.unref();
            server.on('error', () => resolve(false));
            server.listen(port, '127.0.0.1', () => {
                server.close(() => resolve(true));
            });
        });

        if (isAvailable) {
            return port;
        }
    }
    throw new Error(`No available ports found in range ${startPort}-${endPort}`);
}

/**
 * Waits for a server on a given port to become responsive via HTTP
 */
export async function waitForPortReady(port: number, timeoutMs = 25000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const isUp = await new Promise<boolean>((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 1500 }, (res) => {
                res.resume();
                resolve(true); // Any HTTP response (200, 308, 404) means server is listening!
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });

        if (isUp) return true;
        await new Promise(r => setTimeout(r, 400));
    }
    return false;
}

/**
 * Finds the entrypoint script inside a standalone or Node.js directory
 */
export function locateBackendEntryScript(dir: string): string | null {
    const possibleEntries = [
        path.join(dir, 'server.js'),
        path.join(dir, '.next', 'standalone', 'server.js'),
        path.join(dir, 'index.js'),
        path.join(dir, 'app.js'),
        path.join(dir, 'main.js'),
        path.join(dir, 'dist', 'index.js'),
        path.join(dir, 'dist', 'server.js'),
        path.join(dir, 'build', 'index.js')
    ];

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.main) {
                possibleEntries.unshift(path.join(dir, pkg.main));
            }
        } catch {}
    }

    return possibleEntries.find(p => fs.existsSync(p)) || null;
}

/**
 * Starts a full-stack Next.js or Node.js backend process
 */
export async function startBackendProcess(params: {
    siteId: string;
    deployId: string;
    subdomain: string;
    standaloneDir: string;
    envVars?: Record<string, string>;
    entryScript?: string;
    logStream?: (line: string) => void;
}): Promise<{ success: boolean; port: number; error?: string }> {
    const { siteId, deployId, subdomain, standaloneDir, envVars = {}, logStream } = params;

    const log = (msg: string) => {
        logger.info(`[BackendRunner:${subdomain}] ${msg}`);
        if (logStream) logStream(msg);
    };

    const entryScript = params.entryScript || locateBackendEntryScript(standaloneDir);

    if (!entryScript || !fs.existsSync(entryScript)) {
        return { success: false, port: 0, error: `No backend entry script found in ${standaloneDir}` };
    }

    const assignedPort = await findAvailablePort();
    log(`Allocated dedicated server port: ${assignedPort}`);

    // Merge environment variables
    const processEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...envVars,
        PORT: assignedPort.toString(),
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production'
    };

    const scriptDir = path.dirname(entryScript);
    let restartCount = 0;

    function spawnProcess(): ChildProcess {
        const childProc = spawn(process.execPath, [entryScript!], {
            cwd: scriptDir,
            env: processEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        childProc.stdout?.on('data', (data) => {
            const text = data.toString().trim();
            if (text) log(`[stdout] ${text}`);
        });

        childProc.stderr?.on('data', (data) => {
            const text = data.toString().trim();
            if (text) log(`[stderr] ${text}`);
        });

        childProc.on('error', (err) => {
            logger.error(`[Server Supervisor Error] ${err.message}`);
        });

        // Supervisor Auto-Restart
        childProc.on('exit', (code, signal) => {
            log(`[Server Process] Process exited (code: ${code}, signal: ${signal || 'none'})`);
            const current = activeProcesses.get(siteId);

            if (current && current.process.pid === childProc.pid && code !== 0 && code !== null) {
                const now = new Date();
                // Reset restart count if the process had been stable for over 5 minutes
                if (current.lastRestartAt && now.getTime() - current.lastRestartAt.getTime() > 300000) {
                    restartCount = 0;
                }

                if (restartCount < 5) {
                    restartCount++;
                    const backoffMs = Math.min(1000 * Math.pow(2, restartCount), 10000);
                    log(`[Server Supervisor] Crash detected! Restarting in ${backoffMs}ms (attempt ${restartCount}/5)...`);

                    setTimeout(() => {
                        try {
                            const restarted = spawnProcess();
                            activeProcesses.set(siteId, {
                                siteId,
                                deployId,
                                subdomain,
                                port: assignedPort,
                                process: restarted,
                                pid: restarted.pid || 0,
                                startedAt: new Date(),
                                standaloneDir,
                                entryScript: entryScript!,
                                restartCount,
                                lastRestartAt: new Date()
                            });

                            // Update PID in database
                            const pool = getPgPool();
                            pool.query(
                                `UPDATE fluxbase_global.hosting_sites SET backend_pid = $1 WHERE site_id = $2`,
                                [restarted.pid, siteId]
                            ).catch(() => {});

                            log(`[Server Supervisor] Successfully restarted process (PID ${restarted.pid})`);
                        } catch (rErr: any) {
                            logger.error(`[Server Supervisor] Restart failed:`, rErr);
                        }
                    }, backoffMs);
                } else {
                    log(`[Server Supervisor Alert] Process exceeded max restart threshold (5 crashes). Marking crashed.`);
                    activeProcesses.delete(siteId);
                    const pool = getPgPool();
                    pool.query(
                        `UPDATE fluxbase_global.hosting_sites SET backend_status = 'crashed' WHERE site_id = $1`,
                        [siteId]
                    ).catch(() => {});
                }
            }
        });

        return childProc;
    }

    const child = spawnProcess();
    log(`Spawning persistent backend service (PID ${child.pid}). Waiting for health check...`);
    const isReady = await waitForPortReady(assignedPort);

    if (!isReady) {
        try { child.kill('SIGTERM'); } catch {}
        return { success: false, port: 0, error: `Backend service failed to respond on port ${assignedPort} within timeout` };
    }

    log(`Backend process is healthy on port ${assignedPort}!`);

    // Terminate old running process for this site if present
    const oldProcess = activeProcesses.get(siteId);
    if (oldProcess && oldProcess.process && oldProcess.process.pid !== child.pid) {
        log(`Terminating previous backend process (PID ${oldProcess.process.pid})...`);
        try { oldProcess.process.kill('SIGTERM'); } catch {}
    }

    // Register active process in-memory
    activeProcesses.set(siteId, {
        siteId,
        deployId,
        subdomain,
        port: assignedPort,
        process: child,
        pid: child.pid || 0,
        startedAt: new Date(),
        standaloneDir,
        entryScript,
        restartCount: 0
    });

    // Update database & Redis cache
    try {
        const pool = getPgPool();
        await pool.query(
            `UPDATE fluxbase_global.hosting_sites
             SET backend_port = $1,
                 backend_pid = $2,
                 backend_status = 'running',
                 backend_entry_script = $3,
                 backend_working_dir = $4,
                 deployment_type = 'fullstack',
                 is_fullstack = true
             WHERE site_id = $5`,
            [assignedPort, child.pid, entryScript, standaloneDir, siteId]
        );

        const { redis } = await import('@/lib/redis');
        await redis.set(`hosting:backend:${subdomain}`, assignedPort.toString(), { ex: 86400 * 30 });
        await redis.set(`hosting:backend:${subdomain}.fluxbasedb.me`, assignedPort.toString(), { ex: 86400 * 30 });
        await redis.set(`hosting:backend:site:${siteId}`, assignedPort.toString(), { ex: 86400 * 30 });
    } catch (e: any) {
        logger.warn('Failed to update backend port in DB/Redis:', e);
    }

    return { success: true, port: assignedPort };
}

/**
 * Automatically recovers and boots a full-stack backend service from disk or S3 backup
 */
export async function recoverBackendProcess(siteId: string): Promise<{ success: boolean; port: number; error?: string }> {
    if (recoveringSites.has(siteId)) {
        // Wait for ongoing recovery to complete
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (!recoveringSites.has(siteId)) {
                const active = activeProcesses.get(siteId);
                if (active) return { success: true, port: active.port };
                break;
            }
        }
    }

    recoveringSites.add(siteId);
    try {
        const pool = getPgPool();

        // 1. Fetch site and latest active deployment
        const siteRes = await pool.query(
            `SELECT s.*, d.standalone_s3_key, d.deploy_id as latest_deploy_id
             FROM fluxbase_global.hosting_sites s
             LEFT JOIN fluxbase_global.hosting_deployments d ON d.deploy_id = s.production_deploy_id
             WHERE s.site_id = $1`,
            [siteId]
        );

        const site = siteRes.rows[0];
        if (!site) {
            return { success: false, port: 0, error: `Site ${siteId} not found` };
        }

        const subdomain = site.subdomain;
        const deployId = site.production_deploy_id || site.latest_deploy_id || `dep_recovered_${siteId.slice(0, 8)}`;

        // 2. Fetch custom environment variables (decrypted)
        const envRes = await pool.query(
            `SELECT key, value, is_secret FROM fluxbase_global.hosting_env_vars WHERE site_id = $1`,
            [siteId]
        );
        const envVars: Record<string, string> = {};
        for (const r of envRes.rows) {
            envVars[r.key] = r.is_secret ? decryptEnvValue(r.value) : r.value;
        }

        // 3. Determine standalone bundle location
        const persistentBaseDir = path.join(process.cwd(), '.fluxbase-backends', siteId);
        const tmpBaseDir = path.join(os.tmpdir(), 'fluxbase-backends', siteId);
        let standaloneDir = site.backend_working_dir;

        // Check if existing working directory has entry script
        let entryScript = site.backend_entry_script;
        const hasLocalFiles = standaloneDir && fs.existsSync(standaloneDir) && locateBackendEntryScript(standaloneDir);

        if (hasLocalFiles) {
            entryScript = locateBackendEntryScript(standaloneDir)!;
        } else if (fs.existsSync(persistentBaseDir) && locateBackendEntryScript(persistentBaseDir)) {
            standaloneDir = persistentBaseDir;
            entryScript = locateBackendEntryScript(persistentBaseDir)!;
        } else if (fs.existsSync(tmpBaseDir) && locateBackendEntryScript(tmpBaseDir)) {
            standaloneDir = tmpBaseDir;
            entryScript = locateBackendEntryScript(tmpBaseDir)!;
        } else if (site.standalone_s3_key) {
            // Restore from S3 backup archive
            logger.info(`[BackendRunner:${subdomain}] Restoring standalone bundle from S3 (${site.standalone_s3_key})...`);
            const { downloadFromS3 } = await import('@/lib/storage');
            const { extractStandaloneArchive } = await import('@/lib/hosting-archive');

            const archiveBuffer = await downloadFromS3(site.standalone_s3_key);
            standaloneDir = persistentBaseDir;
            await extractStandaloneArchive(archiveBuffer, standaloneDir);

            entryScript = locateBackendEntryScript(standaloneDir);
            if (!entryScript) {
                return { success: false, port: 0, error: `Restored S3 bundle has no valid server entrypoint in ${standaloneDir}` };
            }
        } else {
            return {
                success: false,
                port: 0,
                error: `Cannot recover backend for ${subdomain}: No local files or S3 standalone backup found.`
            };
        }

        logger.info(`[BackendRunner:${subdomain}] Launching recovered backend process...`);
        const result = await startBackendProcess({
            siteId,
            deployId,
            subdomain,
            standaloneDir,
            entryScript: entryScript || undefined,
            envVars
        });

        return result;
    } catch (err: any) {
        logger.error(`[Backend Recovery Failed] [${siteId}]:`, err);
        return { success: false, port: 0, error: err.message };
    } finally {
        recoveringSites.delete(siteId);
    }
}

/**
 * Returns the active port for a given site subdomain/host, checking in-memory, Redis, and DB.
 * Automatically recovers and launches dead processes if the site is a fullstack app.
 */
export async function getBackendPort(hostOrSubdomain: string, optionalSiteId?: string): Promise<number | null> {
    let clean = (hostOrSubdomain || '').split(':')[0].toLowerCase().trim();

    // Normalize subdomain
    let subdomain = clean;
    if (clean.includes('.preview.fluxbasedb.me')) {
        const prefix = clean.replace('.preview.fluxbasedb.me', '');
        if (prefix.includes('-git-')) {
            subdomain = prefix.split('-git-')[0];
        } else {
            subdomain = prefix;
        }
    } else if (clean.endsWith('.fluxbasedb.me')) {
        subdomain = clean.replace('.fluxbasedb.me', '');
    }

    // 1. In-memory check for known active process
    let activeMatch: RunningBackend | undefined;
    if (optionalSiteId && activeProcesses.has(optionalSiteId)) {
        activeMatch = activeProcesses.get(optionalSiteId);
    } else {
        for (const proc of activeProcesses.values()) {
            if (proc.subdomain === subdomain || proc.siteId === clean || proc.subdomain === clean) {
                activeMatch = proc;
                break;
            }
        }
    }

    if (activeMatch) {
        const isUp = await isPortListening(activeMatch.port, 400);
        if (isUp) {
            return activeMatch.port;
        } else {
            // Process died or port stopped responding
            activeProcesses.delete(activeMatch.siteId);
        }
    }

    // 2. Redis check
    try {
        const { redis } = await import('@/lib/redis');
        const keys = [
            `hosting:backend:${subdomain}`,
            `hosting:backend:${clean}`,
            optionalSiteId ? `hosting:backend:site:${optionalSiteId}` : null
        ].filter(Boolean) as string[];

        for (const k of keys) {
            const cached = await redis.get<string>(k);
            if (cached && !isNaN(Number(cached))) {
                const p = Number(cached);
                const isUp = await isPortListening(p, 400);
                if (isUp) return p;
            }
        }
    } catch {}

    // 3. Database check & auto-recovery
    try {
        const pool = getPgPool();
        const res = await pool.query(
            `SELECT site_id, subdomain, backend_port, backend_status, is_fullstack
             FROM fluxbase_global.hosting_sites
             WHERE (site_id = $1 OR subdomain = $2 OR subdomain = $3 OR custom_domain = $3)
             LIMIT 1`,
            [optionalSiteId || '00000000-0000-0000-0000-000000000000', subdomain, clean]
        );

        const row = res.rows[0];
        if (row && row.is_fullstack) {
            // If DB recorded a port, check if it is still alive
            if (row.backend_port) {
                const isUp = await isPortListening(row.backend_port, 500);
                if (isUp) {
                    // Update Redis cache and in-memory tracking
                    try {
                        const { redis } = await import('@/lib/redis');
                        await redis.set(`hosting:backend:${subdomain}`, row.backend_port.toString(), { ex: 86400 * 30 });
                    } catch {}
                    return row.backend_port;
                }
            }

            // Port is dead or not listening: trigger automatic recovery!
            logger.info(`[BackendRunner] Process for ${subdomain} (${row.site_id}) is down. Triggering automatic recovery...`);
            const recovery = await recoverBackendProcess(row.site_id);
            if (recovery.success) {
                return recovery.port;
            }
        }
    } catch (err: any) {
        logger.warn(`[getBackendPort] DB lookup error for ${clean}:`, err?.message);
    }

    return null;
}

/**
 * Stops an active backend process for a site
 */
export async function stopBackendProcess(siteId: string): Promise<void> {
    const running = activeProcesses.get(siteId);
    if (running && running.process) {
        try {
            running.process.kill('SIGTERM');
            setTimeout(() => {
                try { running.process.kill('SIGKILL'); } catch {}
            }, 2000);
        } catch {}
        activeProcesses.delete(siteId);
    }

    try {
        const pool = getPgPool();
        const res = await pool.query(
            `UPDATE fluxbase_global.hosting_sites
             SET backend_status = 'stopped', backend_pid = NULL
             WHERE site_id = $1
             RETURNING subdomain`,
            [siteId]
        );

        const subdomain = res.rows[0]?.subdomain;
        if (subdomain) {
            const { redis } = await import('@/lib/redis');
            await redis.del(`hosting:backend:${subdomain}`);
            await redis.del(`hosting:backend:${subdomain}.fluxbasedb.me`);
            await redis.del(`hosting:backend:site:${siteId}`);
        }
    } catch {}
}

/**
 * Restarts a site's backend service
 */
export async function restartSiteBackend(siteId: string): Promise<{ success: boolean; port?: number; error?: string }> {
    await stopBackendProcess(siteId);
    // Allow OS port release
    await new Promise(r => setTimeout(r, 600));
    return recoverBackendProcess(siteId);
}

/**
 * Startup hook: automatically recovers all full-stack sites marked 'running' in DB
 */
export async function recoverAllRunningBackends(): Promise<{ recovered: number; errors: number }> {
    logger.info('[Startup Recovery] Scanning for full-stack sites requiring backend processes...');
    let recovered = 0;
    let errors = 0;

    try {
        const pool = getPgPool();
        const res = await pool.query(
            `SELECT site_id, subdomain, backend_port, backend_status
             FROM fluxbase_global.hosting_sites
             WHERE is_fullstack = true AND backend_status = 'running'`
        );

        for (const site of res.rows) {
            // Check if already running on the recorded port
            if (site.backend_port && await isPortListening(site.backend_port, 400)) {
                logger.info(`[Startup Recovery] Site ${site.subdomain} already alive on port ${site.backend_port}`);
                continue;
            }

            logger.info(`[Startup Recovery] Re-spawning backend for ${site.subdomain} (${site.site_id})...`);
            const result = await recoverBackendProcess(site.site_id);
            if (result.success) {
                recovered++;
                logger.info(`[Startup Recovery] Successfully recovered ${site.subdomain} on port ${result.port}!`);
            } else {
                errors++;
                logger.warn(`[Startup Recovery Warning] Could not recover ${site.subdomain}: ${result.error}`);
            }
        }
    } catch (err: any) {
        logger.error('[Startup Recovery Error]:', err);
    }

    return { recovered, errors };
}

/**
 * Returns current status of a site's backend process
 */
export async function getSiteBackendStatus(siteId: string): Promise<{
    status: 'running' | 'stopped' | 'crashed' | 'unknown';
    port: number | null;
    pid: number | null;
    uptimeSeconds: number | null;
    isFullstack: boolean;
}> {
    const active = activeProcesses.get(siteId);
    if (active) {
        const isUp = await isPortListening(active.port, 300);
        if (isUp) {
            const uptime = Math.round((Date.now() - active.startedAt.getTime()) / 1000);
            return {
                status: 'running',
                port: active.port,
                pid: active.pid,
                uptimeSeconds: uptime,
                isFullstack: true
            };
        }
    }

    try {
        const pool = getPgPool();
        const res = await pool.query(
            `SELECT backend_port, backend_pid, backend_status, is_fullstack
             FROM fluxbase_global.hosting_sites
             WHERE site_id = $1`,
            [siteId]
        );

        const row = res.rows[0];
        if (!row || !row.is_fullstack) {
            return { status: 'stopped', port: null, pid: null, uptimeSeconds: null, isFullstack: false };
        }

        if (row.backend_port && await isPortListening(row.backend_port, 300)) {
            return {
                status: 'running',
                port: row.backend_port,
                pid: row.backend_pid,
                uptimeSeconds: null,
                isFullstack: true
            };
        }

        return {
            status: (row.backend_status as any) || 'stopped',
            port: row.backend_port,
            pid: row.backend_pid,
            uptimeSeconds: null,
            isFullstack: true
        };
    } catch {
        return { status: 'unknown', port: null, pid: null, uptimeSeconds: null, isFullstack: false };
    }
}

/**
 * Stops any existing process and immediately recovers/re-spawns it
 */
export async function restartBackendProcess(siteId: string): Promise<{ success: boolean; port: number; error?: string }> {
    await stopBackendProcess(siteId);
    return recoverBackendProcess(siteId);
}

