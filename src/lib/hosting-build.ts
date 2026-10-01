import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ExtractedFile, detectMimeType, sanitizePath } from '@/lib/hosting-engine';
import logger from '@/lib/logger';
import { getPgPool } from '@/lib/pg';
import { detectFrameworkRecord, createMemoryDetectorFilesystem } from '@/lib/hosting-frameworks';
import { compileSuperstaticRoutes, UserVercelConfig } from '@/lib/hosting-router';

/**
 * Recovers zombie deployments that were stuck in 'building' or 'uploading' due to server restarts.
 * Call this on application startup.
 */
export async function cleanupZombieDeployments(): Promise<number> {
    try {
        const pool = getPgPool();
        const result = await pool.query(
            `UPDATE fluxbase_global.hosting_deployments
             SET status = 'failed',
                 error_message = 'Build process was interrupted by a server restart. Please redeploy.'
             WHERE status IN ('building', 'uploading', 'queued')
               AND created_at < NOW() - INTERVAL '5 minutes'
             RETURNING deploy_id`
        );
        if (result.rowCount && result.rowCount > 0) {
            logger.info(`[Hosting] Recovered ${result.rowCount} zombie deployment(s): ${result.rows.map((r: any) => r.deploy_id).join(', ')}`);
        }
        return result.rowCount || 0;
    } catch (err) {
        logger.warn('[Hosting] Failed to cleanup zombie deployments:', err);
        return 0;
    }
}

export interface DetectedFramework {
    name: string;
    framework: string;
    buildCommand: string;
    outputDirectory: string;
    installCommand: string;
}

