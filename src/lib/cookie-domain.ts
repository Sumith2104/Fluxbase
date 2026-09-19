/**
 * Retrieves the appropriate cookie domain for multi-subdomain session persistence (*.fluxbasedb.me)
 */
export function getSessionCookieDomain(hostOrReq?: string | null): string | undefined {
    if (process.env.NODE_ENV !== 'production') return undefined;

    // When running on Vercel, unless the request explicitly came through a fluxbasedb.me domain,
    // do NOT set domain to .fluxbasedb.me (browsers reject cookies set for external domains).
    if (process.env.VERCEL === '1') {
        if (!hostOrReq || !hostOrReq.toLowerCase().includes('fluxbasedb.me')) {
            return undefined;
        }
    }

    const cleanHost = (hostOrReq || process.env.NEXT_PUBLIC_APP_URL || '').toLowerCase();
    if (cleanHost.includes('fluxbasedb.me')) {
        return '.fluxbasedb.me';
    }
    return undefined;
}
