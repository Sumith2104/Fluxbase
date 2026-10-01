/**
 * Superstatic Multi-Phase Routing Engine
 * Based on @vercel/routing-utils
 * Evaluates Clean URLs, Trailing Slash, User Redirects, Custom Headers, Rewrites, and Miss/Filesystem Phases.
 */

export interface RouteItem {
    src?: string;
    dest?: string;
    headers?: Record<string, string>;
    status?: number;
    continue?: boolean;
    check?: boolean;
    handle?: 'filesystem' | 'hit' | 'miss' | 'rewrite' | 'error';
    has?: Array<{ type: string; key: string; value?: string }>;
    missing?: Array<{ type: string; key: string; value?: string }>;
}

export interface UserVercelConfig {
    cleanUrls?: boolean;
    trailingSlash?: boolean;
    redirects?: Array<{
        source: string;
        destination: string;
        permanent?: boolean;
        statusCode?: number;
    }>;
    headers?: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
    }>;
    rewrites?: Array<{
        source: string;
        destination: string;
    }>;
    routes?: RouteItem[];
}

export interface CompiledRoute {
    regex: RegExp;
    dest?: string;
    headers?: Record<string, string>;
    status?: number;
    continue?: boolean;
    check?: boolean;
    handle?: 'filesystem' | 'hit' | 'miss' | 'rewrite' | 'error';
    paramNames: string[];
}

export interface RouteEvaluationResult {
    action: 'serve_file' | 'redirect' | 'rewrite' | 'proxy' | 'not_found';
    resolvedPath: string;
    statusCode: number;
    headers: Record<string, string>;
    redirectLocation?: string;
    proxyTarget?: string;
}

/**
 * Converts a Vercel/Superstatic route source path (e.g. "/blog/:id", "/docs/:path*")
 * into a RegExp and parameter name list.
 */
export function compileRoutePattern(source: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    // Escape regex characters except our wildcards and param syntax
    let pattern = source;

    // Handle named parameters :paramName* or :paramName+ or :paramName
    pattern = pattern.replace(/:([a-zA-Z0-9_]+)(\*|\+)?/g, (_, name, quantifier) => {
        paramNames.push(name);
        if (quantifier === '*') {
            return '(.*)';
        }
        if (quantifier === '+') {
            return '(.+)';
        }
        return '([^/]+)';
    });

    // Handle wildcard *
    pattern = pattern.replace(/\*/g, '(.*)');

    // Ensure leading and trailing anchors
    if (!pattern.startsWith('^')) {
        pattern = `^${pattern}`;
    }
    if (!pattern.endsWith('$')) {
        pattern = `${pattern}$`;
    }

    try {
        const regex = new RegExp(pattern);
        return { regex, paramNames };
    } catch {
        // Fallback to literal escaped regex
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return { regex: new RegExp(`^${escaped}$`), paramNames: [] };
    }
}

/**
 * Replaces backreferences $1, $2 or :paramName in destination string
 */
export function interpolateDestination(dest: string, match: RegExpMatchArray, paramNames: string[]): string {
    let result = dest;

    // Replace $1, $2, etc.
    for (let i = 1; i < match.length; i++) {
        result = result.replace(new RegExp(`\\$${i}`, 'g'), match[i] || '');
    }

    // Replace :paramName* or :paramName+ or :paramName
    for (let i = 0; i < paramNames.length; i++) {
        const name = paramNames[i];
        const val = match[i + 1] || '';
        result = result.replace(new RegExp(`:${name}(\\*|\\+)?`, 'g'), val);
    }

    return result;
}

/**
 * Compiles a full Superstatic route table from user vercel.json and framework defaults
 */
