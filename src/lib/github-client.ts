import { detectDialect } from './dialect-detector';
import logger from '@/lib/logger';

export interface GitHubRepo {
    id: number;
    full_name: string;          // "owner/repo"
    name: string;
    private: boolean;
    description: string | null;
    default_branch: string;
    language: string | null;
    updated_at: string;
    html_url: string;
    stargazers_count: number;
}

export interface GitHubFileEntry {
    name: string;
    path: string;
    type: 'file' | 'dir';
    size: number;
    sha: string;
    download_url: string | null;
}

export interface FluxbaseManifest {
    projectName?: string;
    dialect?: 'postgresql' | 'mysql';
    executionOrder?: string[];
    description?: string;
    version?: string;
}

export interface FluxbaseModule {
    found: boolean;
    files: GitHubFileEntry[];          // .sql files sorted in execution order
    manifest: FluxbaseManifest | null;
    detectedDialect: 'postgresql' | 'mysql';
    dialectConfidence: number;         // 0-100
    totalSizeBytes: number;
    repoFullName: string;
    branch: string;
    modulePath: string;                // e.g. "fluxbase" or "packages/api/fluxbase"
}

export class GitHubClient {
    private headers: Record<string, string>;

    constructor(private accessToken: string) {
        this.headers = {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Fluxbase-Cloud',
        };
    }

    async getUser(): Promise<{ login: string; avatar_url: string; name: string }> {
        const res = await fetch('https://api.github.com/user', {
            headers: this.headers,
        });

        if (!res.ok) {
            throw new Error(`GitHub API error fetching user (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        return {
            login: data.login,
            avatar_url: data.avatar_url,
            name: data.name || data.login,
        };
    }

    async listRepos(page: number = 1, perPage: number = 30, sort: string = 'updated'): Promise<GitHubRepo[]> {
        const url = `https://api.github.com/user/repos?sort=${encodeURIComponent(sort)}&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`;
        const res = await fetch(url, {
            headers: this.headers,
        });

        if (!res.ok) {
            throw new Error(`GitHub API error listing repos (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        if (!Array.isArray(data)) return [];

        return data.map((r: any) => ({
            id: r.id,
            full_name: r.full_name,
            name: r.name,
            private: Boolean(r.private),
            description: r.description || null,
            default_branch: r.default_branch || 'main',
            language: r.language || null,
            updated_at: r.updated_at,
            html_url: r.html_url,
            stargazers_count: r.stargazers_count || 0,
        }));
    }

    async listAllRepos(maxRepos: number = 300): Promise<GitHubRepo[]> {
        const all: GitHubRepo[] = [];
        let page = 1;
        const perPage = 100;

        while (all.length < maxRepos) {
            const batch = await this.listRepos(page, perPage);
            if (!batch || batch.length === 0) break;
            all.push(...batch);
            if (batch.length < perPage) break;
            page++;
        }

        return all;
    }

    async searchUserRepos(query: string): Promise<GitHubRepo[]> {
        const q = query.trim().toLowerCase();
        if (!q) return this.listAllRepos(100);

        try {
            // Check via GitHub Search API for instant matching across all repos
            const user = await this.getUser();
            const searchUrl = `https://api.github.com/search/repositories?q=user:${encodeURIComponent(user.login)}+${encodeURIComponent(query)}+in:name&per_page=50`;
            const res = await fetch(searchUrl, { headers: this.headers });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.items) && data.items.length > 0) {
                    return data.items.map((r: any) => ({
                        id: r.id,
                        full_name: r.full_name,
                        name: r.name,
                        private: Boolean(r.private),
                        description: r.description || null,
                        default_branch: r.default_branch || 'main',
                        language: r.language || null,
                        updated_at: r.updated_at,
                        html_url: r.html_url,
                        stargazers_count: r.stargazers_count || 0,
                    }));
                }
            }
        } catch {
            // Fallback to local filter
        }

        // Fallback: fetch up to 300 repos and filter locally
        const all = await this.listAllRepos(300);
        return all.filter(r => 
            r.name.toLowerCase().includes(q) || 
            r.full_name.toLowerCase().includes(q) ||
            (r.description && r.description.toLowerCase().includes(q))
        );
    }

