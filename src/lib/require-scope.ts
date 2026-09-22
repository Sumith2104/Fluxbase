import { AuthContext } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { ERROR_CODES, FluxbaseError } from './error-codes';

/**
 * Checks that the authenticated context has the required scope(s).
 * If auth is missing, returns 401. If scopes are insufficient, returns 403.
 * If all checks pass, returns null (caller should continue).
 *
 * Usage in API routes:
 *   const auth = await getAuthContextFromRequest(req);
 *   const scopeErr = requireScope(auth, 'write', 'admin');
 *   if (scopeErr) return scopeErr;
 */
export function requireScope(
    auth: AuthContext | null,
    ...requiredScopes: string[]
): NextResponse | null {
    if (!auth) {
        return NextResponse.json(
            { success: false, error: { message: 'Authentication required.', code: ERROR_CODES.UNAUTHORIZED } },
            { status: 401 }
        );
    }

    if (auth.status === 'suspended') {
        return NextResponse.json(
            { success: false, error: { message: 'Organization suspended. Please resume in Settings.', code: ERROR_CODES.FORBIDDEN } },
            { status: 403 }
        );
    }

    // If the user has no scopes array (e.g., session-based auth), allow all.
    // Scopes are only enforced for API key auth.
    if (!auth.scopes || auth.scopes.length === 0) {
        return null;
    }

    const hasScope = requiredScopes.some(scope => auth.scopes!.includes(scope) || auth.scopes!.includes('*') || auth.scopes!.includes('admin'));
    if (!hasScope) {
        return NextResponse.json(
            { success: false, error: { message: 'Insufficient permissions. Your API key requires one of these scopes: ' + requiredScopes.join(', '), code: ERROR_CODES.FORBIDDEN } },
            { status: 403 }
        );
    }

    return null;
}

/**
 * Convenience: require read access.
 */
export function requireReadScope(auth: AuthContext | null): NextResponse | null {
    return requireScope(auth, 'read', 'admin');
}

/**
 * Convenience: require write access.
 */
export function requireWriteScope(auth: AuthContext | null): NextResponse | null {
    return requireScope(auth, 'write', 'admin');
}

/**
 * Convenience: require admin access.
 */
export function requireAdminScope(auth: AuthContext | null): NextResponse | null {
    return requireScope(auth, 'admin');
}

/**
 * Throws FluxbaseError if auth is missing or does not have required scope.
 * Designed for API routes using try/catch blocks with jsonError().
 */
export function assertScope(auth: AuthContext | null, ...requiredScopes: string[]): void {
    if (!auth) {
        throw new FluxbaseError('Authentication required.', ERROR_CODES.UNAUTHORIZED, 401);
    }

    if (auth.status === 'suspended') {
        throw new FluxbaseError('Organization suspended. Please resume in Settings.', ERROR_CODES.FORBIDDEN, 403);
    }

    if (!auth.scopes || auth.scopes.length === 0) {
        return;
    }

    const hasScope = requiredScopes.some(scope => auth.scopes!.includes(scope) || auth.scopes!.includes('*') || auth.scopes!.includes('admin'));
    if (!hasScope) {
        throw new FluxbaseError(
            'Insufficient permissions. Your API key requires one of these scopes: ' + requiredScopes.join(', '),
            ERROR_CODES.FORBIDDEN,
            403
        );
    }
}

export function assertWriteScope(auth: AuthContext | null): void {
    assertScope(auth, 'write', 'admin');
}

export function assertReadScope(auth: AuthContext | null): void {
    assertScope(auth, 'read', 'admin');
}

export function assertAdminScope(auth: AuthContext | null): void {
    assertScope(auth, 'admin');
}