export function compileSuperstaticRoutes(
    config: UserVercelConfig,
    frameworkDefaultRoutes: RouteItem[] = []
): CompiledRoute[] {
    const rawRoutes: RouteItem[] = [];

    // Phase 1: Clean URLs
    if (config.cleanUrls) {
        const loc = config.trailingSlash ? '/$1/' : '/$1';
        rawRoutes.push({
            src: '^/(?:(.+)/)?index(?:\\.html)?/?$',
            headers: { Location: loc },
            status: 308
        });
        rawRoutes.push({
            src: '^/(.*)\\.html/?$',
            headers: { Location: loc },
            status: 308
        });
    }

    // Phase 2: Trailing Slash
    if (config.trailingSlash === true) {
        // Add trailing slash to paths without extension
        rawRoutes.push({
            src: '^/([^.?]+[^/?])$',
            headers: { Location: '/$1/' },
            status: 308
        });
    } else if (config.trailingSlash === false) {
        // Strip trailing slash
        rawRoutes.push({
            src: '^/(.+)/$',
            headers: { Location: '/$1' },
            status: 308
        });
    }

    // Phase 3: User Redirects
    if (config.redirects && config.redirects.length > 0) {
        for (const red of config.redirects) {
            let status = 308;
            if (red.permanent === false) status = 307;
            if (red.statusCode) status = red.statusCode;

            rawRoutes.push({
                src: red.source,
                dest: red.destination,
                status
            });
        }
    }

    // Phase 4: User Headers
    if (config.headers && config.headers.length > 0) {
        for (const h of config.headers) {
            const headerMap: Record<string, string> = {};
            for (const item of h.headers) {
                headerMap[item.key] = item.value;
            }
            rawRoutes.push({
                src: h.source,
                headers: headerMap,
                continue: true
            });
        }
    }

    // Framework default caching routes (e.g. Next.js /_next/static/)
    for (const fRoute of frameworkDefaultRoutes) {
        rawRoutes.push(fRoute);
    }

    // Phase 5: Filesystem handle
    rawRoutes.push({ handle: 'filesystem' });

    // Phase 6: User Rewrites
    if (config.rewrites && config.rewrites.length > 0) {
        for (const rw of config.rewrites) {
            rawRoutes.push({
                src: rw.source,
                dest: rw.destination,
                check: true
            });
        }
    }

    // Direct legacy / custom routes if present
    if (config.routes && config.routes.length > 0) {
        rawRoutes.push(...config.routes);
    }

    // Phase 7: Miss handle
    rawRoutes.push({ handle: 'miss' });

    // Compile into RegExp objects
    const compiled: CompiledRoute[] = [];
    for (const r of rawRoutes) {
        if (r.handle) {
            compiled.push({
                regex: /^.*$/,
                handle: r.handle,
                paramNames: []
            });
            continue;
        }

        const { regex, paramNames } = compileRoutePattern(r.src || '.*');
        compiled.push({
            regex,
            dest: r.dest,
            headers: r.headers,
            status: r.status,
            continue: r.continue,
            check: r.check,
            paramNames
        });
    }

    return compiled;
}

/**
 * Evaluates an incoming HTTP request path against compiled Superstatic routes.
 * Emulates Vercel's edge routing pipeline.
 */
