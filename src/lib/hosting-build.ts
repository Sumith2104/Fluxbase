import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { ExtractedFile, detectMimeType, sanitizePath } from '@/lib/hosting-engine';
import logger from '@/lib/logger';
import { getPgPool } from '@/lib/pg';

export interface DetectedFramework {
    name: string;
    framework: string;
    buildCommand: string;
    outputDirectory: string;
    installCommand: string;
}

export function detectFramework(files: ExtractedFile[]): DetectedFramework {
    const pkgFile = files.find(f => f.path === 'package.json' || f.path.endsWith('/package.json'));
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

        const hasLockfile = files.some(f => f.path === 'package-lock.json' || f.path.endsWith('/package-lock.json'));
        const hasYarnLock = files.some(f => f.path === 'yarn.lock' || f.path.endsWith('/yarn.lock'));
        const hasPnpmLock = files.some(f => f.path === 'pnpm-lock.yaml' || f.path.endsWith('/pnpm-lock.yaml'));

        let defaultInstall = 'npm install --legacy-peer-deps';
        if (hasLockfile) {
            defaultInstall = 'npm ci --include=dev';
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
    // 1. Direct index.html at root
    const rootIndex = files.find(f => f.path === 'index.html');
    if (rootIndex && (!targetOutputDir || targetOutputDir === '.' || targetOutputDir === '/')) {
        return files;
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

interface RunCommandOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onLog: (line: string) => void;
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

        const child = spawn(command, {
            shell: true,
            cwd: options.cwd,
            env: options.env,
            windowsHide: true,
        });

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
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
    files: ExtractedFile[];
    buildCommand?: string;
    outputDirectory?: string;
    installCommand?: string;
    envVars?: Record<string, string>;
    onLogUpdate?: (fullLogs: string, status?: string) => Promise<void> | void;
}): Promise<{ files: ExtractedFile[]; buildLogs: string; framework: string }> {
    const {
        deployId,
        files,
        buildCommand,
        outputDirectory,
        installCommand,
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

    log(`Starting deployment compilation for ${deployId}`);

    // Check if pre-built assets already exist in the archive
    const existingBuilt = findBuiltAssets(files, outputDirectory);
    const hasPackageJson = files.some(f => f.path === 'package.json' || f.path.endsWith('/package.json'));

    // If already pre-built and has index.html, skip build step!
    if (existingBuilt && existingBuilt.some(f => f.path === 'index.html')) {
        log(`Detected pre-built static bundle (${existingBuilt.length} assets ready for deployment).`);
        log(`Found root index.html. Skipping build step.`);
        await flushLogsToDb('building');
        return {
            files: existingBuilt,
            buildLogs: logs.join('\n'),
            framework: 'static'
        };
    }

    const detected = detectFramework(files);
    let effectiveBuildCmd = buildCommand !== undefined && buildCommand !== '' ? buildCommand : detected.buildCommand;
    let effectiveInstallCmd = installCommand !== undefined && installCommand !== '' ? installCommand : detected.installCommand;
    let effectiveOutDir = outputDirectory !== undefined && outputDirectory !== '' ? outputDirectory : detected.outputDirectory;

    // Next.js specific normalization
    if (detected.framework === 'next') {
        if (!effectiveOutDir || effectiveOutDir === 'dist') {
            effectiveOutDir = 'out';
        }
        if (!effectiveBuildCmd) {
            effectiveBuildCmd = 'npm run build';
        }
        // If the install command was defaulted to 'npm install --legacy-peer-deps' but package-lock exists, upgrade to npm ci
        const hasLockfile = files.some(f => f.path === 'package-lock.json' || f.path.endsWith('/package-lock.json'));
        if (hasLockfile && (!effectiveInstallCmd || effectiveInstallCmd.includes('--legacy-peer-deps') || effectiveInstallCmd === 'npm ci')) {
            effectiveInstallCmd = 'npm ci --include=dev';
        }
    }

    log(`Framework auto-detection: ${detected.name}`);
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
    const installEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...envVars,
        NODE_ENV: 'development',
        CI: 'true',
        NEXT_TELEMETRY_DISABLED: '1'
    };
    delete installEnv.TURBOPACK;
    delete installEnv.__NEXT_TURBOPACK;
    delete installEnv.NEXT_TURBOPACK;
    delete installEnv.NEXT_RUNTIME;
    delete installEnv.__NEXT_PROCESSED_ENV;
    delete installEnv.__NEXT_PRIVATE_PREBUNDLED_REACT;
    delete installEnv.__NEXT_STRICT_NEXT_HEAD;

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

        // Ensure tsconfig.json has baseUrl: "." for proper @/* alias resolution across nested route groups
        const tsconfigPath = path.join(buildDir, 'tsconfig.json');
        if (existsSync(tsconfigPath)) {
            try {
                let tsconfigRaw = await fs.readFile(tsconfigPath, 'utf8');
                if (!tsconfigRaw.includes('"baseUrl"') && !tsconfigRaw.includes("'baseUrl'")) {
                    if (tsconfigRaw.includes('"compilerOptions"')) {
                        tsconfigRaw = tsconfigRaw.replace(
                            /("compilerOptions"\s*:\s*\{)/,
                            '$1\n    "baseUrl": ".",'
                        );
                        await fs.writeFile(tsconfigPath, tsconfigRaw);
                        log('Configured baseUrl: "." in tsconfig.json for module alias resolution');
                    }
                }
            } catch (tsErr: any) {
                log(`Notice: Could not patch tsconfig.json: ${tsErr.message}`);
            }
        }

        // For Next.js projects: Ensure static optimizations and production env
        if (detected.framework === 'next') {
            log('Configuring Next.js build optimizations...');
            const envContent = Object.entries(envVars)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n');
            if (envContent) {
                await fs.writeFile(path.join(buildDir, '.env.production'), envContent);
            }

            const buildEnhancements = `
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },`;

            const nextConfigs = ['next.config.ts', 'next.config.mjs', 'next.config.js'];
            let foundConfig = false;
            for (const cfg of nextConfigs) {
                const cfgPath = path.join(buildDir, cfg);
                if (existsSync(cfgPath)) {
                    foundConfig = true;
                    try {
                        let content = await fs.readFile(cfgPath, 'utf8');
                        if (!content.includes('unoptimized: true') && !content.includes('unoptimized:true')) {
                            if (content.includes('nextConfig = {')) {
                                content = content.replace('nextConfig = {', `nextConfig = {${buildEnhancements}`);
                                await fs.writeFile(cfgPath, content);
                                log(`Injected build optimizations into ${cfg}`);
                            } else if (content.includes('const nextConfig: NextConfig = {')) {
                                content = content.replace('const nextConfig: NextConfig = {', `const nextConfig: NextConfig = {${buildEnhancements}`);
                                await fs.writeFile(cfgPath, content);
                                log(`Injected build optimizations into ${cfg}`);
                            } else if (content.includes('module.exports = {')) {
                                content = content.replace('module.exports = {', `module.exports = {${buildEnhancements}`);
                                await fs.writeFile(cfgPath, content);
                                log(`Injected build optimizations into ${cfg}`);
                            }
                        }
                    } catch (err: any) {
                        log(`Warning: Failed to update ${cfg}: ${err.message}`);
                    }
                    break;
                }
            }

            if (!foundConfig) {
                const minimalConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true }
};
export default nextConfig;
`;
                await fs.writeFile(path.join(buildDir, 'next.config.mjs'), minimalConfig);
                log('Created default next.config.mjs with build optimizations');
            }
        }

        // Execute install command with full devDependencies available
        if (effectiveInstallCmd) {
            log(`Running install: ${effectiveInstallCmd}`);
            await flushLogsToDb('building');
            try {
                await runStreamingCommand(effectiveInstallCmd, {
                    cwd: buildDir,
                    env: installEnv,
                    timeoutMs: 240000, // 4 mins
                    onLog: logStream
                });
                log('Dependencies resolved successfully.');
                await flushLogsToDb();
            } catch (instErr: any) {
                log(`Install notice: ${instErr.message}`);
                if (effectiveInstallCmd.includes('npm ci')) {
                    log('Falling back to npm install --legacy-peer-deps --include=dev...');
                    try {
                        await runStreamingCommand('npm install --legacy-peer-deps --include=dev', {
                            cwd: buildDir,
                            env: installEnv,
                            timeoutMs: 240000,
                            onLog: logStream
                        });
                        log('Dependencies resolved with fallback install.');
                        await flushLogsToDb();
                    } catch (fallbackErr: any) {
                        log(`Fallback install notice: ${fallbackErr.message}`);
                    }
                }
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
            await runStreamingCommand(effectiveBuildCmd, {
                cwd: buildDir,
                env: buildEnv,
                timeoutMs: 300000, // 5 mins
                onLog: logStream
            });
            log('Build process completed successfully.');
            await flushLogsToDb();
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

        if (existsSync(searchDir)) {
            // Mode A: Explicit output directory (e.g. out, dist, build)
            log(`Collecting generated assets from ${path.relative(buildDir, searchDir) || effectiveOutDir}...`);
            await walk(searchDir, searchDir);
        } else if (detected.framework === 'next' && existsSync(path.join(buildDir, '.next'))) {
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
                async function harvestAppHtml(dir: string) {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            if (entry.name !== 'api') {
                                await harvestAppHtml(full);
                            }
                        } else if (entry.isFile() && entry.name.endsWith('.html')) {
                            const buf = await fs.readFile(full);
                            if (entry.name === '_not-found.html') {
                                builtFiles.push({
                                    path: '404.html',
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                            } else if (entry.name === 'index.html' && dir === appServerDir) {
                                builtFiles.push({
                                    path: 'index.html',
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                            } else {
                                const routeName = entry.name.replace(/\.html$/, '');
                                builtFiles.push({
                                    path: entry.name,
                                    buffer: buf,
                                    size: buf.length,
                                    mimeType: 'text/html'
                                });
                                builtFiles.push({
                                    path: sanitizePath(`${routeName}/index.html`),
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

        log(`Build complete: ${builtFiles.length} files generated.`);
        await flushLogsToDb();

        return {
            files: builtFiles,
            buildLogs: logs.join('\n'),
            framework: detected.framework
        };

    } catch (err: any) {
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
        log(`BUILD FAILED: ${errorSummary}`);
        await flushLogsToDb('failed');
        const customErr = new Error(errorSummary);
        (customErr as any).buildLogs = logs.join('\n');
        throw customErr;
    } finally {
        if (flushTimeout) clearTimeout(flushTimeout);
        // Clean up scratch build directory
        try {
            await fs.rm(buildDir, { recursive: true, force: true });
        } catch {}
    }
}
