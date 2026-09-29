import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getGitHubToken } from '@/lib/github-token';
import { GitHubClient } from '@/lib/github-client';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = await getGitHubToken(userId);
    if (!token) {
        return NextResponse.json({
            success: false,
            connected: false,
            error: 'GitHub account is not connected. Please connect your GitHub account first.'
        }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const perPage = Math.min(100, parseInt(searchParams.get('per_page') || '100', 10));
    const sort = searchParams.get('sort') || 'updated';
    const search = searchParams.get('search')?.trim() || '';
    const refresh = searchParams.get('refresh') === 'true';

    // Check Redis cache for standard pagination (unless refresh=true)
    const cacheKey = `github_repos:${userId}:${page}:${perPage}:${sort}:${search}`;
    if (!refresh) {
        try {
            const { redis } = await import('@/lib/redis');
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
                return NextResponse.json({ success: true, connected: true, ...parsed });
            }
        } catch {
            // Redis error/not configured — continue without cache
        }
    }

    try {
        const client = new GitHubClient(token);
        let repos: import('@/lib/github-client').GitHubRepo[] = [];

        if (search) {
            repos = await client.searchUserRepos(search);
        } else {
            // Fetch all accessible user and org repositories up to 300
            repos = await client.listAllRepos(300);
        }

        const resultData = {
            repos,
            hasMore: false,
            totalCount: repos.length,
            page,
            perPage
        };

        // Cache for 60 seconds
        try {
            const { redis } = await import('@/lib/redis');
            await redis.set(cacheKey, JSON.stringify(resultData), { ex: 60 });
        } catch {}

        return NextResponse.json({
            success: true,
            connected: true,
            ...resultData
        });
    } catch (err: any) {
        logger.error('[GitHub Repos API] Error:', err);
        const isAuthError = err.message?.includes('Bad credentials') || err.message?.includes('(401)');
        if (isAuthError) {
            try {
                const { revokeGitHubToken } = await import('@/lib/github-token');
                await revokeGitHubToken(userId);
            } catch {}
            return NextResponse.json({
                success: false,
                connected: false,
                error: 'GitHub session expired. Please reconnect your GitHub account.'
            }, { status: 401 });
        }
        return NextResponse.json({
            success: false,
            connected: true,
            error: err.message || 'Failed to fetch GitHub repositories'
        }, { status: 500 });
    }
}
