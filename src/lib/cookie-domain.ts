/**
 * Retrieves the appropriate cookie domain for multi-subdomain session persistence (*.fluxbasedb.me)
 */
export function getSessionCookieDomain(hostOrReq?: string | null): string | undefined {
    if (process.env.NODE_ENV !== 'production') return undefined;
    const cleanHost = (hostOrReq || process.env.NEXT_PUBLIC_APP_URL || '').toLowerCase();
    if (cleanHost.includes('fluxbasedb.me')) {
        return '.fluxbasedb.me';
    }
    return undefined;
}