    async getFileContent(
        owner: string,
        repo: string,
        path: string,
        branch: string = 'main'
    ): Promise<{ content: string; sha: string; size: number }> {
        const cleanPath = path.replace(/^\/+/, '');
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`;
        const res = await fetch(url, {
            headers: this.headers,
        });

        if (!res.ok) {
            throw new Error(`GitHub API error fetching file ${cleanPath} (${res.status}): ${await res.text()}`);
        }

        const data = await res.json();
        if (data.type !== 'file' || !data.content) {
            throw new Error(`Item at ${cleanPath} is not a valid file or has empty content`);
        }

        const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
        return {
            content,
            sha: data.sha,
            size: data.size || content.length,
        };
    }

    async discoverFluxbaseModule(
        owner: string,
        repo: string,
        branch: string = 'main',
        modulePath: string = 'fluxbase'
    ): Promise<FluxbaseModule> {
        const cleanModulePath = modulePath.replace(/^\/+|\/+$/g, '') || 'fluxbase';
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(cleanModulePath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`;
        
        let entries: any[] = [];
        try {
            const res = await fetch(url, { headers: this.headers });
            if (res.status === 404) {
                return {
                    found: false,
                    files: [],
                    manifest: null,
                    detectedDialect: 'postgresql',
                    dialectConfidence: 0,
                    totalSizeBytes: 0,
                    repoFullName: `${owner}/${repo}`,
                    branch,
                    modulePath: cleanModulePath,
                };
            }
            if (!res.ok) {
                throw new Error(`GitHub API error discovering module (${res.status}): ${await res.text()}`);
            }
            const data = await res.json();
            if (Array.isArray(data)) {
                entries = data;
            }
        } catch (e: any) {
            logger.warn(`[GitHubClient] Could not fetch ${url}:`, e.message);
            return {
                found: false,
                files: [],
                manifest: null,
                detectedDialect: 'postgresql',
                dialectConfidence: 0,
                totalSizeBytes: 0,
                repoFullName: `${owner}/${repo}`,
                branch,
                modulePath: cleanModulePath,
            };
        }

        // 1. Check for optional fluxbase.json manifest
        let manifest: FluxbaseManifest | null = null;
        const manifestEntry = entries.find(e => e.name.toLowerCase() === 'fluxbase.json' && e.type === 'file');
        if (manifestEntry) {
            try {
                const { content } = await this.getFileContent(owner, repo, manifestEntry.path, branch);
                manifest = JSON.parse(content);
            } catch (err) {
                logger.warn('[GitHubClient] Failed to parse fluxbase.json manifest:', err);
            }
        }

        // 2. Filter .sql files
        const sqlFiles: GitHubFileEntry[] = entries
            .filter(e => e.type === 'file' && e.name.toLowerCase().endsWith('.sql'))
            .map(e => ({
                name: e.name,
                path: e.path,
                type: 'file',
                size: e.size || 0,
                sha: e.sha,
                download_url: e.download_url || null,
            }));

        if (sqlFiles.length === 0) {
            return {
                found: false,
                files: [],
                manifest,
                detectedDialect: manifest?.dialect || 'postgresql',
                dialectConfidence: manifest?.dialect ? 100 : 0,
                totalSizeBytes: 0,
                repoFullName: `${owner}/${repo}`,
                branch,
                modulePath: cleanModulePath,
            };
        }

        // 3. Sort SQL files by execution order
        // If manifest has executionOrder, honor it. Otherwise alphabetical with seed*.sql last.
        let sortedFiles: GitHubFileEntry[] = [];
        if (manifest?.executionOrder && Array.isArray(manifest.executionOrder) && manifest.executionOrder.length > 0) {
            const orderMap = new Map<string, number>();
            manifest.executionOrder.forEach((name, idx) => {
                orderMap.set(name.toLowerCase(), idx);
            });

            sortedFiles = [...sqlFiles].sort((a, b) => {
                const orderA = orderMap.has(a.name.toLowerCase()) ? orderMap.get(a.name.toLowerCase())! : 9999;
                const orderB = orderMap.has(b.name.toLowerCase()) ? orderMap.get(b.name.toLowerCase())! : 9999;
                if (orderA !== orderB) return orderA - orderB;
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
        } else {
            sortedFiles = [...sqlFiles].sort((a, b) => {
                const aIsSeed = a.name.toLowerCase().startsWith('seed');
                const bIsSeed = b.name.toLowerCase().startsWith('seed');
                if (aIsSeed && !bIsSeed) return 1;
                if (!aIsSeed && bIsSeed) return -1;
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
        }

        // 4. Sample files content to detect dialect
        let sampleSqlContent = '';
        let totalSizeBytes = 0;

        for (const file of sortedFiles) {
            totalSizeBytes += file.size;
            // Sample up to first 3 files or 60KB for dialect detection
            if (sampleSqlContent.length < 60000) {
                try {
                    const { content } = await this.getFileContent(owner, repo, file.path, branch);
                    sampleSqlContent += '\n' + content.slice(0, 20000);
                } catch (e) {
                    logger.warn(`[GitHubClient] Could not sample ${file.path}:`, e);
                }
            }
        }

        const score = detectDialect(sampleSqlContent);
        const finalDialect = manifest?.dialect || score.winner;
        const confidence = manifest?.dialect ? 100 : score.confidence;

        return {
            found: true,
            files: sortedFiles,
            manifest,
            detectedDialect: finalDialect,
            dialectConfidence: confidence,
            totalSizeBytes,
            repoFullName: `${owner}/${repo}`,
            branch,
            modulePath: cleanModulePath,
        };
    }

    async getTree(
        owner: string,
        repo: string,
        branch: string = 'main',
        recursive: boolean = true
    ): Promise<{ tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number; url: string }> }> {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}${recursive ? '?recursive=1' : ''}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) {
            throw new Error(`GitHub API error fetching tree for ${owner}/${repo}@${branch} (${res.status}): ${await res.text()}`);
        }
        return res.json();
    }

    async getBlobContent(owner: string, repo: string, sha: string): Promise<Buffer> {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) {
            throw new Error(`GitHub API error fetching blob ${sha} (${res.status}): ${await res.text()}`);
        }
        const data = await res.json();
        return Buffer.from(data.content, data.encoding || 'base64');
    }

