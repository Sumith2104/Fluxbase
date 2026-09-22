import { describe, it, expect } from 'vitest';
import {
    requireScope,
    requireReadScope,
    requireWriteScope,
    requireAdminScope,
    assertScope,
    assertReadScope,
    assertWriteScope,
    assertAdminScope,
} from '@/lib/require-scope';
import { AuthContext } from '@/lib/auth';
import { isSafeRedirectPath, sanitizeRedirectPath } from '@/lib/oauth-config';
import { assertProjectScope } from '@/lib/project-auth';
import { FluxbaseError } from '@/lib/error-codes';

describe('Security Audit: Scope Enforcement System', () => {
    it('returns 401 when auth context is null in requireScope', async () => {
        const res = requireScope(null, 'read');
        expect(res).not.toBeNull();
        expect(res?.status).toBe(401);
        const data = await res?.json();
        expect(data.error.message).toBe('Authentication required.');
    });

    it('throws 401 FluxbaseError when auth context is null in assertScope', () => {
        expect(() => assertScope(null, 'read')).toThrowError(FluxbaseError);
        try {
            assertScope(null, 'read');
        } catch (err: any) {
            expect(err.status).toBe(401);
        }
    });

    it('returns 403 when organization is suspended', async () => {
        const suspendedAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'session',
            status: 'suspended',
        };
        const res = requireScope(suspendedAuth, 'read');
        expect(res).not.toBeNull();
        expect(res?.status).toBe(403);
        const data = await res?.json();
        expect(data.error.message).toContain('Organization suspended');

        expect(() => assertScope(suspendedAuth, 'read')).toThrowError(FluxbaseError);
    });

    it('allows session-based auth where scopes is empty or undefined', () => {
        const sessionAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'session',
        };
        expect(requireReadScope(sessionAuth)).toBeNull();
        expect(requireWriteScope(sessionAuth)).toBeNull();
        expect(requireAdminScope(sessionAuth)).toBeNull();

        expect(() => assertReadScope(sessionAuth)).not.toThrow();
        expect(() => assertWriteScope(sessionAuth)).not.toThrow();
        expect(() => assertAdminScope(sessionAuth)).not.toThrow();
    });

    it('enforces read scope: denies write-only or ai-only API keys', async () => {
        const writeOnlyAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            scopes: ['write'],
        };
        const res = requireReadScope(writeOnlyAuth);
        expect(res).not.toBeNull();
        expect(res?.status).toBe(403);

        expect(() => assertReadScope(writeOnlyAuth)).toThrowError(FluxbaseError);
    });

    it('enforces write scope: denies read-only API keys', async () => {
        const readOnlyAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            scopes: ['read'],
        };
        const res = requireWriteScope(readOnlyAuth);
        expect(res).not.toBeNull();
        expect(res?.status).toBe(403);

        expect(() => assertWriteScope(readOnlyAuth)).toThrowError(FluxbaseError);
    });

    it('enforces admin scope: denies read and write API keys', async () => {
        const readWriteAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            scopes: ['read', 'write'],
        };
        const res = requireAdminScope(readWriteAuth);
        expect(res).not.toBeNull();
        expect(res?.status).toBe(403);

        expect(() => assertAdminScope(readWriteAuth)).toThrowError(FluxbaseError);
    });

    it('allows wildcard "*" or "admin" scope for any required scope', () => {
        const wildcardAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            scopes: ['*'],
        };
        expect(requireReadScope(wildcardAuth)).toBeNull();
        expect(requireWriteScope(wildcardAuth)).toBeNull();
        expect(requireAdminScope(wildcardAuth)).toBeNull();

        const adminScopeAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            scopes: ['admin'],
        };
        expect(requireReadScope(adminScopeAuth)).toBeNull();
        expect(requireWriteScope(adminScopeAuth)).toBeNull();
        expect(requireAdminScope(adminScopeAuth)).toBeNull();
    });
});