export function detectFramework(files: ExtractedFile[]): DetectedFramework {
    // Prioritize root package.json before any nested packages in monorepos or subdirectories
    const pkgFile = files.find(f => f.path === 'package.json') || files.find(f => f.path.endsWith('/package.json'));
    if (!pkgFile) {
        return {
            name: 'Static Web Application',
            framework: 'static',
            buildCommand: '',
            outputDirectory: '.',
            installCommand: ''
        };
    }

    try {
        const pkg = JSON.parse(pkgFile.buffer.toString('utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        const hasLockfile = files.some(f => f.path === 'package-lock.json');
        const hasYarnLock = files.some(f => f.path === 'yarn.lock');
        const hasPnpmLock = files.some(f => f.path === 'pnpm-lock.yaml');
        const hasBunLock = files.some(f => f.path === 'bun.lockb' || f.path === 'bun.lock');

        let defaultInstall = 'npm install --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline --maxsockets=5';
        if (hasBunLock) {
            defaultInstall = 'bun install --no-save';
        } else if (hasYarnLock) {
            defaultInstall = 'yarn install --frozen-lockfile';
        } else if (hasPnpmLock) {
            defaultInstall = 'pnpm install --frozen-lockfile';
        }

        if (deps.next) {
            return {
                name: 'Next.js',
                framework: 'next',
                buildCommand: pkg.scripts?.build ? 'npm run build' : 'npx next build',
                outputDirectory: 'out',
                installCommand: defaultInstall
            };
        }

        if (deps.vite) {
            return {
                name: 'Vite',
                framework: 'vite',
                buildCommand: pkg.scripts?.build ? 'npm run build' : 'npx vite build',
                outputDirectory: 'dist',
                installCommand: defaultInstall
            };
        }

        if (deps['react-scripts']) {
            return {
                name: 'Create React App',
                framework: 'react',
                buildCommand: pkg.scripts?.build ? 'npm run build' : 'npx react-scripts build',
                outputDirectory: 'build',
                installCommand: defaultInstall
            };
        }

        if (deps.vue || deps['@vue/cli-service']) {
            return {
                name: 'Vue.js',
                framework: 'vue',
                buildCommand: pkg.scripts?.build ? 'npm run build' : 'npx vue-cli-service build',
                outputDirectory: 'dist',
                installCommand: defaultInstall
            };
        }

        if (deps.astro) {
            return {
                name: 'Astro',
                framework: 'astro',
                buildCommand: pkg.scripts?.build ? 'npm run build' : 'npx astro build',
                outputDirectory: 'dist',
                installCommand: defaultInstall
            };
        }

        if (deps['@sveltejs/kit'] || deps.svelte) {
            return {
                name: 'Svelte',
                framework: 'svelte',
                buildCommand: pkg.scripts?.build ? 'npm run build' : 'npx vite build',
                outputDirectory: 'build',
                installCommand: defaultInstall
            };
        }

        return {
            name: 'Node / JavaScript',
            framework: 'node',
            buildCommand: pkg.scripts?.build ? 'npm run build' : '',
            outputDirectory: 'dist',
            installCommand: defaultInstall
        };
    } catch {
        return {
            name: 'Static Web Application',
            framework: 'static',
            buildCommand: '',
            outputDirectory: '.',
            installCommand: ''
        };
    }
}

/**
 * Checks whether the files already contain built static HTML assets
 */
export function findBuiltAssets(files: ExtractedFile[], targetOutputDir?: string): ExtractedFile[] | null {
    // Check if the project has a package.json with a build script
    // If so, a root index.html is typically a source template (e.g. Vite, Astro, Svelte), NOT a pre-built bundle!
    let hasBuildScript = false;
    const pkgFile = files.find(f => f.path === 'package.json');
    if (pkgFile) {
        try {
            const pkg = JSON.parse(pkgFile.buffer.toString('utf8'));
            if (pkg.scripts && (pkg.scripts.build || pkg.scripts['build:prod'] || pkg.scripts['build:static'])) {
                hasBuildScript = true;
            }
        } catch {}
    }

    // 1. Direct index.html at root (if there is NO build script to run, this is a pure static site ready to serve)
    if (!hasBuildScript) {
        const rootIndex = files.find(f => f.path === 'index.html');
        if (rootIndex) {
            return files;
        }
    }

    // 2. Check candidate directories: targetOutputDir or common defaults
    const candidateDirs = targetOutputDir && targetOutputDir !== '.' && targetOutputDir !== '/'
        ? [targetOutputDir, 'out', 'dist', 'build', 'public']
        : ['out', 'dist', 'build', 'public'];

    for (const dir of candidateDirs) {
        const cleanDir = dir.replace(/^\/+|\/+$/g, '');
        const hasIndex = files.some(f => f.path === `${cleanDir}/index.html`);
        if (hasIndex) {
            const built: ExtractedFile[] = [];
            for (const f of files) {
                if (f.path.startsWith(`${cleanDir}/`)) {
                    const newPath = f.path.slice(cleanDir.length + 1);
                    if (newPath) {
                        built.push({
                            path: newPath,
                            buffer: f.buffer,
                            size: f.size,
                            mimeType: detectMimeType(newPath)
                        });
                    }
                }
            }
            if (built.length > 0) return built;
        }
    }

    return null;
}

interface ActiveBuildJob {
    deployId: string;
    child?: import('child_process').ChildProcess;
    isCanceled?: boolean;
}

const activeBuildJobs = new Map<string, ActiveBuildJob>();

export async function cancelDeploymentBuild(
    deployId: string,
    reason: string = 'Deployment canceled by user'
): Promise<{ success: boolean; message: string }> {
    const pool = getPgPool();
    const job = activeBuildJobs.get(deployId);
    if (job) {
        job.isCanceled = true;
        if (job.child) {
            try {
                if (process.platform === 'win32' && job.child.pid) {
                    spawn('taskkill', ['/pid', job.child.pid.toString(), '/T', '/F']);
                } else if (job.child.pid) {
                    job.child.kill('SIGTERM');
                }
            } catch (err) {
                logger.warn(`Failed to kill process for deploy ${deployId}:`, err);
            }
        }
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await pool.query(
        `UPDATE fluxbase_global.hosting_deployments 
         SET status = 'canceled', 
             error_message = $1, 
             build_logs = COALESCE(build_logs, '') || E'\\n' || $2
         WHERE deploy_id = $3 AND status IN ('uploading', 'building', 'queued')`,
        [reason, `[${timestamp}] [System] Deployment was canceled by user.`, deployId]
    );

    return { success: true, message: 'Deployment canceled successfully' };
}

interface RunCommandOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onLog: (line: string) => void;
    deployId?: string;
}

/**
 * Runs a process with real-time streaming output
 */
function runStreamingCommand(
    command: string,
    options: RunCommandOptions
): Promise<{ code: number }> {
    return new Promise((resolve, reject) => {
        const timeoutMs = options.timeoutMs || 300000;
        let timedOut = false;

        if (options.deployId && activeBuildJobs.get(options.deployId)?.isCanceled) {
            return reject(new Error('Deployment canceled by user'));
        }

        const child = spawn(command, {
            shell: true,
            cwd: options.cwd,
            env: options.env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        if (options.deployId) {
            const job = activeBuildJobs.get(options.deployId);
            if (job) {
                job.child = child;
            }
        }

        const timer = setTimeout(() => {
            timedOut = true;
            if (process.platform === 'win32' && child.pid) {
                try {
                    spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
                } catch (_) {}
            } else {
                child.kill('SIGTERM');
            }
            reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command}`));
        }, timeoutMs);

        let stdoutBuf = '';
        child.stdout?.on('data', (data) => {
            stdoutBuf += data.toString();
            const lines = stdoutBuf.split(/\r?\n/);
            stdoutBuf = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trimEnd();
                if (trimmed) options.onLog(trimmed);
            }
        });

        let stderrBuf = '';
        child.stderr?.on('data', (data) => {
            stderrBuf += data.toString();
            const lines = stderrBuf.split(/\r?\n/);
            stderrBuf = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trimEnd();
                if (trimmed) options.onLog(trimmed);
            }
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (stdoutBuf.trim()) options.onLog(stdoutBuf.trimEnd());
            if (stderrBuf.trim()) options.onLog(stderrBuf.trimEnd());
            if (timedOut) return;
            if (code !== 0 && code !== null) {
                reject(new Error(`Command failed with exit code ${code}`));
            } else {
                resolve({ code: code || 0 });
            }
        });
    });
}

/**
 * Executes a project build in a sandbox directory with real-time log streaming
 */
export async function executeProjectBuild(params: {
    deployId: string;
    siteId: string;
    projectId: string;
    subdomain?: string;
    files: ExtractedFile[];
    buildCommand?: string;
    outputDirectory?: string;
    installCommand?: string;
    rootDirectory?: string;
    envVars?: Record<string, string>;
    onLogUpdate?: (fullLogs: string, status?: string) => Promise<void> | void;
}): Promise<{
    files: ExtractedFile[];
    buildLogs: string;
    framework: string;
    routingManifest?: any[];
    routingConfig?: any;
    isFullstack?: boolean;
    backendPort?: number;
    standaloneS3Key?: string;
    backendEntryScript?: string;
    backendWorkingDir?: string;
}> {
    const {
        deployId,
        subdomain,
        files: rawFiles,
        buildCommand,
        outputDirectory,
        installCommand,
        rootDirectory,
        envVars = {},
        onLogUpdate
    } = params;

    const logs: string[] = [];
    const pool = getPgPool();
    let flushTimeout: NodeJS.Timeout | null = null;
    let lastFlushTime = 0;

    const flushLogsToDb = async (statusOverride?: string) => {
        try {
            const currentLogs = logs.join('\n');
            if (statusOverride) {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments 
                     SET build_logs = $1, status = $2 
                     WHERE deploy_id = $3`,
                    [currentLogs, statusOverride, deployId]
                );
            } else {
                await pool.query(
                    `UPDATE fluxbase_global.hosting_deployments 
                     SET build_logs = $1 
                     WHERE deploy_id = $2`,
                    [currentLogs, deployId]
                );
            }
            if (onLogUpdate) {
                await onLogUpdate(currentLogs, statusOverride);
            }
        } catch (dbErr) {
            logger.warn(`[Build DB Log Update Warning] [${deployId}]:`, dbErr);
        }
    };

    const scheduleFlush = () => {
        const now = Date.now();
        if (now - lastFlushTime > 800) {
            lastFlushTime = now;
            flushLogsToDb();
        } else if (!flushTimeout) {
            flushTimeout = setTimeout(() => {
                flushTimeout = null;
                lastFlushTime = Date.now();
                flushLogsToDb();
            }, 800);
        }
    };

    const log = (msg: string) => {
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        logs.push(`[${timestamp}] ${msg}`);
        scheduleFlush();
    };

    const logStream = (line: string) => {
        logs.push(line);
        scheduleFlush();
    };

    activeBuildJobs.set(deployId, { deployId });

    log(`Starting deployment compilation for ${deployId}`);

    // If custom rootDirectory is specified (e.g. monorepo subfolder), scope the files
    let files = rawFiles;
    const cleanRootDir = rootDirectory ? rootDirectory.replace(/^\/+|\/+$/g, '').replace(/^\.\//, '') : '';
    if (cleanRootDir && cleanRootDir !== '.' && cleanRootDir !== '/') {
        const prefix = `${cleanRootDir}/`;
        const scoped = rawFiles
            .filter(f => f.path.startsWith(prefix))
            .map(f => ({
                ...f,
                path: f.path.slice(prefix.length)
            }));
        if (scoped.length > 0) {
            files = scoped;
            log(`Scoped build to root directory: ${cleanRootDir} (${files.length} files)`);
        }
    }

    // Parse vercel.json if present
    let userVercelConfig: UserVercelConfig = {};
    const vercelJsonFile = files.find(f => f.path === 'vercel.json' || f.path.endsWith('/vercel.json'));
    if (vercelJsonFile) {
        try {
            userVercelConfig = JSON.parse(vercelJsonFile.buffer.toString('utf8'));
            log('[Vercel Config] Loaded user vercel.json configuration (cleanUrls, rewrites, redirects, headers).');
        } catch (vErr: any) {
            log(`[Vercel Config Warning] Failed to parse vercel.json: ${vErr.message}`);
        }
    }

    // Check if pre-built assets already exist in the archive
    const existingBuilt = findBuiltAssets(files, outputDirectory);
    const hasPackageJson = files.some(f => f.path === 'package.json' || f.path.endsWith('/package.json'));

    // If already pre-built and has index.html, skip build step!
    if (existingBuilt && existingBuilt.some(f => f.path === 'index.html')) {
        log(`Detected pre-built static bundle (${existingBuilt.length} assets ready for deployment).`);
        log(`Found root index.html. Skipping build step.`);
        const compiledRoutes = compileSuperstaticRoutes(userVercelConfig, []);
        await flushLogsToDb('building');
        return {
            files: existingBuilt,
            buildLogs: logs.join('\n'),
            framework: 'static',
            routingManifest: compiledRoutes,
            routingConfig: userVercelConfig
        };
    }

    // Run deterministic Vercel framework auto-detection
    const fsMem = createMemoryDetectorFilesystem(files);
    const detectedRecord = await detectFrameworkRecord(fsMem, {
        rootDir: cleanRootDir || '.',
        customBuildCommand: buildCommand,
        customInstallCommand: installCommand,
        customOutputDirectory: outputDirectory
    });

    const detected = {
        name: detectedRecord.framework.name,
        framework: detectedRecord.framework.slug,
        buildCommand: detectedRecord.buildCommand,
        installCommand: detectedRecord.installCommand,
        outputDirectory: detectedRecord.outputDirectory,
        envPrefix: detectedRecord.envPrefix
    };

    let effectiveBuildCmd = buildCommand !== undefined && buildCommand !== '' ? buildCommand : detected.buildCommand;
    let effectiveInstallCmd = installCommand !== undefined && installCommand !== '' ? installCommand : detected.installCommand;
    let effectiveOutDir = outputDirectory !== undefined && outputDirectory !== '' ? outputDirectory : detected.outputDirectory;

    // Next.js specific normalization
    if (detected.framework === 'nextjs' || detected.framework === 'next') {
        if (!effectiveOutDir || effectiveOutDir === 'dist') {
            effectiveOutDir = 'out';
        }
        if (!effectiveBuildCmd) {
            effectiveBuildCmd = 'npm run build';
        }
    }

    // For any npm-based installation across all frameworks (Next, Vite, CRA, Astro, etc.):
    // Ensure devDependencies are included and legacy-peer-deps prevents lockfile deadlocks
    if (effectiveInstallCmd && (effectiveInstallCmd.includes('npm install') || effectiveInstallCmd.includes('npm ci'))) {
        if (!effectiveInstallCmd.includes('--legacy-peer-deps')) {
            effectiveInstallCmd = 'npm install --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline';
        }
    }

    let compiledRoutes = compileSuperstaticRoutes(
        userVercelConfig,
        detectedRecord.framework.defaultRoutes || []
    );

    log(`Framework auto-detection: ${detected.name} (${detected.framework})`);
    log(`Client Environment Prefix: ${detected.envPrefix}`);
    log(`Install command: ${effectiveInstallCmd || '(none)'}`);
    log(`Build command: ${effectiveBuildCmd || '(none)'}`);
    log(`Output directory: ${effectiveOutDir}`);
    await flushLogsToDb('building');

    // If there is no build command and no index.html, we cannot build
    if (!effectiveBuildCmd && !hasPackageJson) {
        throw new Error('No index.html found and no package.json detected to run a build.');
    }

    // Set up isolated sandbox build workspace in OS temp directory
    // (Outside of Fluxbase workspace to avoid parent package.json/React 18 module resolution collisions)
    const buildDir = path.join(os.tmpdir(), 'fluxbase-builds', deployId);
    await fs.mkdir(buildDir, { recursive: true });

    // Clean execution environment: strip turbopack and Next.js dev server variables
    // For dependency installation, set NODE_ENV to development so npm installs all devDependencies (TypeScript, Tailwind, etc.)
    // Set up a persistent npm cache directory so repeated builds benefit from cached packages
    const npmCacheDir = path.join(os.tmpdir(), 'fluxbase-npm-cache');
    await fs.mkdir(npmCacheDir, { recursive: true }).catch(() => {});

    const installEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'development',
        CI: 'true',
        NEXT_TELEMETRY_DISABLED: '1',
        // Prevent OOM on large builds (Next.js, heavy Tailwind projects, etc.)
        NODE_OPTIONS: '--max-old-space-size=4096',
        // Use persistent npm cache for faster re-installs
        npm_config_cache: npmCacheDir,
        // Suppress npm update notifier noise in build logs
        NO_UPDATE_NOTIFIER: '1'
    };
    // Sanitize host internal platform infrastructure variables so client build scripts don't accidentally connect
    delete installEnv.AWS_RDS_POSTGRES_URL;
    delete installEnv.DATABASE_URL;
    delete installEnv.POSTGRES_URL;
    delete installEnv.REDIS_URL;
    delete installEnv.REDIS_HOST;
    delete installEnv.SMS_WEBHOOK_SECRET;
    delete installEnv.PAYMENT_WEBHOOK_SECRET;
    delete installEnv.npm_config_production;
    delete installEnv.TURBOPACK;
    delete installEnv.__NEXT_TURBOPACK;
    delete installEnv.NEXT_TURBOPACK;
    delete installEnv.NEXT_RUNTIME;
    delete installEnv.__NEXT_PROCESSED_ENV;
    delete installEnv.__NEXT_PRIVATE_PREBUNDLED_REACT;
    delete installEnv.__NEXT_STRICT_NEXT_HEAD;

    // Decrypt and defensively validate all environment variables (especially URLs)
    const { decryptEnvValue } = await import('@/lib/hosting-env');
    const sanitizedEnvVars: Record<string, string> = {};
    const fallbackHost = subdomain ? `${subdomain}.fluxbasedb.me` : 'fluxbasedb.me';

    for (const [key, rawVal] of Object.entries(envVars)) {
        if (rawVal === undefined || rawVal === null) continue;
        let val = typeof rawVal === 'string' ? decryptEnvValue(rawVal) : String(rawVal);

        // Defensively sanitize any URL-like variables
        const isUrlVar = /(_URL|_ORIGIN|_DOMAIN|_HOST)$/i.test(key) || key === 'APP_URL' || key === 'NEXTAUTH_URL';
        if (isUrlVar && val) {
            let candidate = val.trim();
            if (!candidate.includes('://')) {
                candidate = `https://${candidate}`;
            }
            try {
                new URL(candidate);
                val = candidate;
            } catch {
                log(`[Env Sanitizer] Detected invalid URL in ${key} ("${val}"). Normalizing to safe fallback URL.`);
                val = `https://${fallbackHost}`;
            }
        }
        sanitizedEnvVars[key] = val;
    }

    // Guarantee that NEXT_PUBLIC_APP_URL is ALWAYS present and a valid URL
    if (!sanitizedEnvVars['NEXT_PUBLIC_APP_URL'] || !sanitizedEnvVars['NEXT_PUBLIC_APP_URL'].startsWith('http')) {
        sanitizedEnvVars['NEXT_PUBLIC_APP_URL'] = `https://${fallbackHost}`;
    }
    // Guarantee that NEXTAUTH_URL is also set
    if (!sanitizedEnvVars['NEXTAUTH_URL'] || !sanitizedEnvVars['NEXTAUTH_URL'].startsWith('http')) {
        sanitizedEnvVars['NEXTAUTH_URL'] = sanitizedEnvVars['NEXT_PUBLIC_APP_URL'];
    }

    // Apply sanitized environment variables to install and build process
    Object.assign(installEnv, sanitizedEnvVars);

    // Prepend sandbox node_modules/.bin to PATH so local framework binaries are prioritized
    const localBin = path.join(buildDir, 'node_modules', '.bin');
    const pathKey = Object.keys(installEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
    installEnv[pathKey] = `${localBin}${path.delimiter}${installEnv[pathKey] || ''}`;

    try {
        log(`Writing ${files.length} source files to build environment...`);
        for (const file of files) {
            const filePath = path.join(buildDir, file.path);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, file.buffer);
        }

        // Ensure tsconfig.json has baseUrl: "." and @/* path alias for proper module resolution
        const tsconfigPath = path.join(buildDir, 'tsconfig.json');
        if (existsSync(tsconfigPath)) {
            try {
                let tsconfigRaw = await fs.readFile(tsconfigPath, 'utf8');
                let patched = false;
                if (!tsconfigRaw.includes('"baseUrl"') && !tsconfigRaw.includes("'baseUrl'")) {
                    if (tsconfigRaw.includes('"compilerOptions"')) {
                        tsconfigRaw = tsconfigRaw.replace(
                            /("compilerOptions"\s*:\s*\{)/,
                            '$1\n    "baseUrl": ".",'
                        );
                        patched = true;
                    }
                }
                if (!tsconfigRaw.includes('"@/*"') && !tsconfigRaw.includes("'@/*'")) {
                    if (tsconfigRaw.includes('"paths"')) {
                        tsconfigRaw = tsconfigRaw.replace(
                            /("paths"\s*:\s*\{)/,
                            '$1\n      "@/*": ["./*", "./src/*"],'
                        );
                        patched = true;
                    } else if (tsconfigRaw.includes('"compilerOptions"')) {
                        tsconfigRaw = tsconfigRaw.replace(
                            /("compilerOptions"\s*:\s*\{)/,
                            '$1\n    "paths": { "@/*": ["./*", "./src/*"] },'
                        );
                        patched = true;
                    }
                }
                if (patched) {
                    await fs.writeFile(tsconfigPath, tsconfigRaw);
                    log('Configured baseUrl: "." and "@/*" path alias in tsconfig.json');
                }
            } catch (tsErr: any) {
                log(`Notice: Could not patch tsconfig.json: ${tsErr.message}`);
            }
        }

        // Ensure production environment variables file is written for all frameworks
        const envContent = Object.entries(sanitizedEnvVars)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
        if (envContent) {
            await fs.writeFile(path.join(buildDir, '.env.production'), envContent);
            await fs.writeFile(path.join(buildDir, '.env'), envContent);
        }

        // For Next.js projects: Ensure static optimizations and server detection
        if (detected.framework === 'next' || detected.framework === 'nextjs') {
            log('Configuring Next.js build optimizations...');

            // Detect whether this project uses server-side features that are incompatible with `output: 'export'`
            const hasApiRoutes = files.some(f =>
                f.path.includes('/api/') && (f.path.endsWith('/route.ts') || f.path.endsWith('/route.js'))
            );
            const hasMiddleware = files.some(f =>
                f.path === 'middleware.ts' || f.path === 'middleware.js' ||
                f.path === 'src/middleware.ts' || f.path === 'src/middleware.js'
            );
            const hasServerActions = files.some(f => {
                if (!f.path.endsWith('.ts') && !f.path.endsWith('.tsx') && !f.path.endsWith('.js') && !f.path.endsWith('.jsx')) return false;
                try {
                    const content = f.buffer.toString('utf8').slice(0, 500);
                    return content.includes("'use server'") || content.includes('"use server"');
                } catch { return false; }
            });
            // Check if config already has output set to something (e.g. 'standalone')
            let existingConfigHasOutput = false;
            for (const cfg of ['next.config.ts', 'next.config.mjs', 'next.config.js']) {
                const cfgPath = path.join(buildDir, cfg);
                if (existsSync(cfgPath)) {
                    try {
                        const c = await fs.readFile(cfgPath, 'utf8');
                        if (c.includes("output:") || c.includes("output :")) {
                            existingConfigHasOutput = true;
                        }
                    } catch {}
                    break;
                }
            }

            const canUseStaticExport = !hasApiRoutes && !hasMiddleware && !hasServerActions && !existingConfigHasOutput;

            if (canUseStaticExport) {
                log('Project is compatible with static export (no API routes, middleware, or server actions detected).');
            } else {
                const reasons: string[] = [];
                if (hasApiRoutes) reasons.push('API routes');
                if (hasMiddleware) reasons.push('middleware');
                if (hasServerActions) reasons.push('server actions');
                if (existingConfigHasOutput) reasons.push('existing output config');
                log(`Server-side features detected (${reasons.join(', ')}). Using standard build with .next harvesting.`);
            }

            // Build enhancements: output:'export' for purely static, output:'standalone' for full-stack
            const targetOutput = canUseStaticExport ? 'export' : 'standalone';
            const buildEnhancements = `\n  output: '${targetOutput}',\n  images: { unoptimized: true },\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },`;

            const nextConfigs = ['next.config.ts', 'next.config.mjs', 'next.config.js'];
            let foundConfig = false;
            for (const cfg of nextConfigs) {
                const cfgPath = path.join(buildDir, cfg);
                if (existsSync(cfgPath)) {
                    foundConfig = true;
                    try {
                        let content = await fs.readFile(cfgPath, 'utf8');
                        const needsImageOpt = !content.includes('unoptimized: true') && !content.includes('unoptimized:true');
                        const hasOutput = content.includes("output:") || content.includes("output :");
                        const needsOutput = !hasOutput;

                        const enhancements = needsOutput && needsImageOpt ? buildEnhancements
                            : needsOutput ? `\n  output: '${targetOutput}',`
                            : needsImageOpt ? `\n  images: { unoptimized: true },\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },`
                            : null;

                        if (enhancements) {
                            // Match common config patterns including defineConfig, satisfies, etc.
                            const configPatterns = [
                                'nextConfig = {',
                                'const nextConfig: NextConfig = {',
                                'module.exports = {',
                                'export default {',
                                'defineConfig({'
                            ];
                            let injected = false;
                            for (const pattern of configPatterns) {
                                if (content.includes(pattern)) {
                                    content = content.replace(pattern, `${pattern}${enhancements}`);
                                    injected = true;
                                    break;
                                }
                            }
                            if (injected) {
                                await fs.writeFile(cfgPath, content);
                                log(`Injected build optimizations into ${cfg}${needsOutput ? ` (+ output: ${targetOutput})` : ''}`);
                            }
                        }
                    } catch (err: any) {
                        log(`Warning: Failed to update ${cfg}: ${err.message}`);
                    }
                    break;
                }
            }

            if (!foundConfig) {
                const minimalConfig = `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  output: '${targetOutput}',\n  images: { unoptimized: true },\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true }\n};\nexport default nextConfig;\n`;
                await fs.writeFile(path.join(buildDir, 'next.config.mjs'), minimalConfig);
                log(`Created default next.config.mjs with output: ${targetOutput} + build optimizations`);
            }
        }

        // Vercel-Style Persistent Dependency Cache (node_modules) & Build Cache (.next/cache)
        const siteCacheDir = path.join(os.tmpdir(), 'fluxbase-site-cache', params.siteId || 'default');
        const cachedNodeModules = path.join(siteCacheDir, 'node_modules');
        const cachedNextCache = path.join(siteCacheDir, '.next-cache');
        const hashFilePath = path.join(siteCacheDir, 'deps-fingerprint.txt');
        await fs.mkdir(siteCacheDir, { recursive: true }).catch(() => {});

        // Compute fingerprint of lockfiles & package.json
        const lockFiles = files.filter(f => 
            f.path === 'package.json' || 
            f.path === 'package-lock.json' || 
            f.path === 'yarn.lock' || 
            f.path === 'pnpm-lock.yaml' || 
            f.path === 'bun.lockb'
        );
        let currentHash = '';
        if (lockFiles.length > 0) {
            const h = crypto.createHash('sha256');
            for (const lf of lockFiles.sort((a, b) => a.path.localeCompare(b.path))) {
                h.update(lf.path).update(lf.buffer);
            }
            currentHash = h.digest('hex');
        }

        let prevHash = '';
        if (existsSync(hashFilePath)) {
            try {
                prevHash = (await fs.readFile(hashFilePath, 'utf8')).trim();
            } catch {}
        }

        // Link persistent node_modules cache into sandbox build workspace
        const destNodeModules = path.join(buildDir, 'node_modules');
        let hasWarmNodeModules = false;
        try {
            await fs.mkdir(cachedNodeModules, { recursive: true });
            const cachedBin = path.join(cachedNodeModules, '.bin');
            if (existsSync(cachedBin)) {
                if (!existsSync(destNodeModules)) {
                    await fs.symlink(cachedNodeModules, destNodeModules, 'junction');
                    hasWarmNodeModules = true;
                } else {
                    hasWarmNodeModules = true;
                }
            } else {
                // Incomplete cache: clear it so clean install recreates binaries
                await fs.rm(cachedNodeModules, { recursive: true, force: true }).catch(() => {});
                await fs.mkdir(cachedNodeModules, { recursive: true }).catch(() => {});
            }
        } catch (symErr) {
            logger.warn('Failed to link cached node_modules:', symErr);
        }

        const isDepsCacheHit = !!(currentHash && prevHash && currentHash === prevHash && hasWarmNodeModules);

        // Execute install command with full devDependencies available
        if (isDepsCacheHit) {
            log('[Cache Hit] Dependencies are unchanged from previous deployment. Skipping package install (0.02s).');
            await flushLogsToDb('building');
        } else if (effectiveInstallCmd) {
            // Ensure all npm installations use legacy-peer-deps and devDependencies to avoid peer dependency conflicts
            if (effectiveInstallCmd.startsWith('npm install') || effectiveInstallCmd.startsWith('npm ci')) {
                effectiveInstallCmd = 'npm install --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline';
            }
            log(`Running install: ${effectiveInstallCmd}`);
            await flushLogsToDb('building');
            try {
                // Generous 10-minute timeout for large dependency trees
                await runStreamingCommand(effectiveInstallCmd, {
                    cwd: buildDir,
                    env: installEnv,
                    timeoutMs: 600000,
                    onLog: logStream,
                    deployId
                });
                log('Dependencies resolved successfully.');
                if (currentHash) {
                    await fs.writeFile(hashFilePath, currentHash).catch(() => {});
                }
                await flushLogsToDb();
            } catch (instErr: any) {
                if (activeBuildJobs.get(deployId)?.isCanceled) {
                    throw new Error('Deployment canceled by user');
                }
                log(`Install notice: ${instErr.message}`);
                // Resilient fallback retry: clean node_modules and retry with extended 15-minute timeout
                const isTimeout = instErr.message?.includes('timed out');
                const retryCmd = 'npm install --legacy-peer-deps --include=dev --no-audit --no-fund --prefer-offline';
                log(`Retrying with clean install: ${retryCmd}${isTimeout ? ' (extended timeout: 15 min)' : ''}...`);
                await flushLogsToDb('building');
                try {
                    // Windows-safe directory cleanup: wait for OS file handles to release, then move/remove
                    const nodeModulesPath = path.join(buildDir, 'node_modules');
                    if (existsSync(nodeModulesPath)) {
                        await new Promise(r => setTimeout(r, 1500));
                        const stalePath = path.join(buildDir, `node_modules_stale_${Date.now()}`);
                        try {
                            await fs.rename(nodeModulesPath, stalePath);
                            fs.rm(stalePath, { recursive: true, force: true }).catch(() => {});
                        } catch {
                            await fs.rm(nodeModulesPath, { recursive: true, force: true }).catch(() => {});
                        }
                    }
                    await runStreamingCommand(retryCmd, {
                        cwd: buildDir,
                        env: installEnv,
                        timeoutMs: 900000,
                        onLog: logStream,
                        deployId
                    });
                    log('Dependencies resolved with fallback install.');
                    if (currentHash) {
                        await fs.writeFile(hashFilePath, currentHash).catch(() => {});
                    }
                    await flushLogsToDb();
                } catch (fallbackErr: any) {
                    throw new Error(`Failed to install dependencies: ${fallbackErr.message}`);
                }
            }
        }

        if (activeBuildJobs.get(deployId)?.isCanceled) {
            throw new Error('Deployment canceled by user');
        }

        // Ensure .bin directory exists; if missing, run npm rebuild to regenerate binaries
        const localBinDir = path.join(buildDir, 'node_modules', '.bin');
        if (!existsSync(localBinDir) && existsSync(path.join(buildDir, 'node_modules'))) {
            log('[Build Setup] Generating missing CLI binaries via npm rebuild...');
            await runStreamingCommand('npm rebuild', {
                cwd: buildDir,
                env: installEnv,
                timeoutMs: 120000,
                onLog: logStream,
                deployId
            }).catch(() => {});
        }

        // Link persistent Next.js build cache (.next/cache) for instant incremental rebuilds
        if (detected.framework === 'next' || detected.framework === 'nextjs') {
            const buildNextCache = path.join(buildDir, '.next', 'cache');
            try {
                await fs.mkdir(cachedNextCache, { recursive: true });
                await fs.mkdir(path.dirname(buildNextCache), { recursive: true });
                if (!existsSync(buildNextCache)) {
                    await fs.symlink(cachedNextCache, buildNextCache, 'junction');
                    log('[Next.js Cache] Restored incremental build cache (.next/cache).');
                }
            } catch (cErr: any) {
                logger.warn('Failed to link Next.js build cache:', cErr);
            }
        }

        // Execute build command with NODE_ENV=production
        if (effectiveBuildCmd) {
            const buildEnv: NodeJS.ProcessEnv = {
                ...installEnv,
                NODE_ENV: 'production'
            };
            log(`Running build: ${effectiveBuildCmd}`);
            await flushLogsToDb('building');
            try {
                await runStreamingCommand(effectiveBuildCmd, {
                    cwd: buildDir,
                    env: buildEnv,
                    timeoutMs: 600000, // 10 mins - complex framework builds (Next.js with many pages, heavy Tailwind) need this
                    onLog: logStream,
                    deployId
                });
                log('Build process completed successfully.');
                await flushLogsToDb();
            } catch (buildErr: any) {
                if (activeBuildJobs.get(deployId)?.isCanceled) {
                    throw new Error('Deployment canceled by user');
                }

                // Check if binary was missing or not recognized in PATH
                const isBinaryMissing = buildErr.message?.includes('not recognized') || 
                    buildErr.message?.includes('not found') || 
                    logs.some(l => l.includes('not recognized') || l.includes('command not found'));

                if (isBinaryMissing && (detected.framework === 'next' || detected.framework === 'nextjs')) {
                    log('Notice: Framework binary not found in PATH. Retrying with direct npx next build...');
                    await flushLogsToDb('building');
                    await runStreamingCommand('npx next build', {
                        cwd: buildDir,
                        env: buildEnv,
                        timeoutMs: 600000,
                        onLog: logStream,
                        deployId
                    });
                    log('Build process completed successfully via npx fallback.');
                    await flushLogsToDb();
                } else {
                    // Check if build failed due to output: 'export' incompatibility (e.g. dynamic server usage, missing generateStaticParams)
                    const isExportIncompatible = logs.some(l =>
                        l.includes('output: "export"') ||
                        l.includes("output: 'export'") ||
                        l.includes('cannot be exported with "output: export"') ||
                        l.includes('missing "generateStaticParams()"') ||
                        l.includes('Dynamic server usage') ||
                        l.includes('getServerSideProps is not supported with output: export')
                    );

                if (isExportIncompatible && (detected.framework === 'next' || detected.framework === 'nextjs')) {
                    log('Notice: Static export failed due to dynamic Next.js features. Retrying without output: export (harvesting via .next/)...');
                    // Remove output: 'export' from any next.config
                    for (const cfg of ['next.config.ts', 'next.config.mjs', 'next.config.js']) {
                        const cfgPath = path.join(buildDir, cfg);
                        if (existsSync(cfgPath)) {
                            try {
                                let content = await fs.readFile(cfgPath, 'utf8');
                                content = content.replace(/output:\s*['"]export['"],?/g, '');
                                await fs.writeFile(cfgPath, content);
                                log(`Stripped output: 'export' from ${cfg} for fallback build`);
                            } catch {}
                            break;
                        }
                    }
                    await flushLogsToDb('building');
                    log(`Retrying build: ${effectiveBuildCmd}`);
                    await runStreamingCommand(effectiveBuildCmd, {
                        cwd: buildDir,
                        env: buildEnv,
                        timeoutMs: 600000,
                        onLog: logStream,
                        deployId
                    });
                    log('Build process completed successfully on fallback harvest mode.');
                    } else {
                        throw buildErr;
                    }
                }
            }
        }

        // Locate build output directory
        let searchDir = path.join(buildDir, effectiveOutDir);
        const builtFiles: ExtractedFile[] = [];

        async function walk(dir: string, baseDir: string, pathPrefix = '') {
            if (!existsSync(dir)) return;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(full, baseDir, pathPrefix);
                } else if (entry.isFile()) {
                    const rel = sanitizePath(path.relative(baseDir, full));
                    const finalPath = pathPrefix ? sanitizePath(`${pathPrefix}/${rel}`) : rel;
                    const buf = await fs.readFile(full);
                    builtFiles.push({
                        path: finalPath,
                        buffer: buf,
                        size: buf.length,
                        mimeType: detectMimeType(finalPath)
                    });
                }
            }
        }

        // Check for Build Output API v3 (.vercel/output)
        const v3OutputDir = path.join(buildDir, '.vercel', 'output');
        const v3ConfigPath = path.join(v3OutputDir, 'config.json');
        const v3StaticDir = path.join(v3OutputDir, 'static');

        if (existsSync(v3ConfigPath)) {
            log('[Build Output API v3] Detected .vercel/output/config.json');
            try {
                const v3Config = JSON.parse(await fs.readFile(v3ConfigPath, 'utf8'));
                if (v3Config.routes) {
                    userVercelConfig.routes = [...(userVercelConfig.routes || []), ...v3Config.routes];
                    compiledRoutes = compileSuperstaticRoutes(userVercelConfig, detectedRecord.framework.defaultRoutes || []);
                }
            } catch (v3Err: any) {
                log(`[Build Output API v3 Warning] Failed to parse config.json: ${v3Err.message}`);
            }
            if (existsSync(v3StaticDir)) {
                log('[Build Output API v3] Collecting static assets from .vercel/output/static/...');
                await walk(v3StaticDir, v3StaticDir);
            }
        } else if (existsSync(searchDir)) {
            // Mode A: Explicit output directory (e.g. out, dist, build)
            log(`Collecting generated assets from ${path.relative(buildDir, searchDir) || effectiveOutDir}...`);
            await walk(searchDir, searchDir);
        } else if ((detected.framework === 'nextjs' || detected.framework === 'next') && existsSync(path.join(buildDir, '.next'))) {
            // Mode B: Standard Next.js production build (.next directory generated)
            log('Harvesting Next.js production build artifacts from .next...');

            // 1. Static chunks and CSS -> mapped to _next/static/*
            const nextStaticDir = path.join(buildDir, '.next', 'static');
            if (existsSync(nextStaticDir)) {
                await walk(nextStaticDir, nextStaticDir, '_next/static');
                log(`Harvested static assets into _next/static/ (${builtFiles.length} files)`);
            }

            // 2. Pre-rendered HTML from App Router (.next/server/app)
            const appServerDir = path.join(buildDir, '.next', 'server', 'app');
            if (existsSync(appServerDir)) {
                async function harvestAppHtml(dir: string, routePrefix = '') {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            // Skip API routes, internal Next.js dirs, and route group markers
                            if (entry.name === 'api' || entry.name === '_not-found') continue;
                            // Handle route groups: (group) -> strip the parens from the path
                            const dirSegment = entry.name.startsWith('(') && entry.name.endsWith(')')
                                ? '' // Route groups don't add URL segments
                                : entry.name;
                            const nextPrefix = dirSegment
                                ? (routePrefix ? `${routePrefix}/${dirSegment}` : dirSegment)
                                : routePrefix;
                            await harvestAppHtml(full, nextPrefix);
                        } else if (entry.isFile() && entry.name.endsWith('.html')) {
                            const buf = await fs.readFile(full);
                            if (entry.name === '_not-found.html') {
                                builtFiles.push({
                                    path: '404.html',
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                            } else if ((entry.name === 'index.html' || entry.name === 'page.html') && !routePrefix) {
                                // Root page
                                builtFiles.push({
                                    path: 'index.html',
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                            } else if (entry.name === 'page.html' && routePrefix) {
                                // Nested route page -> /routePrefix/index.html
                                builtFiles.push({
                                    path: sanitizePath(`${routePrefix}/index.html`),
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                            } else {
                                const routeName = entry.name.replace(/\.html$/, '');
                                const fullRoute = routePrefix ? `${routePrefix}/${routeName}` : routeName;
                                // Create both /route.html and /route/index.html for clean URLs
                                builtFiles.push({
                                    path: `${fullRoute}.html`,
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                                builtFiles.push({
                                    path: sanitizePath(`${fullRoute}/index.html`),
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                            }
                        }
                    }
                }
                await harvestAppHtml(appServerDir);
            }

            // 3. Pre-rendered HTML from Pages Router (.next/server/pages)
            const pagesServerDir = path.join(buildDir, '.next', 'server', 'pages');
            if (existsSync(pagesServerDir)) {
                async function harvestPagesHtml(dir: string) {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (entry.name !== 'api') await harvestPagesHtml(full);
                        } else if (entry.isFile() && entry.name.endsWith('.html')) {
                            const buf = await fs.readFile(full);
                            const rel = sanitizePath(path.relative(pagesServerDir, full));
                            if (rel === '_not-found.html' || rel === '404.html') {
                                builtFiles.push({ path: '404.html', buffer: buf, size: buf.length, mimeType: 'text/html' });
                            } else {
                                builtFiles.push({ path: rel, buffer: buf, size: buf.length, mimeType: 'text/html' });
                            }
                        }
                    }
                }
                await harvestPagesHtml(pagesServerDir);
            }

            // 4. Public assets (public/* -> /*)
            const publicDir = path.join(buildDir, 'public');
            if (existsSync(publicDir)) {
                await walk(publicDir, publicDir);
            }

            // 5. Ensure root index.html exists
            const hasIndex = builtFiles.some(f => f.path === 'index.html');
            if (!hasIndex) {
                // Look for actual content pages before falling back to 404
                const contentCandidate = builtFiles.find(f => f.path === 'home.html' || f.path === 'dashboard.html' || f.path === 'projects.html') ||
                    builtFiles.find(f => f.path.endsWith('.html') && f.path !== '404.html' && f.path !== '500.html');
                if (contentCandidate) {
                    builtFiles.push({
                        path: 'index.html',
                        buffer: contentCandidate.buffer,
                        size: contentCandidate.size,
                        mimeType: 'text/html'
                    });
                    log(`Configured ${contentCandidate.path} as root index.html`);
                } else {
                    const fallback404 = builtFiles.find(f => f.path === '404.html');
                    if (fallback404) {
                        builtFiles.push({
                            path: 'index.html',
                            buffer: fallback404.buffer,
                            size: fallback404.size,
                            mimeType: 'text/html'
                        });
                        log('Configured fallback 404 as root index.html for SPA routing');
                    }
                }
            }
        } else {
            // Check fallback directories: out, dist, build, public
            const fallbacks = ['out', 'dist', 'build', 'public'];
            for (const fb of fallbacks) {
                const testPath = path.join(buildDir, fb);
                if (existsSync(testPath) && (existsSync(path.join(testPath, 'index.html')) || existsSync(path.join(testPath, '_next')))) {
                    searchDir = testPath;
                    log(`Build output detected in directory: ${fb}/`);
                    await walk(searchDir, searchDir);
                    break;
                }
            }
        }

        if (builtFiles.length === 0) {
            throw new Error(`Build output directory '${effectiveOutDir}' was not created and no compiled assets could be harvested from .next or fallback folders.`);
        }

        const hasIndex = builtFiles.some(f => f.path === 'index.html');
        if (!hasIndex) {
            log('Warning: No index.html found at root of build output. SPA routing may not function without an entrypoint.');
        }

        // Check for fullstack standalone Next.js server bundle or persistent Node.js service (Render-style)
        let isFullstack = false;
        let backendPort: number | undefined;
        let standaloneS3Key: string | undefined;
        let backendEntryScript: string | undefined;
        let backendWorkingDir: string | undefined;

        const standaloneDir = path.join(buildDir, '.next', 'standalone');
        const hasNextStandalone = existsSync(standaloneDir);
        const hasNodeEntry = existsSync(path.join(buildDir, 'server.js')) || 
            existsSync(path.join(buildDir, 'index.js')) || 
            existsSync(path.join(buildDir, 'app.js'));
        const isNodeBackend = hasNextStandalone || (hasPackageJson && hasNodeEntry && detected.framework !== 'static');

        if (isNodeBackend) {
            log('[Server Engine] Detected persistent server-based service (Render/Vercel architecture).');
            try {
                const siteId = params.siteId || 'default';
                const siteSubdomain = params.subdomain || siteId;
                const persistentBackendDir = path.join(process.cwd(), '.fluxbase-backends', siteId);
                await fs.rm(persistentBackendDir, { recursive: true, force: true }).catch(() => {});
                await fs.mkdir(persistentBackendDir, { recursive: true }).catch(() => {});

                if (hasNextStandalone) {
                    // Next.js standalone requirement: copy static and public assets into standalone dir
                    const staticSrc = path.join(buildDir, '.next', 'static');
                    const staticDest = path.join(standaloneDir, '.next', 'static');
                    if (existsSync(staticSrc)) {
                        await fs.cp(staticSrc, staticDest, { recursive: true }).catch(() => {});
                    }
                    const publicSrc = path.join(buildDir, 'public');
                    const publicDest = path.join(standaloneDir, 'public');
                    if (existsSync(publicSrc)) {
                        await fs.cp(publicSrc, publicDest, { recursive: true }).catch(() => {});
                    }
                    await fs.cp(standaloneDir, persistentBackendDir, { recursive: true });
                } else {
                    // Standard Node.js backend (Express, Fastify, NestJS, etc.)
                    await fs.cp(buildDir, persistentBackendDir, { recursive: true });
                }

                // Locate entry script in persistent directory
                const { locateBackendEntryScript } = await import('@/lib/hosting-runner');
                const entry = locateBackendEntryScript(persistentBackendDir);
                if (entry) {
                    backendEntryScript = entry;
                }
                backendWorkingDir = persistentBackendDir;

                // Step 4: Archive standalone bundle and upload to S3 for disaster recovery & multi-server support
                log('[Server Engine] Packaging standalone server bundle for cloud persistence...');
                try {
                    const { createStandaloneArchive } = await import('@/lib/hosting-archive');
                    const { uploadToS3 } = await import('@/lib/storage');
                    const archiveBuffer = await createStandaloneArchive(persistentBackendDir);
                    const s3Key = `hosting/deployments/${deployId}/standalone.tar.gz`;
                    await uploadToS3(s3Key, archiveBuffer, 'application/gzip');
                    standaloneS3Key = s3Key;
                    log(`[Server Engine] Standalone bundle archived & saved to S3 (${(archiveBuffer.length / 1024 / 1024).toFixed(1)} MB)`);

                    // Update deployment record immediately
                    await pool.query(
                        `UPDATE fluxbase_global.hosting_deployments 
                         SET standalone_s3_key = $1, is_fullstack = true 
                         WHERE deploy_id = $2`,
                        [s3Key, deployId]
                    );
                } catch (s3ArchiveErr: any) {
                    log(`[Server Engine Warning] Could not upload standalone archive to S3: ${s3ArchiveErr?.message}`);
                }

                const { startBackendProcess } = await import('@/lib/hosting-runner');
                log('[Server Engine] Spawning persistent background service with auto-recovery...');
                const runnerRes = await startBackendProcess({
                    siteId,
                    deployId,
                    subdomain: siteSubdomain,
                    standaloneDir: persistentBackendDir,
                    entryScript: backendEntryScript,
                    envVars,
                    logStream: log
                });
                if (runnerRes.success) {
                    isFullstack = true;
                    backendPort = runnerRes.port;
                    log(`[Server Engine] Persistent service is LIVE on port ${runnerRes.port}!`);
                } else {
                    log(`[Server Engine Notice] Service launcher: ${runnerRes.error}`);
                }
            } catch (runnerErr: any) {
                log(`[Server Engine Warning] Could not spawn persistent service: ${runnerErr?.message}`);
            }
        }

        log(`Build complete: ${builtFiles.length} files generated.`);
        await flushLogsToDb();

        return {
            files: builtFiles,
            buildLogs: logs.join('\n'),
            framework: detected.framework,
            routingManifest: compiledRoutes,
            routingConfig: userVercelConfig,
            isFullstack,
            backendPort,
            standaloneS3Key,
            backendEntryScript,
            backendWorkingDir
        };

    } catch (err: any) {
        const isCanceled = activeBuildJobs.get(deployId)?.isCanceled || 
            err?.message?.includes('canceled by user') ||
            err?.message?.includes('Deployment was canceled');
        if (isCanceled) {
            log('[System] Deployment was canceled by user.');
            await flushLogsToDb('canceled');
            const cancelErr = new Error('Deployment canceled by user');
            (cancelErr as any).buildLogs = logs.join('\n');
            throw cancelErr;
        }

        let errorSummary = err?.message || 'Build compilation failed';
        if (errorSummary.includes('Command failed with exit code') || errorSummary.includes('Command failed:')) {
            const descriptiveLine = [...logs].reverse().find(l => 
                (l.includes('Error:') || l.includes('Failed to') || l.includes('Module not found:') || l.includes('Cannot find module') || l.includes('turbopack')) &&
                !l.includes('Starting deployment') &&
                !l.includes('Writing')
            );
            if (descriptiveLine) {
                errorSummary = descriptiveLine.replace(/^\[[^\]]+\]\s*/, '').trim();
            }
        }

        // Detect output: 'export' incompatibility errors and provide a clear message
        const isExportError = errorSummary.includes('output: "export"') ||
            errorSummary.includes("output: 'export'") ||
            errorSummary.includes('getServerSideProps') ||
            errorSummary.includes('API routes are not supported') ||
            errorSummary.includes('Dynamic server usage') ||
            logs.some(l => l.includes('output: "export"') || l.includes('getServerSideProps is not supported with output'));

        if (isExportError && (detected.framework === 'next' || detected.framework === 'nextjs')) {
            errorSummary = `This Next.js project uses server-side features incompatible with static export. ${errorSummary}`;
        }

        log(`BUILD FAILED: ${errorSummary}`);
        await flushLogsToDb('failed');
        const customErr = new Error(errorSummary);
        (customErr as any).buildLogs = logs.join('\n');
        throw customErr;
    } finally {
        activeBuildJobs.delete(deployId);
        if (flushTimeout) clearTimeout(flushTimeout);
        // Safely unlink junctions before removing build directory so cache is preserved
        try {
            const destNodeModules = path.join(buildDir, 'node_modules');
            const lstat = await fs.lstat(destNodeModules).catch(() => null);
            if (lstat && (lstat.isSymbolicLink() || (process.platform === 'win32' && (lstat as any).isSymbolicLink()))) {
                await fs.unlink(destNodeModules).catch(() => {});
            }
            const destNextCache = path.join(buildDir, '.next', 'cache');
            const nextStat = await fs.lstat(destNextCache).catch(() => null);
            if (nextStat && (nextStat.isSymbolicLink() || (process.platform === 'win32' && (nextStat as any).isSymbolicLink()))) {
                await fs.unlink(destNextCache).catch(() => {});
            }
        } catch {}
        // Clean up scratch build directory
        try {
            await fs.rm(buildDir, { recursive: true, force: true });
        } catch {}
    }
}
