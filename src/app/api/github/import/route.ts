import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getGitHubToken, ensureGitHubTables } from '@/lib/github-token';
import { GitHubClient } from '@/lib/github-client';
import { splitSqlStatements, parseCreateTables } from '@/lib/sql-splitter';
import { createProject } from '@/lib/data';
import { TenantProvisioner } from '@/lib/tenant-engine';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export const maxDuration = 60; // Allow up to 60s for full multi-file schema import

export async function POST(request: NextRequest) {
    const userId = await getCurrentUserId();
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = await getGitHubToken(userId);
    if (!token) {
        return NextResponse.json({
            success: false,
            error: 'GitHub account is not connected. Please connect your GitHub account.'
        }, { status: 401 });
    }

    await ensureGitHubTables();
    const startTime = Date.now();
    let createdProjectId: string | null = null;
    let migrationsExecuted = false;

    try {
        const body = await request.json();
        const {
            repoFullName,
            branch = 'main',
            modulePath = 'fluxbase',
            projectName,
            dialect = 'postgresql',
            timezone = 'Asia/Kolkata',
            userRole,
            billingPreference = 'monthly'
        } = body;

        if (!repoFullName || !repoFullName.includes('/')) {
            return NextResponse.json({ success: false, error: 'Invalid repository name' }, { status: 400 });
        }
        if (!projectName || !projectName.trim()) {
            return NextResponse.json({ success: false, error: 'Project name is required' }, { status: 400 });
        }

        const [owner, repo] = repoFullName.split('/');
        const client = new GitHubClient(token);

        // 1. Discover module and obtain sorted files
        const fluxModule = await client.discoverFluxbaseModule(owner, repo, branch, modulePath);
        if (!fluxModule.found || fluxModule.files.length === 0) {
            return NextResponse.json({
                success: false,
                error: `No .sql files found in directory "${modulePath}" of repository ${repoFullName}`
            }, { status: 404 });
        }

        // 2. Enforce 2MB total limit
        const MAX_TOTAL_SIZE = 2 * 1024 * 1024; // 2MB
        if (fluxModule.totalSizeBytes > MAX_TOTAL_SIZE) {
            return NextResponse.json({
                success: false,
                error: `SQL files exceed the 2MB import limit (${Math.round(fluxModule.totalSizeBytes / 1024)}KB total). Please reduce file sizes.`
            }, { status: 400 });
        }

        // 3. Create Project record
        const chosenDialect = (dialect === 'mysql' ? 'mysql' : 'postgresql');
        const project = await createProject(
            projectName.trim(),
            fluxModule.manifest?.description || `Imported from ${repoFullName}@${branch} (${modulePath})`,
            chosenDialect,
            timezone,
            'internal',
            {},
            userRole,
            userId
        );
        createdProjectId = project.project_id;

        // 4. Provision Tenant Schema
        const tenantResult = await TenantProvisioner.createTenantSchema(project.project_id, chosenDialect);
        const schemaName = tenantResult.schemaName;

        const pool = getPgPool();
        await pool.query(`
            UPDATE fluxbase_global.projects
            SET is_serverless = true,
                schema_name = $1,
                github_repo = $2,
                github_branch = $3,
                github_module_path = $4,
                imported_at = NOW(),
                last_synced_at = NOW(),
                import_source = 'github',
                billing_preference = $5
            WHERE project_id = $6
        `, [schemaName, repoFullName, branch, modulePath, billingPreference, project.project_id]);

        project.schema_name = schemaName;
        project.is_serverless = true;
        project.role = 'admin';
        project.github_repo = repoFullName;
        project.billing_preference = billingPreference;

        // 5. Download SQL files in parallel from GitHub
        const downloadedFiles = await Promise.all(
            fluxModule.files.map(async (file) => {
                try {
                    const { content, sha } = await client.getFileContent(owner, repo, file.path, branch);
                    return { file, content, sha, error: null };
                } catch (err: any) {
                    return { file, content: '', sha: '', error: err.message };
                }
            })
        );

        const fileResults: Array<{
            file: string;
            statementsExecuted: number;
            status: 'success' | 'error';
            error?: string;
            executionTimeMs: number;
        }> = [];

        let totalStatements = 0;
        const allCreatedTables: Set<string> = new Set();
        const errors: Array<{ file: string; error: string; statement?: string }> = [];

        if (chosenDialect === 'postgresql') {
            const pgClient = await pool.connect();
            try {
                // Ensure search path is always scoped to tenant schema
                await pgClient.query(`SET search_path TO "${schemaName}", public;`);

                for (const item of downloadedFiles) {
                    const { file, content, sha, error: downloadError } = item;
                    const fileStartTime = Date.now();

                    if (downloadError) {
                        logger.error(`[SQL Import] Failed to download ${file.name}:`, downloadError);
                        errors.push({ file: file.name, error: downloadError });
                        fileResults.push({
                            file: file.name,
                            statementsExecuted: 0,
                            status: 'error',
                            error: downloadError,
                            executionTimeMs: Date.now() - fileStartTime
                        });
                        continue;
                    }

                    try {
                        const statements = splitSqlStatements(content);
                        const tables = parseCreateTables(content);
                        tables.forEach(t => allCreatedTables.add(t.tableName));

                        let fileStmtsExecuted = 0;
                        for (const stmt of statements) {
                            try {
                                await pgClient.query(stmt);
                                fileStmtsExecuted++;
                                totalStatements++;
                                migrationsExecuted = true;
                            } catch (stmtErr: any) {
                                logger.error(`[SQL Import] Error in file ${file.name} on statement:`, stmtErr.message);
                                errors.push({
                                    file: file.name,
                                    error: stmtErr.message,
                                    statement: stmt.slice(0, 200)
                                });
                            }
                        }

                        const fileDuration = Date.now() - fileStartTime;
                        const status = errors.some(e => e.file === file.name) ? 'error' : 'success';

                        // Log to import_logs
                        await pool.query(`
                            INSERT INTO fluxbase_global.import_logs (
                                project_id, user_id, repo_full_name, branch, module_path,
                                file_name, file_sha, status, statements_executed, error_message, execution_time_ms
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        `, [
                            project.project_id, userId, repoFullName, branch, modulePath,
                            file.name, sha, status, fileStmtsExecuted,
                            errors.find(e => e.file === file.name)?.error || null,
                            fileDuration
                        ]);

                        fileResults.push({
                            file: file.name,
                            statementsExecuted: fileStmtsExecuted,
                            status,
                            error: errors.find(e => e.file === file.name)?.error,
                            executionTimeMs: fileDuration
                        });

                    } catch (fetchErr: any) {
                        logger.error(`[SQL Import] Failed to execute ${file.name}:`, fetchErr);
                        errors.push({ file: file.name, error: fetchErr.message });
                        fileResults.push({
                            file: file.name,
                            statementsExecuted: 0,
                            status: 'error',
                            error: fetchErr.message,
                            executionTimeMs: Date.now() - fileStartTime
                        });
                    }
                }
            } finally {
                pgClient.release();
            }
        } else {
            // MySQL Dialect execution
            const { getMysqlPool } = await import('@/lib/mysql');
            const mysqlPool = getMysqlPool();
            const conn = await mysqlPool.getConnection();

            try {
                await conn.query(`USE \`${schemaName}\`;`);

                for (const item of downloadedFiles) {
                    const { file, content, sha, error: downloadError } = item;
                    const fileStartTime = Date.now();

                    if (downloadError) {
                        errors.push({ file: file.name, error: downloadError });
                        fileResults.push({
                            file: file.name,
                            statementsExecuted: 0,
                            status: 'error',
                            error: downloadError,
                            executionTimeMs: Date.now() - fileStartTime
                        });
                        continue;
                    }

                    try {
                        const statements = splitSqlStatements(content);
                        const tables = parseCreateTables(content);
                        tables.forEach(t => allCreatedTables.add(t.tableName));

                        let fileStmtsExecuted = 0;
                        for (const stmt of statements) {
                            try {
                                await conn.query(stmt as any);
                                fileStmtsExecuted++;
                                totalStatements++;
                                migrationsExecuted = true;
                            } catch (stmtErr: any) {
                                logger.error(`[MySQL Import] Error in file ${file.name}:`, stmtErr.message);
                                errors.push({
                                    file: file.name,
                                    error: stmtErr.message,
                                    statement: stmt.slice(0, 200)
                                });
                            }
                        }

                        const fileDuration = Date.now() - fileStartTime;
                        const status = errors.some(e => e.file === file.name) ? 'error' : 'success';

                        // Log to import_logs
                        await pool.query(`
                            INSERT INTO fluxbase_global.import_logs (
                                project_id, user_id, repo_full_name, branch, module_path,
                                file_name, file_sha, status, statements_executed, error_message, execution_time_ms
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        `, [
                            project.project_id, userId, repoFullName, branch, modulePath,
                            file.name, sha, status, fileStmtsExecuted,
                            errors.find(e => e.file === file.name)?.error || null,
                            fileDuration
                        ]);

                        fileResults.push({
                            file: file.name,
                            statementsExecuted: fileStmtsExecuted,
                            status,
                            error: errors.find(e => e.file === file.name)?.error,
                            executionTimeMs: fileDuration
                        });

                    } catch (fetchErr: any) {
                        errors.push({ file: file.name, error: fetchErr.message });
                        fileResults.push({
                            file: file.name,
                            statementsExecuted: 0,
                            status: 'error',
                            error: fetchErr.message,
                            executionTimeMs: Date.now() - fileStartTime
                        });
                    }
                }
            } finally {
                conn.release();
            }
        }

        const totalExecutionTimeMs = Date.now() - startTime;

        try {
            const { invalidateProjectCache } = await import('@/lib/data');
            await invalidateProjectCache(project.project_id);
            if (allCreatedTables.size > 0) {
                const { invalidateTableCache } = await import('@/lib/cache');
                for (const tbl of allCreatedTables) {
                    await invalidateTableCache(project.project_id, tbl);
                }
            }
        } catch (cacheErr) {
            logger.warn('[GitHub Import API] Cache invalidation warning:', cacheErr);
        }

        return NextResponse.json({
            success: true,
            project,
            importResults: {
                filesExecuted: fileResults.filter(f => f.status === 'success').length,
                totalFiles: fluxModule.files.length,
                totalStatements,
                tablesCreated: Array.from(allCreatedTables),
                errors,
                fileResults,
                executionTimeMs: totalExecutionTimeMs
            }
        });

    } catch (err: any) {
        logger.error('[GitHub Import API] Unexpected exception:', err);
        if (createdProjectId && !migrationsExecuted) {
            try {
                const pool = getPgPool();
                await pool.query('DELETE FROM fluxbase_global.projects WHERE project_id = $1', [createdProjectId]);
                logger.info(`[GitHub Import API] Cleaned up aborted project record ${createdProjectId}`);
            } catch (cleanupErr) {
                logger.error('[GitHub Import API] Cleanup of failed project record error:', cleanupErr);
            }
        }
        return NextResponse.json({
            success: false,
            error: err.message || 'Import failed'
        }, { status: 500 });
    }
}
