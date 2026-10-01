/**
 * Zero-Config Framework Detection Engine
 * Based on @vercel/frameworks and @vercel/fs-detectors
 * Provides 1:1 parity with Vercel's framework presets, detectors, and settings.
 */

export interface FrameworkDetectionItem {
    matchPackage?: string;
    path?: string;
    matchContent?: string;
}

export interface FrameworkDetectors {
    every?: FrameworkDetectionItem[];
    some?: FrameworkDetectionItem[];
}

export interface FrameworkSetting<T = string | null> {
    value?: T;
    placeholder?: string;
}

export interface FrameworkSettings {
    installCommand?: FrameworkSetting;
    buildCommand?: FrameworkSetting;
    devCommand?: FrameworkSetting;
    outputDirectory?: FrameworkSetting;
}

export interface FrameworkRoute {
    src: string;
    dest?: string;
    headers?: Record<string, string>;
    status?: number;
    continue?: boolean;
    check?: boolean;
    handle?: 'filesystem' | 'hit' | 'miss' | 'rewrite' | 'error';
}

export interface FrameworkDefinition {
    name: string;
    slug: string;
    tagline?: string;
    envPrefix: string;
    detectors: FrameworkDetectors;
    settings: FrameworkSettings;
    defaultRoutes?: FrameworkRoute[];
}

export interface DetectorFilesystem {
    hasPath: (path: string) => Promise<boolean>;
    isFile: (path: string) => Promise<boolean>;
    readFile: (path: string) => Promise<string>;
}

export interface DetectedFrameworkResult {
    framework: FrameworkDefinition;
    detectedVersion?: string;
    buildCommand: string;
    installCommand: string;
    outputDirectory: string;
    envPrefix: string;
}

/**
 * Standard Vercel Framework Presets
 * Order matters: specialized frameworks first, general fallback last.
 */
