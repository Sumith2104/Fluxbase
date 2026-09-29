import { NextRequest, NextResponse } from 'next/server';
import { getOAuthConfig, getBaseOrigin, encodeOAuthState } from '@/lib/oauth-config';

export async function GET(request: NextRequest) {
    const { clientId, redirectUri } = getOAuthConfig(request, 'github');
    
    if (!clientId) {
        return NextResponse.json({ error: "GitHub Client ID is not configured for this environment" }, { status: 500 });
    }

    const scope = 'repo read:user user:email';
    const origin = getBaseOrigin(request);
    const returnTo = request.nextUrl.searchParams.get('returnTo') || '/dashboard/projects';
    const state = encodeOAuthState(origin, returnTo);
    
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;

    return NextResponse.redirect(githubAuthUrl);
}