describe('Security Audit: Open Redirect Prevention', () => {
    it('accepts legitimate local paths', () => {
        expect(isSafeRedirectPath('/dashboard')).toBe(true);
        expect(isSafeRedirectPath('/dashboard/projects/123')).toBe(true);
        expect(isSafeRedirectPath('/checkout?plan=pro')).toBe(true);
        expect(isSafeRedirectPath('/pricing')).toBe(true);
    });

    it('rejects protocol-relative open redirect attacks (//attacker.com)', () => {
        expect(isSafeRedirectPath('//attacker.com')).toBe(false);
        expect(isSafeRedirectPath('///attacker.com')).toBe(false);
        expect(isSafeRedirectPath('////attacker.com')).toBe(false);
        expect(sanitizeRedirectPath('//attacker.com')).toBe('/dashboard/projects');
        expect(sanitizeRedirectPath('///evil.org', '/custom-fallback')).toBe('/custom-fallback');
    });

    it('rejects backslash open redirect attacks (/\\attacker.com and \\\\attacker.com)', () => {
        expect(isSafeRedirectPath('/\\attacker.com')).toBe(false);
        expect(isSafeRedirectPath('\\\\attacker.com')).toBe(false);
        expect(isSafeRedirectPath('/path\\to\\somewhere')).toBe(false);
        expect(sanitizeRedirectPath('/\\attacker.com')).toBe('/dashboard/projects');
    });

    it('rejects absolute URLs (https://, http://, ftp://)', () => {
        expect(isSafeRedirectPath('https://evil.com')).toBe(false);
        expect(isSafeRedirectPath('http://evil.com')).toBe(false);
        expect(isSafeRedirectPath('ftp://evil.com')).toBe(false);
        expect(isSafeRedirectPath('javascript:alert(1)')).toBe(false);
        expect(isSafeRedirectPath('data:text/html,evil')).toBe(false);
    });

    it('rejects null, undefined, or empty values', () => {
        expect(isSafeRedirectPath(null)).toBe(false);
        expect(isSafeRedirectPath(undefined)).toBe(false);
        expect(isSafeRedirectPath('')).toBe(false);
        expect(sanitizeRedirectPath(null)).toBe('/dashboard/projects');
    });
});

describe('Security Audit: Project Isolation (assertProjectScope)', () => {
    it('passes when auth.allowedProjectId is undefined (user session or unscoped key)', () => {
        const unscopedAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
        };
        expect(() => assertProjectScope(unscopedAuth, 'proj_123')).not.toThrow();
    });

    it('passes when auth.allowedProjectId matches the requested projectId', () => {
        const scopedAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            allowedProjectId: 'proj_123',
        };
        expect(() => assertProjectScope(scopedAuth, 'proj_123')).not.toThrow();
    });

    it('throws 403 FluxbaseError when auth.allowedProjectId does not match the requested projectId', () => {
        const scopedAuth: AuthContext = {
            userId: 'usr_1',
            email: 'test@example.com',
            authMethod: 'apiKey',
            allowedProjectId: 'proj_123',
        };
        expect(() => assertProjectScope(scopedAuth, 'proj_456')).toThrowError(FluxbaseError);
        try {
            assertProjectScope(scopedAuth, 'proj_456');
        } catch (err: any) {
            expect(err.status).toBe(403);
            expect(err.message).toContain('not allowed to access the requested project');
        }
    });
});

describe('Security Audit: Middleware Static Assets Regex', () => {
    const staticRegex = /\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|woff2?|ttf|eot)$/i;

    it('correctly matches legitimate static files', () => {
        expect(staticRegex.test('/logo.png')).toBe(true);
        expect(staticRegex.test('/assets/styles.css')).toBe(true);
        expect(staticRegex.test('/bundle.js')).toBe(true);
        expect(staticRegex.test('/bundle.js.map')).toBe(true);
        expect(staticRegex.test('/font.woff2')).toBe(true);
        expect(staticRegex.test('/icon.svg')).toBe(true);
        expect(staticRegex.test('/favicon.ico')).toBe(true);
    });

    it('does NOT match dashboard paths or routes with dots', () => {
        expect(staticRegex.test('/dashboard/projects/my.app')).toBe(false);
        expect(staticRegex.test('/api/v1/rest/proj.1/table')).toBe(false);
        expect(staticRegex.test('/dashboard.admin')).toBe(false);
        expect(staticRegex.test('/users/john.doe')).toBe(false);
    });
});
