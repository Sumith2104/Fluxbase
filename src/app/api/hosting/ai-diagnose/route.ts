import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getPgPool } from '@/lib/pg';
import { ModelGateway } from '@/lib/agent-core/gateway';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { deployId, buildLogs: explicitLogs, errorMessage: explicitError } = body;

        let logs = explicitLogs || '';
        let errorMsg = explicitError || '';
        let siteName = 'Application';
        let framework = 'Web App';

        // If deployId is provided, enrich with database record
        if (deployId) {
            try {
                const pool = getPgPool();
                const res = await pool.query(
                    `SELECT d.build_logs, d.error_message, d.framework_slug as framework, s.subdomain as site_name
                     FROM fluxbase_global.hosting_deployments d
                     LEFT JOIN fluxbase_global.hosting_sites s ON d.site_id = s.site_id
                     WHERE d.deploy_id = $1`,
                    [deployId]
                );
                if (res.rows.length > 0) {
                    const row = res.rows[0];
                    if (!logs) logs = row.build_logs || '';
                    if (!errorMsg) errorMsg = row.error_message || '';
                    if (row.framework) framework = row.framework;
                    if (row.site_name) siteName = row.site_name;
                }
            } catch (dbErr: any) {
                logger.warn('Failed to query deployment details for AI diagnosis:', dbErr.message);
            }
        }

        if (!logs && !errorMsg) {
            return NextResponse.json({
                success: false,
                error: 'No build logs or error message provided for analysis'
            }, { status: 400 });
        }

        // Extract the most relevant error window from logs (last 4500 characters)
        const relevantLogTail = logs.length > 4500 ? logs.slice(-4500) : logs;

        const systemPrompt = `You are Flux AI Deployment Doctor, an expert cloud infrastructure and build diagnostics assistant for modern web applications (Next.js, Vite, React, Vue, SvelteKit, Astro, static HTML).
Your task is to analyze build and deployment failure logs, identify the exact root cause, explain it in crystal-clear developer-friendly terms, and provide the exact fix.

Always return a clean JSON object conforming strictly to this format:
{
  "summary": "Short 1-sentence headline explaining what failed",
  "category": "prerender" | "dependencies" | "configuration" | "env_var" | "syntax" | "timeout" | "other",
  "rootCause": "Clear explanation of why this error happened in the project",
  "affectedFile": "Path to file or config needing edits (e.g. 'src/app/docs/page.tsx', 'next.config.js', 'package.json') or null if general",
  "suggestedFix": "Direct instructions for the developer on how to fix it",
  "codeSnippet": "Exact code snippet or CLI command to apply (if applicable)",
  "canAutoRetry": true
}
Do NOT return markdown formatting outside the JSON. Return raw valid JSON only.`;

        const userPrompt = `Application: ${siteName}
Detected Framework: ${framework}
Error Message: ${errorMsg || 'Build process exited with error'}

Relevant Build Logs:
\`\`\`
${relevantLogTail}
\`\`\`

Analyze the failure and provide the diagnosis and resolution JSON:`;

        try {
            const aiResponse = await ModelGateway.generate({
                model: 'flux-pro',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });

            let parsed: any;
            try {
                let rawText = aiResponse.text.trim();
                if (rawText.startsWith('```json')) rawText = rawText.slice(7);
                if (rawText.startsWith('```')) rawText = rawText.slice(3);
                if (rawText.endsWith('```')) rawText = rawText.slice(0, -3);
                parsed = JSON.parse(rawText.trim());
            } catch (pErr) {
                parsed = {
                    summary: 'Build compilation or runtime failure detected',
                    category: 'other',
                    rootCause: aiResponse.text || 'Build process encountered an error during execution.',
                    affectedFile: null,
                    suggestedFix: 'Review the build logs for runtime errors or missing exports.',
                    codeSnippet: null,
                    canAutoRetry: false
                };
            }

            return NextResponse.json({
                success: true,
                diagnosis: parsed
            });
        } catch (aiErr: any) {
            logger.error('ModelGateway diagnosis failed, providing heuristic fallback:', aiErr);

            // Heuristic fallback if AI model is unreachable
            const isPrerender = relevantLogTail.includes('Error occurred prerendering page') || relevantLogTail.includes('Server Components render');
            const isTimeout = relevantLogTail.includes('Command timed out') || relevantLogTail.includes('timed out');
            const isPeerDeps = relevantLogTail.includes('ERESOLVE') || relevantLogTail.includes('peer dependency');

            let fallbackDiagnosis: {
                summary: string;
                category: string;
                rootCause: string;
                affectedFile: string | null;
                suggestedFix: string;
                codeSnippet: string | null;
                canAutoRetry: boolean;
            } = {
                summary: 'Deployment build failure',
                category: 'other',
                rootCause: errorMsg || 'Build exited with a non-zero code.',
                affectedFile: null,
                suggestedFix: 'Check framework configuration and build logs.',
                codeSnippet: null,
                canAutoRetry: true
            };

            if (isPrerender) {
                const match = relevantLogTail.match(/Error occurred prerendering page "([^"]+)"/);
                const pagePath = match ? match[1] : '/';
                fallbackDiagnosis = {
                    summary: `Prerendering failure on static route ${pagePath}`,
                    category: 'prerender',
                    rootCause: `Next.js attempted to statically pre-bake route ${pagePath} at build time, but encountered browser-specific APIs (window, localStorage) or unhandled runtime context.`,
                    affectedFile: `src/app${pagePath === '/' ? '/page.tsx' : pagePath + '/page.tsx'}`,
                    suggestedFix: `Add 'export const dynamic = "force-dynamic";' to the page or wrap client components in Suspense.`,
                    codeSnippet: `export const dynamic = 'force-dynamic';\nexport const revalidate = 0;`,
                    canAutoRetry: true
                };
            } else if (isTimeout || isPeerDeps) {
                fallbackDiagnosis = {
                    summary: 'Dependency installation timeout or peer conflict',
                    category: 'dependencies',
                    rootCause: 'Conflicting npm peer dependencies or slow graph resolution on deep dependency trees.',
                    affectedFile: 'package.json',
                    suggestedFix: 'Use --legacy-peer-deps or prune conflicting packages in package.json.',
                    codeSnippet: 'npm install --legacy-peer-deps',
                    canAutoRetry: true
                };
            }

            return NextResponse.json({
                success: true,
                diagnosis: fallbackDiagnosis,
                isFallback: true
            });
        }
    } catch (err: any) {
        logger.error('Hosting AI diagnose route error:', err);
        return NextResponse.json({
            success: false,
            error: err.message || 'Failed to analyze deployment error'
        }, { status: 500 });
    }
}
