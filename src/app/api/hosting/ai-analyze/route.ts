import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getGitHubToken } from '@/lib/github-token';
import { GitHubClient, fetchPublicRepoTree } from '@/lib/github-client';
import { ModelGateway } from '@/lib/agent-core/gateway';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface AnalyzedEnvVar {
    key: string;
    value?: string;
    description?: string;
    required?: boolean;
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        let { repoUrl, githubRepo, owner, repo, branch = 'main' } = body;

        // Parse owner and repo from URL if provided
        if (repoUrl) {
            const cleanUrl = repoUrl.trim().replace(/\.git$/, '');
            const match = cleanUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (match) {
                owner = match[1];
                repo = match[2];
            } else if (cleanUrl.includes('/') && !cleanUrl.includes(':')) {
                const parts = cleanUrl.split('/');
                owner = parts[0];
                repo = parts[1];
            }
        } else if (githubRepo) {
            const parts = githubRepo.split('/');
            owner = parts[0];
            repo = parts[1];
        }

        if (!owner || !repo) {
            return NextResponse.json({
                success: false,
                error: 'Please provide a valid GitHub repository (e.g. owner/repo or https://github.com/owner/repo)'
            }, { status: 400 });
        }

        // Get user GitHub token if connected
        let token: string | undefined;
        try {
            const userId = await getCurrentUserId();
            if (userId) {
                token = (await getGitHubToken(userId)) || undefined;
            }
        } catch (_) {}

        // Fetch repository tree
        let tree: any[] = [];
        let client: GitHubClient | null = null;
        if (token) {
            client = new GitHubClient(token);
            try {
                tree = await client.getRepoTree(owner, repo, branch);
            } catch (err: any) {
                logger.warn(`Failed to fetch tree with user token, trying public: ${err.message}`);
            }
        }

        if (tree.length === 0) {
            try {
                tree = await fetchPublicRepoTree(owner, repo, branch, token);
            } catch (err: any) {
                return NextResponse.json({
                    success: false,
                    error: `Unable to access repository ${owner}/${repo}: ${err.message}. If this is a private repo, make sure your GitHub account is connected.`
                }, { status: 400 });
            }
        }

        // 1. Structure Analysis
        const allPaths = tree.map((t: any) => t.path);
        const totalFiles = tree.filter((t: any) => t.type === 'blob').length;

        // Find primary root or frontend directories
        const rootFolders = Array.from(new Set(
            allPaths
                .filter(p => p.includes('/'))
                .map(p => p.split('/')[0])
        )).slice(0, 15);

        // Detect monorepo frontend path if root package.json is missing
        let rootDir = '.';
        let pkgPath = allPaths.find(p => p === 'package.json');
        if (!pkgPath) {
            pkgPath = allPaths.find(p => p === 'frontend/package.json' || p === 'client/package.json' || p === 'web/package.json' || p === 'app/package.json');
            if (pkgPath) {
                rootDir = pkgPath.replace('/package.json', '');
            }
        }

        // Fetch package.json content
        let packageJson: any = null;
        if (pkgPath) {
            try {
                const pkgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pkgPath}`;
                const headers: Record<string, string> = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                const res = await fetch(pkgUrl, { headers });
                if (res.ok) {
                    packageJson = await res.json();
                }
            } catch (err) {
                logger.warn('Failed to parse package.json:', err);
            }
        }

        // Fetch config files content if found
        const configFiles = allPaths.filter(p =>
            p.endsWith('vite.config.ts') || p.endsWith('vite.config.js') ||
            p.endsWith('next.config.ts') || p.endsWith('next.config.js') || p.endsWith('next.config.mjs') ||
            p.endsWith('astro.config.mjs') || p.endsWith('nuxt.config.ts') ||
            p.endsWith('svelte.config.js') || p.endsWith('tsconfig.json')
        ).slice(0, 3);

        const configsFound: Record<string, string> = {};
        for (const cfg of configFiles) {
            try {
                const cfgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cfg}`;
                const headers: Record<string, string> = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                const res = await fetch(cfgUrl, { headers });
                if (res.ok) {
                    const text = await res.text();
                    configsFound[cfg] = text.slice(0, 1500); // Truncate for token efficiency
                }
            } catch (_) {}
        }

        // Fetch .env.example or detect env vars in files
        const envExamplePath = allPaths.find(p => p.includes('.env.example') || p.includes('.env.sample') || p.includes('.env.template'));
        let envExampleContent = '';
        if (envExamplePath) {
            try {
                const envUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${envExamplePath}`;
                const headers: Record<string, string> = {};
                if (token) headers.Authorization = `Bearer ${token}`;
                const res = await fetch(envUrl, { headers });
                if (res.ok) {
                    envExampleContent = await res.text();
                }
            } catch (_) {}
        }

        // Heuristic detection baseline
        const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
        const scripts = packageJson?.scripts || {};
        const hasTypeScript = allPaths.some(p => p.endsWith('.ts') || p.endsWith('.tsx'));
        const hasTailwind = allPaths.some(p => p.includes('tailwind.config'));
        const hasYarn = allPaths.some(p => p === 'yarn.lock');
        const hasPnpm = allPaths.some(p => p === 'pnpm-lock.yaml');
        const hasBun = allPaths.some(p => p === 'bun.lockb');

        let detectedFramework = 'static';
        let detectedFrameworkName = 'Static HTML';
        let defaultBuild = '';
        let defaultOutDir = '.';
        let defaultInstall = 'npm install --legacy-peer-deps --no-audit --no-fund';

        if (hasPnpm) defaultInstall = 'pnpm install --frozen-lockfile';
        else if (hasYarn) defaultInstall = 'yarn install --frozen-lockfile';

        if (deps.next) {
            detectedFramework = 'next';
            detectedFrameworkName = 'Next.js';
            defaultBuild = scripts.build ? 'npm run build' : 'npx next build';
            defaultOutDir = 'out';
        } else if (deps.vite) {
            detectedFramework = 'vite';
            detectedFrameworkName = deps.react ? 'Vite + React' : deps.vue ? 'Vite + Vue' : deps.svelte ? 'Vite + Svelte' : 'Vite';
            defaultBuild = scripts.build ? 'npm run build' : 'npx vite build';
            defaultOutDir = 'dist';
        } else if (deps['react-scripts']) {
            detectedFramework = 'react';
            detectedFrameworkName = 'Create React App';
            defaultBuild = scripts.build ? 'npm run build' : 'npx react-scripts build';
            defaultOutDir = 'build';
        } else if (deps.vue || deps['@vue/cli-service']) {
            detectedFramework = 'vue';
            detectedFrameworkName = 'Vue.js';
            defaultBuild = scripts.build ? 'npm run build' : 'npx vue-cli-service build';
            defaultOutDir = 'dist';
        } else if (deps.astro) {
            detectedFramework = 'astro';
            detectedFrameworkName = 'Astro';
            defaultBuild = scripts.build ? 'npm run build' : 'npx astro build';
            defaultOutDir = 'dist';
        } else if (deps.svelte || deps['@sveltejs/kit']) {
            detectedFramework = 'svelte';
            detectedFrameworkName = 'SvelteKit';
            defaultBuild = scripts.build ? 'npm run build' : 'npx vite build';
            defaultOutDir = 'build';
        } else if (packageJson && scripts.build) {
            detectedFramework = 'node';
            detectedFrameworkName = 'Node / JavaScript App';
            defaultBuild = 'npm run build';
            defaultOutDir = 'dist';
        }

        // Parse env vars from .env.example
        const detectedEnvVars: AnalyzedEnvVar[] = [];
        if (envExampleContent) {
            const lines = envExampleContent.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const [k, ...vParts] = trimmed.split('=');
                    const key = k.trim();
                    const val = vParts.join('=').trim().replace(/^['"]|['"]$/g, '');
                    if (key) {
                        detectedEnvVars.push({
                            key,
                            value: val,
                            required: false,
                            description: `Detected from ${envExamplePath}`
                        });
                    }
                }
            }
        }

        // Clean subdomain derived from repo name
        const suggestedSubdomain = repo.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);

        // 2. AI Reasoning via ModelGateway
        let aiAnalysisText = `Detected a ${detectedFrameworkName} project. The recommended production compilation target is '${defaultOutDir}' with '${defaultBuild}'.`;
        let aiConfidence = 95;

        try {
            const prompt = `Analyze this GitHub repository for hosting on Fluxbase Edge CDN:
Repository: ${owner}/${repo}
Branch: ${branch}
Root Directory: ${rootDir}
Total Files: ${totalFiles}
Key Folders: ${rootFolders.join(', ')}
Key Files: ${allPaths.filter(p => !p.includes('/')).join(', ')}
Package.json Dependencies: ${JSON.stringify(Object.keys(deps).slice(0, 25))}
Package.json Scripts: ${JSON.stringify(scripts)}
Found Configs: ${JSON.stringify(Object.keys(configsFound))}
Detected Baseline: ${detectedFrameworkName} (build: ${defaultBuild}, out: ${defaultOutDir})

Provide optimal hosting recommendations in strictly valid JSON format with keys:
{
  "framework": "vite" | "next" | "react" | "vue" | "astro" | "svelte" | "static",
  "frameworkName": string,
  "buildCommand": string,
  "outputDirectory": string,
  "installCommand": string,
  "rootDir": string,
  "architectureExplanation": string,
  "confidence": number
}`;

            const aiRes = await ModelGateway.generate({
                model: 'flux-lite',
                messages: [
                    {
                        role: 'system',
                        content: 'You are the Fluxbase AI Repository Analyzer. Inspect the repository code and structure, identify the exact frontend framework, determine the optimal production build command and output directory, and return strictly valid JSON without markdown wrapping.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 600
            });

            if (aiRes.text) {
                const cleaned = aiRes.text.replace(/```json\s*|```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                if (parsed.framework) detectedFramework = parsed.framework;
                if (parsed.frameworkName) detectedFrameworkName = parsed.frameworkName;
                if (parsed.buildCommand) defaultBuild = parsed.buildCommand;
                if (parsed.outputDirectory) defaultOutDir = parsed.outputDirectory;
                if (parsed.installCommand) defaultInstall = parsed.installCommand;
                if (parsed.rootDir) rootDir = parsed.rootDir;
                if (parsed.architectureExplanation) aiAnalysisText = parsed.architectureExplanation;
                if (parsed.confidence) aiConfidence = parsed.confidence;
            }
        } catch (aiErr: any) {
            logger.warn('AI reasoning fallback to heuristics:', aiErr?.message);
        }

        return NextResponse.json({
            success: true,
            repo: {
                owner,
                repo,
                branch,
                fullName: `${owner}/${repo}`,
                url: `https://github.com/${owner}/${repo}`
            },
            config: {
                framework: detectedFramework,
                frameworkName: detectedFrameworkName,
                buildCommand: defaultBuild,
                outputDirectory: defaultOutDir,
                installCommand: defaultInstall,
                rootDir,
                suggestedSubdomain
            },
            envVars: detectedEnvVars,
            treeSummary: {
                totalFiles,
                mainFolders: rootFolders,
                keyFiles: allPaths.filter(p => !p.includes('/')).slice(0, 10),
                hasTypeScript,
                hasTailwind,
                packageManager: hasBun ? 'bun' : hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm'
            },
            aiAnalysis: {
                explanation: aiAnalysisText,
                confidence: aiConfidence
            }
        });
    } catch (err: any) {
        logger.error('Failed to analyze repository with AI:', err);
        return NextResponse.json({
            success: false,
            error: err.message || 'Failed to inspect repository'
        }, { status: 500 });
    }
}