export const FRAMEWORK_PRESETS: FrameworkDefinition[] = [
    {
        name: 'Next.js',
        slug: 'nextjs',
        tagline: 'Next.js makes you productive with React instantly.',
        envPrefix: 'NEXT_PUBLIC_',
        detectors: {
            every: [{ matchPackage: 'next' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'next build',
                placeholder: '`npm run build` or `next build`'
            },
            devCommand: {
                value: 'next dev --port $PORT',
                placeholder: 'next dev'
            },
            outputDirectory: {
                value: 'out',
                placeholder: 'Next.js default (out / .next)'
            }
        },
        defaultRoutes: [
            {
                src: '^/_next/static/(?:.*)$',
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                continue: true
            }
        ]
    },
    {
        name: 'Vite',
        slug: 'vite',
        tagline: 'Vite is a new breed of frontend build tool.',
        envPrefix: 'VITE_',
        detectors: {
            every: [{ matchPackage: 'vite' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'vite build',
                placeholder: '`npm run build` or `vite build`'
            },
            devCommand: {
                value: 'vite --port $PORT',
                placeholder: 'vite'
            },
            outputDirectory: {
                value: 'dist',
                placeholder: 'dist'
            }
        },
        defaultRoutes: [
            {
                src: '^/assets/(?:.*)$',
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                continue: true
            }
        ]
    },
    {
        name: 'Astro',
        slug: 'astro',
        tagline: 'Astro is the web framework for content-driven websites.',
        envPrefix: 'PUBLIC_',
        detectors: {
            every: [{ matchPackage: 'astro' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'astro build',
                placeholder: '`npm run build` or `astro build`'
            },
            devCommand: {
                value: 'astro dev --port $PORT',
                placeholder: 'astro dev'
            },
            outputDirectory: {
                value: 'dist',
                placeholder: 'dist'
            }
        },
        defaultRoutes: [
            {
                src: '^/_astro/(?:.*)$',
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                continue: true
            }
        ]
    },
    {
        name: 'Remix',
        slug: 'remix',
        tagline: 'Remix is a full stack web framework.',
        envPrefix: 'REMIX_',
        detectors: {
            some: [
                { matchPackage: '@remix-run/dev' },
                { matchPackage: '@remix-run/react' }
            ]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'remix build',
                placeholder: '`npm run build` or `remix build`'
            },
            devCommand: {
                value: 'remix dev --port $PORT',
                placeholder: 'remix dev'
            },
            outputDirectory: {
                value: 'build/client',
                placeholder: 'public/build or build/client'
            }
        }
    },
    {
        name: 'SvelteKit',
        slug: 'sveltekit',
        tagline: 'SvelteKit is the fastest way to build Svelte apps.',
        envPrefix: 'PUBLIC_',
        detectors: {
            every: [{ matchPackage: '@sveltejs/kit' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'vite build',
                placeholder: '`npm run build` or `vite build`'
            },
            devCommand: {
                value: 'vite dev --port $PORT',
                placeholder: 'vite dev'
            },
            outputDirectory: {
                value: 'build',
                placeholder: 'build'
            }
        },
        defaultRoutes: [
            {
                src: '^/_app/(?:.*)$',
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                continue: true
            }
        ]
    },
    {
        name: 'Svelte',
        slug: 'svelte',
        tagline: 'Cybernetically enhanced web apps.',
        envPrefix: 'VITE_',
        detectors: {
            every: [{ matchPackage: 'svelte' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'vite build',
                placeholder: '`npm run build` or `vite build`'
            },
            devCommand: {
                value: 'vite --port $PORT',
                placeholder: 'vite'
            },
            outputDirectory: {
                value: 'dist',
                placeholder: 'dist or public'
            }
        }
    },
    {
        name: 'Nuxt.js',
        slug: 'nuxtjs',
        tagline: 'Nuxt is an open source framework that makes web development intuitive and powerful.',
        envPrefix: 'NUXT_PUBLIC_',
        detectors: {
            some: [
                { matchPackage: 'nuxt' },
                { matchPackage: 'nuxt-edge' },
                { matchPackage: 'nuxt3' }
            ]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'nuxt build',
                placeholder: '`npm run build` or `nuxt build`'
            },
            devCommand: {
                value: 'nuxt dev --port $PORT',
                placeholder: 'nuxt dev'
            },
            outputDirectory: {
                value: 'dist',
                placeholder: '.output/public or dist'
            }
        },
        defaultRoutes: [
            {
                src: '^/_nuxt/(?:.*)$',
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                continue: true
            }
        ]
    },
    {
        name: 'Create React App',
        slug: 'create-react-app',
        tagline: 'Set up a modern web app by running one command.',
        envPrefix: 'REACT_APP_',
        detectors: {
            every: [{ matchPackage: 'react-scripts' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'react-scripts build',
                placeholder: '`npm run build` or `react-scripts build`'
            },
            devCommand: {
                value: 'react-scripts start',
                placeholder: 'react-scripts start'
            },
            outputDirectory: {
                value: 'build',
                placeholder: 'build'
            }
        },
        defaultRoutes: [
            {
                src: '^/static/(?:.*)$',
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
                continue: true
            }
        ]
    },
    {
        name: 'Gatsby',
        slug: 'gatsby',
        tagline: 'Gatsby helps developers build blazing fast websites and apps.',
        envPrefix: 'GATSBY_',
        detectors: {
            every: [{ matchPackage: 'gatsby' }]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'gatsby build',
                placeholder: '`npm run build` or `gatsby build`'
            },
            devCommand: {
                value: 'gatsby develop --port $PORT',
                placeholder: 'gatsby develop'
            },
            outputDirectory: {
                value: 'public',
                placeholder: 'public'
            }
        }
    },
    {
        name: 'Vue.js',
        slug: 'vue',
        tagline: 'An accessible, performant and versatile web framework.',
        envPrefix: 'VUE_APP_',
        detectors: {
            some: [
                { matchPackage: '@vue/cli-service' },
                { matchPackage: 'vue' }
            ]
        },
        settings: {
            installCommand: {
                placeholder: '`yarn install`, `pnpm install`, `npm install`, or `bun install`'
            },
            buildCommand: {
                value: 'vue-cli-service build',
                placeholder: '`npm run build` or `vue-cli-service build`'
            },
            devCommand: {
                value: 'vue-cli-service serve --port $PORT',
                placeholder: 'vue-cli-service serve'
            },
            outputDirectory: {
                value: 'dist',
                placeholder: 'dist'
            }
        }
    },
    {
        name: 'Other (Static)',
        slug: 'static',
        tagline: 'Pure HTML, CSS and client-side JavaScript.',
        envPrefix: 'PUBLIC_',
        detectors: {
            some: [
                { path: 'index.html' },
                { path: 'public/index.html' }
            ]
        },
        settings: {
            installCommand: {
                value: null,
                placeholder: 'None'
            },
            buildCommand: {
                value: null,
                placeholder: 'None'
            },
            devCommand: {
                value: null,
                placeholder: 'None'
            },
            outputDirectory: {
                value: '.',
                placeholder: 'Current directory'
            }
        }
    }
];

/**
 * Creates an in-memory DetectorFilesystem from an array of files
 */
export function createMemoryDetectorFilesystem(files: Array<{ path: string; buffer?: Buffer; content?: string }>): DetectorFilesystem {
    const fileMap = new Map<string, string>();
    for (const f of files) {
        const norm = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
        fileMap.set(norm, f.content ?? (f.buffer ? f.buffer.toString('utf8') : ''));
    }

    return {
        async hasPath(testPath: string): Promise<boolean> {
            const clean = testPath.replace(/\\/g, '/').replace(/^\/+/, '');
            if (fileMap.has(clean)) return true;
            // Also check for directory prefix
            for (const key of fileMap.keys()) {
                if (key.startsWith(`${clean}/`)) return true;
            }
            return false;
        },
        async isFile(testPath: string): Promise<boolean> {
            const clean = testPath.replace(/\\/g, '/').replace(/^\/+/, '');
            return fileMap.has(clean);
        },
        async readFile(testPath: string): Promise<string> {
            const clean = testPath.replace(/\\/g, '/').replace(/^\/+/, '');
            const content = fileMap.get(clean);
            if (content === undefined) {
                throw new Error(`File not found: ${testPath}`);
            }
            return content;
        }
    };
}

/**
 * Detects the package manager and corresponding install command
 * Priority: bun -> pnpm -> yarn -> npm
 */
export async function detectPackageManager(fs: DetectorFilesystem, rootDir = '.'): Promise<{
    packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm';
    installCommand: string;
}> {
    const prefix = rootDir === '.' ? '' : `${rootDir}/`;

    if (await fs.hasPath(`${prefix}bun.lockb`) || await fs.hasPath(`${prefix}bun.lock`)) {
        return {
            packageManager: 'bun',
            installCommand: 'bun install --no-save'
        };
    }

    if (await fs.hasPath(`${prefix}pnpm-lock.yaml`)) {
        return {
            packageManager: 'pnpm',
            installCommand: 'pnpm install --frozen-lockfile'
        };
    }

    if (await fs.hasPath(`${prefix}yarn.lock`)) {
        return {
            packageManager: 'yarn',
            installCommand: 'yarn install --frozen-lockfile'
        };
    }

    // Default to npm
    return {
        packageManager: 'npm',
        installCommand: 'npm install --legacy-peer-deps --no-audit --no-fund --prefer-offline'
    };
}

/**
 * Evaluates detector conditions for a single framework
 * Follows Vercel's @vercel/fs-detectors exact regex logic
 */
async function matchesFramework(
    fs: DetectorFilesystem,
    framework: FrameworkDefinition,
    rootDir = '.'
): Promise<{ matches: boolean; detectedVersion?: string }> {
    const { detectors } = framework;
    const prefix = rootDir === '.' ? '' : `${rootDir}/`;

    const checkItem = async (item: FrameworkDetectionItem): Promise<{ match: boolean; version?: string }> => {
        let filePath = item.path || 'package.json';
        filePath = `${prefix}${filePath}`;

        let matchContent = item.matchContent;
        if (item.matchPackage) {
            matchContent = `"(dev)?(d|D)ependencies":\\s*{[^}]*"${item.matchPackage}":\\s*"(.+?)"[^}]*}`;
            filePath = `${prefix}package.json`;
        }

        if (!(await fs.hasPath(filePath))) {
            return { match: false };
        }

        if (matchContent) {
            if (!(await fs.isFile(filePath))) {
                return { match: false };
            }

            try {
                const content = await fs.readFile(filePath);
                const regex = new RegExp(matchContent, 'm');
                const matched = content.match(regex);
                if (!matched) {
                    return { match: false };
                }
                return { match: true, version: matched[3] };
            } catch {
                return { match: false };
            }
        }

        return { match: true };
    };

    if (detectors.every) {
        let detectedVersion: string | undefined;
        for (const item of detectors.every) {
            const res = await checkItem(item);
            if (!res.match) return { matches: false };
            if (res.version) detectedVersion = res.version;
        }
        return { matches: true, detectedVersion };
    }

    if (detectors.some) {
        for (const item of detectors.some) {
            const res = await checkItem(item);
            if (res.match) {
                return { matches: true, detectedVersion: res.version };
            }
        }
        return { matches: false };
    }

    return { matches: false };
}

/**
 * Detects framework and determines standard commands and settings
 * Matches Vercel's detectFrameworkRecord() and static-build script resolution
 */
export async function detectFrameworkRecord(
    fs: DetectorFilesystem,
    options: {
        rootDir?: string;
        customFrameworkSlug?: string;
        customBuildCommand?: string;
        customInstallCommand?: string;
        customOutputDirectory?: string;
    } = {}
): Promise<DetectedFrameworkResult> {
    const rootDir = options.rootDir || '.';
    const prefix = rootDir === '.' ? '' : `${rootDir}/`;

    // 1. Detect package manager
    const pm = await detectPackageManager(fs, rootDir);

    // 2. Read package.json if present
    let pkg: Record<string, any> | null = null;
    try {
        if (await fs.hasPath(`${prefix}package.json`)) {
            const raw = await fs.readFile(`${prefix}package.json`);
            pkg = JSON.parse(raw);
        }
    } catch {
        // Ignored, proceed without pkg
    }

    // 3. Find matching framework
    let matchedFramework: FrameworkDefinition | undefined;
    let detectedVersion: string | undefined;

    if (options.customFrameworkSlug) {
        matchedFramework = FRAMEWORK_PRESETS.find(f => f.slug === options.customFrameworkSlug);
    }

    if (!matchedFramework) {
        for (const fw of FRAMEWORK_PRESETS) {
            const res = await matchesFramework(fs, fw, rootDir);
            if (res.matches) {
                matchedFramework = fw;
                detectedVersion = res.detectedVersion;
                break;
            }
        }
    }

    // Fallback to static if no framework matched
    if (!matchedFramework) {
        matchedFramework = FRAMEWORK_PRESETS.find(f => f.slug === 'static')!;
    }

    // 4. Resolve Build Command
    // Priority:
    // a. Custom override provided by user/site setting
    // b. package.json scripts.vercel-build
    // c. package.json scripts.build
    // d. Framework default preset value
    let resolvedBuildCommand = '';
    if (options.customBuildCommand) {
        resolvedBuildCommand = options.customBuildCommand;
    } else if (pkg?.scripts?.['vercel-build']) {
        resolvedBuildCommand = `${pm.packageManager} run vercel-build`;
    } else if (pkg?.scripts?.build) {
        resolvedBuildCommand = `${pm.packageManager} run build`;
    } else if (matchedFramework.settings.buildCommand?.value) {
        resolvedBuildCommand = matchedFramework.settings.buildCommand.value;
    }

    // 5. Resolve Install Command
    let resolvedInstallCommand = '';
    if (options.customInstallCommand) {
        resolvedInstallCommand = options.customInstallCommand;
    } else if (pkg) {
        resolvedInstallCommand = pm.installCommand;
    }

    // 6. Resolve Output Directory
    let resolvedOutputDir = 'dist';
    if (options.customOutputDirectory) {
        resolvedOutputDir = options.customOutputDirectory;
    } else if (matchedFramework.settings.outputDirectory?.value) {
        resolvedOutputDir = matchedFramework.settings.outputDirectory.value;
    }

    return {
        framework: matchedFramework,
        detectedVersion,
        buildCommand: resolvedBuildCommand,
        installCommand: resolvedInstallCommand,
        outputDirectory: resolvedOutputDir,
        envPrefix: matchedFramework.envPrefix
    };
}