export async function evaluateSuperstaticRoute(params: {
    requestPath: string;
    routes: CompiledRoute[];
    isSpa: boolean;
    hasFile: (path: string) => Promise<boolean>;
}): Promise<RouteEvaluationResult> {
    const { requestPath, routes, isSpa, hasFile } = params;

    // Clean and normalize incoming path
    let currentPath = requestPath.split('?')[0];
    if (!currentPath.startsWith('/')) {
        currentPath = `/${currentPath}`;
    }

    const accumulatedHeaders: Record<string, string> = {};
    let currentPhase: 'pre_fs' | 'filesystem' | 'rewrites' | 'miss' = 'pre_fs';
    let fileExists = false;

    for (const route of routes) {
        if (route.handle) {
            if (route.handle === 'filesystem') {
                currentPhase = 'filesystem';

                // Check if currentPath exists on the physical storage/CDN
                let checkPath = currentPath.replace(/^\/+/, '');
                if (!checkPath || checkPath.endsWith('/')) {
                    checkPath += 'index.html';
                }

                if (await hasFile(checkPath)) {
                    fileExists = true;
                    return {
                        action: 'serve_file',
                        resolvedPath: checkPath,
                        statusCode: 200,
                        headers: accumulatedHeaders
                    };
                }

                // If path has no extension, also check <path>.html and <path>/index.html
                if (!checkPath.includes('.')) {
                    if (await hasFile(`${checkPath}.html`)) {
                        return {
                            action: 'serve_file',
                            resolvedPath: `${checkPath}.html`,
                            statusCode: 200,
                            headers: accumulatedHeaders
                        };
                    }
                    if (await hasFile(`${checkPath}/index.html`)) {
                        return {
                            action: 'serve_file',
                            resolvedPath: `${checkPath}/index.html`,
                            statusCode: 200,
                            headers: accumulatedHeaders
                        };
                    }
                }

                // Not found on filesystem, move to rewrites
                currentPhase = 'rewrites';
                continue;
            }

            if (route.handle === 'miss') {
                currentPhase = 'miss';
                break;
            }

            continue;
        }

        // Test route regex against current path
        const match = currentPath.match(route.regex);
        if (!match) continue;

        // Apply headers
        if (route.headers) {
            for (const [k, v] of Object.entries(route.headers)) {
                accumulatedHeaders[k] = v;
            }
        }

        // If redirect route (has status code or Location header)
        if (route.status && (route.status >= 300 && route.status <= 308)) {
            let redirectLoc = route.dest
                ? interpolateDestination(route.dest, match, route.paramNames)
                : route.headers?.Location || currentPath;

            // Interpolate Location if it contains backrefs
            if (route.headers?.Location) {
                redirectLoc = interpolateDestination(route.headers.Location, match, route.paramNames);
            }

            return {
                action: 'redirect',
                resolvedPath: currentPath,
                statusCode: route.status,
                headers: accumulatedHeaders,
                redirectLocation: redirectLoc
            };
        }

        // If rewrite route (dest present, no redirect status)
        if (route.dest && !route.status) {
            const rewritten = interpolateDestination(route.dest, match, route.paramNames);

            // External HTTP/HTTPS proxy rewrite (e.g. backend API proxy)
            if (rewritten.startsWith('http://') || rewritten.startsWith('https://')) {
                return {
                    action: 'proxy',
                    resolvedPath: currentPath,
                    statusCode: 200,
                    headers: accumulatedHeaders,
                    proxyTarget: rewritten
                };
            }

            currentPath = rewritten.startsWith('/') ? rewritten : `/${rewritten}`;

            if (route.check) {
                // If check: true, check if rewritten file exists
                let checkPath = currentPath.replace(/^\/+/, '');
                if (!checkPath || checkPath.endsWith('/')) checkPath += 'index.html';

                if (await hasFile(checkPath)) {
                    return {
                        action: 'serve_file',
                        resolvedPath: checkPath,
                        statusCode: 200,
                        headers: accumulatedHeaders
                    };
                }

                // Also check .html and /index.html if no extension
                if (!checkPath.includes('.')) {
                    if (await hasFile(`${checkPath}.html`)) {
                        return {
                            action: 'serve_file',
                            resolvedPath: `${checkPath}.html`,
                            statusCode: 200,
                            headers: accumulatedHeaders
                        };
                    }
                    if (await hasFile(`${checkPath}/index.html`)) {
                        return {
                            action: 'serve_file',
                            resolvedPath: `${checkPath}/index.html`,
                            statusCode: 200,
                            headers: accumulatedHeaders
                        };
                    }
                }
            }

            if (!route.continue) {
                // Terminal rewrite
                break;
            }
        }
    }

    // Miss phase handling:
    // If SPA is enabled and this is not a static asset file or an API call, serve index.html
    const hasAssetExt = /\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|wasm|json|map)$/i.test(currentPath);
    const isApiRoute = currentPath.startsWith('/api/') || currentPath === '/api';
    if (isSpa && !hasAssetExt && !isApiRoute) {
        if (await hasFile('index.html')) {
            return {
                action: 'serve_file',
                resolvedPath: 'index.html',
                statusCode: 200,
                headers: {
                    ...accumulatedHeaders,
                    'X-Flux-Route': 'spa-fallback'
                }
            };
        }
    }

    return {
        action: 'not_found',
        resolvedPath: currentPath,
        statusCode: 404,
        headers: isApiRoute
            ? { ...accumulatedHeaders, 'Content-Type': 'application/json' }
            : accumulatedHeaders
    };
}
