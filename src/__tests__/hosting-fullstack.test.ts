import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createStandaloneArchive, extractStandaloneArchive } from '@/lib/hosting-archive';
import { locateBackendEntryScript } from '@/lib/hosting-runner';

describe('Fullstack Hosting Engine', () => {
    describe('Standalone Archive (Tar/Gzip compression and extraction)', () => {
        it('compresses and extracts a standalone server directory preserving all files', async () => {
            const testDir = path.join(os.tmpdir(), `fluxbase-test-archive-${Date.now()}`);
            const extractDir = path.join(os.tmpdir(), `fluxbase-test-extract-${Date.now()}`);

            try {
                // Setup test source directory
                fs.mkdirSync(path.join(testDir, '.next', 'server'), { recursive: true });
                fs.writeFileSync(path.join(testDir, 'server.js'), 'console.log("Fluxbase Fullstack Server");');
                fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'fullstack-app', version: '1.0.0' }));
                fs.writeFileSync(path.join(testDir, '.next', 'server', 'app.js'), 'module.exports = { route: "/api/hello" };');

                // Compress
                const archiveBuffer = await createStandaloneArchive(testDir);
                expect(archiveBuffer).toBeInstanceOf(Buffer);
                expect(archiveBuffer.length).toBeGreaterThan(0);

                // Extract
                await extractStandaloneArchive(archiveBuffer, extractDir);

                // Verify files exist with exact content
                expect(fs.existsSync(path.join(extractDir, 'server.js'))).toBe(true);
                expect(fs.readFileSync(path.join(extractDir, 'server.js'), 'utf-8')).toBe('console.log("Fluxbase Fullstack Server");');
                expect(fs.existsSync(path.join(extractDir, 'package.json'))).toBe(true);
                expect(fs.existsSync(path.join(extractDir, '.next', 'server', 'app.js'))).toBe(true);
                expect(fs.readFileSync(path.join(extractDir, '.next', 'server', 'app.js'), 'utf-8')).toBe('module.exports = { route: "/api/hello" };');
            } finally {
                // Cleanup
                fs.rmSync(testDir, { recursive: true, force: true });
                fs.rmSync(extractDir, { recursive: true, force: true });
            }
        });
    });

    describe('Entrypoint Detection (locateBackendEntryScript)', () => {
        it('finds server.js at root directory', () => {
            const testDir = path.join(os.tmpdir(), `fluxbase-test-entry-${Date.now()}`);
            try {
                fs.mkdirSync(testDir, { recursive: true });
                fs.writeFileSync(path.join(testDir, 'server.js'), '// server');
                const script = locateBackendEntryScript(testDir);
                expect(script).toBe(path.join(testDir, 'server.js'));
            } finally {
                fs.rmSync(testDir, { recursive: true, force: true });
            }
        });

        it('finds server.js inside .next/standalone folder when at subfolder', () => {
            const testDir = path.join(os.tmpdir(), `fluxbase-test-entry-sub-${Date.now()}`);
            try {
                fs.mkdirSync(path.join(testDir, '.next', 'standalone'), { recursive: true });
                fs.writeFileSync(path.join(testDir, '.next', 'standalone', 'server.js'), '// server');
                const script = locateBackendEntryScript(testDir);
                expect(script).toBe(path.join(testDir, '.next', 'standalone', 'server.js'));
            } finally {
                fs.rmSync(testDir, { recursive: true, force: true });
            }
        });

        it('returns null when no valid node.js entrypoint exists', () => {
            const testDir = path.join(os.tmpdir(), `fluxbase-test-entry-none-${Date.now()}`);
            try {
                fs.mkdirSync(testDir, { recursive: true });
                fs.writeFileSync(path.join(testDir, 'index.html'), '<h1>Static</h1>');
                const script = locateBackendEntryScript(testDir);
                expect(script).toBeNull();
            } finally {
                fs.rmSync(testDir, { recursive: true, force: true });
            }
        });
    });

    describe('Environment Variables (.env) Engine', () => {
        it('parses raw .env file with quotes, comments, and flags secrets vs public prefixes', async () => {
            const { parseEnvFile } = await import('@/lib/hosting-env');
            const sampleEnv = `
# System configuration
DATABASE_URL="postgresql://user:pass@localhost:5432/app"
STRIPE_KEY='sk_live_123456789'
NEXT_PUBLIC_APP_URL=https://myapp.fluxbasedb.me
VITE_API_ENDPOINT=https://api.myapp.com
PUBLIC_ANALYTICS_ID=analytics_999
INVALID-LINE-NO-EQUAL
`;
            const parsed = parseEnvFile(sampleEnv);
            expect(parsed).toHaveLength(5);
            
            const dbUrl = parsed.find(p => p.key === 'DATABASE_URL');
            expect(dbUrl).toBeDefined();
            expect(dbUrl?.value).toBe('postgresql://user:pass@localhost:5432/app');
            expect(dbUrl?.isSecret).toBe(true);

            const stripeKey = parsed.find(p => p.key === 'STRIPE_KEY');
            expect(stripeKey?.value).toBe('sk_live_123456789');
            expect(stripeKey?.isSecret).toBe(true);

            const nextPub = parsed.find(p => p.key === 'NEXT_PUBLIC_APP_URL');
            expect(nextPub?.value).toBe('https://myapp.fluxbasedb.me');
            expect(nextPub?.isSecret).toBe(false);

            const vitePub = parsed.find(p => p.key === 'VITE_API_ENDPOINT');
            expect(vitePub?.value).toBe('https://api.myapp.com');
            expect(vitePub?.isSecret).toBe(false);
        });

        it('encrypts and decrypts secret values using AES-256-GCM', async () => {
            const { encryptEnvValue, decryptEnvValue } = await import('@/lib/hosting-env');
            const secret = 'super-secret-production-token-999!@#$';
            const encrypted = encryptEnvValue(secret);

            expect(encrypted).not.toBe(secret);
            expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

            const decrypted = decryptEnvValue(encrypted);
            expect(decrypted).toBe(secret);
        });
    });
});