    async getRepoZipball(
        owner: string,
        repo: string,
        ref: string = 'main',
        onProgress?: (downloadedBytes: number) => void
    ): Promise<Buffer> {
        const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`;
        const controller = new AbortController();
        const maxTimeoutMs = 600_000; // 10 minutes maximum duration
        const idleTimeoutMs = 60_000; // 60 seconds inactivity timeout (resets on each received chunk)

        let idleTimer: NodeJS.Timeout | null = null;
        const resetIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                controller.abort(new Error(`GitHub archive download stalled (no data received for ${idleTimeoutMs / 1000}s)`));
            }, idleTimeoutMs);
        };

        const maxTimer = setTimeout(() => {
            controller.abort(new Error(`GitHub archive download exceeded maximum time limit of ${maxTimeoutMs / 1000}s`));
        }, maxTimeoutMs);

        resetIdleTimer();

        try {
            const res = await fetch(url, {
                headers: {
                    ...this.headers,
                    Accept: 'application/vnd.github.v3+json, application/zip, application/octet-stream, */*'
                },
                redirect: 'follow',
                signal: controller.signal
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`GitHub API error downloading repository zip (${res.status}): ${errText}`);
            }

            if (!res.body) {
                const arrayBuf = await res.arrayBuffer();
                return Buffer.from(arrayBuf);
            }

            const reader = res.body.getReader();
            const chunks: Uint8Array[] = [];
            let totalBytes = 0;
            let lastReportTime = Date.now();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    resetIdleTimer();
                    chunks.push(value);
                    totalBytes += value.length;
                    const now = Date.now();
                    if (onProgress && (now - lastReportTime > 2000)) {
                        lastReportTime = now;
                        onProgress(totalBytes);
                    }
                }
            }

            if (onProgress) {
                onProgress(totalBytes);
            }

            return Buffer.concat(chunks);
        } finally {
            if (idleTimer) clearTimeout(idleTimer);
            clearTimeout(maxTimer);
        }
    }

    async getLatestCommit(owner: string, repo: string, branch: string = 'main'): Promise<{ sha: string; message: string; author: string }> {
        const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) {
            throw new Error(`GitHub API error fetching commit (${res.status}): ${await res.text()}`);
        }
        const data = await res.json();
        return {
            sha: data.sha,
            message: data.commit?.message || 'New commit',
            author: data.commit?.author?.name || data.author?.login || 'committer'
        };
    }

    async createWebhook(owner: string, repo: string, webhookUrl: string, secret?: string): Promise<{ id: number }> {
        try {
            const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, { headers: this.headers });
            if (listRes.ok) {
                const hooks = await listRes.json();
                if (Array.isArray(hooks)) {
                    const existing = hooks.find((h: any) => h.config?.url === webhookUrl);
                    if (existing) {
                        return { id: existing.id };
                    }
                }
            }
        } catch (e) {
            logger.warn('Failed to query existing GitHub webhooks:', e);
        }

        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({
                name: 'web',
                active: true,
                events: ['push'],
                config: {
                    url: webhookUrl,
                    content_type: 'json',
                    insecure_ssl: '0',
                    secret: secret || ''
                }
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Failed to create repository webhook (${res.status}): ${errText}`);
        }

        return res.json();
    }

    async deleteWebhook(owner: string, repo: string, hookId: number | string): Promise<boolean> {
        try {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`, {
                method: 'DELETE',
                headers: this.headers
            });
            return res.ok || res.status === 404;
        } catch {
            return false;
        }
    }

    /**
     * Fetches the entire repository tree recursively in a single GitHub API call
     */
    async getRepoTree(
        owner: string,
        repo: string,
        branch: string = 'main'
    ): Promise<{ path: string; mode: string; type: 'blob' | 'tree'; size?: number; sha: string }[]> {
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
        let res = await fetch(url, { headers: this.headers });
        if (!res.ok && (branch === 'main' || branch === 'master')) {
            const altBranch = branch === 'main' ? 'master' : 'main';
            const altUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(altBranch)}?recursive=1`;
            const altRes = await fetch(altUrl, { headers: this.headers });
            if (altRes.ok) {
                res = altRes;
            }
        }
        if (!res.ok) {
            throw new Error(`GitHub API error fetching repo tree (${res.status}): ${await res.text()}`);
        }
        const data = await res.json();
        return data.tree || [];
    }

    /**
     * Posts a commit status check to GitHub (like Vercel Deployment status)
     */
    async createCommitStatus(
        owner: string,
        repo: string,
        sha: string,
        params: {
            state: 'pending' | 'success' | 'failure' | 'error';
            target_url?: string;
            description: string;
            context?: string;
        }
    ): Promise<boolean> {
        try {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    state: params.state,
                    target_url: params.target_url,
                    description: params.description.slice(0, 140),
                    context: params.context || 'Fluxbase'
                })
            });
            return res.ok;
        } catch (e) {
            logger.warn('Failed to post GitHub commit status:', e);
            return false;
        }
    }

    /**
     * Posts or updates a preview bot comment on a pull request
     */
    async postOrUpdatePRComment(
        owner: string,
        repo: string,
        pullNumber: number,
        commentBody: string,
        marker: string = '<!-- fluxbase-preview-comment -->'
    ): Promise<boolean> {
        try {
            const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=50`, {
                headers: this.headers
            });
            if (!listRes.ok) return false;
            const comments = await listRes.json();
            const existing = Array.isArray(comments) ? comments.find((c: any) => c.body && c.body.includes(marker)) : null;

            const body = `${marker}\n${commentBody}`;

            if (existing) {
                const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
                    method: 'PATCH',
                    headers: this.headers,
                    body: JSON.stringify({ body })
                });
                return updateRes.ok;
            } else {
                const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
                    method: 'POST',
                    headers: this.headers,
                    body: JSON.stringify({ body })
                });
                return createRes.ok;
            }
        } catch (e) {
            logger.warn('Failed to post or update PR comment:', e);
            return false;
        }
    }
}

/**
 * Fetches public repository tree even without OAuth user token
 */
export async function fetchPublicRepoTree(
    owner: string,
    repo: string,
    branch: string = 'main',
    token?: string
): Promise<{ path: string; mode: string; type: 'blob' | 'tree'; size?: number; sha: string }[]> {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Fluxbase-Cloud',
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    let res = await fetch(url, { headers });
    if (!res.ok && (branch === 'main' || branch === 'master')) {
        const altBranch = branch === 'main' ? 'master' : 'main';
        const altUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(altBranch)}?recursive=1`;
        const altRes = await fetch(altUrl, { headers });
        if (altRes.ok) {
            res = altRes;
        }
    }
    if (!res.ok) {
        throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    return data.tree || [];
}



