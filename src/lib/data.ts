'use server';

import { getPgPool } from '@/lib/pg';
import { getCurrentUserId } from '@/lib/auth';
import { getTenantPgPool, getTenantMysqlPool, getProjectDbAndSchema } from '@/lib/tenant-pools';
import { 
    safeSql, 
    toSafeSql, 
    quotePgIdentifierSafe, 
    quoteMysqlIdentifierSafe, 
    quotePgProjectSchemaSafe, 
    quoteMysqlProjectSchemaSafe,
    type SafeSqlFragment
} from '@/lib/safe-sql';

// --- Types ---

export interface Project {
    project_id: string;
    user_id: string;
    display_name: string;
    description?: string;
    created_at: string;
    dialect?: 'mysql' | 'postgresql' | 'oracle';
    timezone?: string;
    role?: string;
    creator_role?: 'student' | 'employee' | 'org_owner' | string;
    billing_preference?: 'monthly' | 'pay_as_you_go' | 'hybrid' | string;
    ai_allow_destructive?: boolean;
    ai_schema_inference?: boolean;
    status?: 'active' | 'suspended';
    connection_type?: 'internal' | 'external_db' | 'external_server' | 'serverless';
    connection_config?: any;
    active_db?: string;
    github_repo?: string;
    github_branch?: string;
    github_module_path?: string;
    imported_at?: string;
    last_synced_at?: string;
    import_source?: string;
    schema_name?: string;
    is_serverless?: boolean;
}

export interface Table {
    table_id: string;
    project_id: string;
    table_name: string;
    description: string;
    created_at: string;
    updated_at: string;
}

export interface Column {
    id?: string;
    column_id: string;
    table_id: string;
    column_name: string;
    data_type: 'INT' | 'VARCHAR' | 'BOOLEAN' | 'DATE' | 'TIMESTAMP' | 'FLOAT' | 'TEXT' |
    'int' | 'varchar' | 'boolean' | 'date' | 'timestamp' | 'float' | 'text' | 'number' |
    'gen_random_uuid()' | 'now_date()' | 'now_time()';
    is_primary_key: boolean;
    is_nullable: boolean;
    default_value?: string;
    created_at?: string;
}

export interface Row {
    id: string;
    [key: string]: any;
}

export type ConstraintType = 'PRIMARY KEY' | 'FOREIGN KEY';
export type ReferentialAction = 'CASCADE' | 'SET NULL' | 'RESTRICT';

export interface Constraint {
    constraint_id: string;
    table_id: string;
    type: ConstraintType;
    column_names: string;
    referenced_table_id?: string;
    referenced_column_names?: string;
    on_delete?: ReferentialAction;
    on_update?: ReferentialAction;
}

/**
 * Utility to verify if the user has appropriate permissions for a project resource.
 * Must be async to be exported from a 'use server' file in Next.js.
 */
export async function ensureRole(project: Project | null, allowedRoles: string[]): Promise<Project> {
    if (!project) throw new FluxbaseError("Project not found or access denied.", ERROR_CODES.PROJECT_NOT_FOUND, 404);
    if (!project.role || !allowedRoles.includes(project.role)) {
        throw new FluxbaseError(`Insufficient Permissions: Your role (${project.role || 'none'}) does not have permission to perform this action. Required: ${allowedRoles.join(', ')}`, ERROR_CODES.FORBIDDEN, 403);
    }
    return project;
}

import crypto from 'crypto';
import { validateRow } from '@/lib/validation';
import { fireWebhooks } from '@/lib/webhooks';
import { revalidateTag } from 'next/cache';
import { LRUCache } from 'lru-cache';
import { FluxbaseError, ERROR_CODES } from '@/lib/error-codes';

// Short-lived cache: eliminates the duplicate getProjectById DB query that fires
// on EVERY table-data, execute-sql, and schema API call. 60s TTL is safe because
// project metadata (display_name, dialect, role) almost never changes mid-session.
const _projectCache = new LRUCache<string, Project>({ max: 200, ttl: 60_000 });

// Caches primary key column names per table (eliminates information_schema join on every row fetch)
const _tablePkCache = new LRUCache<string, string>({ max: 500, ttl: 3600_000 });

// Caches row counts per table (60s TTL prevents full table scans on every page load/refresh)
const _tableCountCache = new LRUCache<string, number>({ max: 500, ttl: 60_000 });

// Caches resolved schema per table
const _schemaCache = new LRUCache<string, string>({ max: 500, ttl: 3600_000 });

// Caches tables list per project (15s TTL makes switching tables in the editor instantaneous)
const _projectTablesCache = new LRUCache<string, Table[]>({ max: 200, ttl: 15_000 });

// Caches table columns (60s TTL prevents repeating column introspection queries on every page render)
const _tableColumnsCache = new LRUCache<string, Column[]>({ max: 500, ttl: 60_000 });

// Caches user projects list (15s TTL prevents repeated DB hits on rapid page reloads)
const _userProjectsCache = new LRUCache<string, Project[]>({ max: 200, ttl: 15_000 });

// Caches user pending invitations (30s TTL prevents repeated DB hits on rapid page reloads)
const _userInvitationsCache = new LRUCache<string, any[]>({ max: 200, ttl: 30_000 });

// Caches project table stats & analytics (60s TTL prevents repeating catalog introspection)
const _projectAnalyticsCache = new LRUCache<string, ProjectAnalytics>({ max: 200, ttl: 60_000 });

export async function invalidateUserProjectsCache(userId?: string) {
    if (userId) {
        _userProjectsCache.delete(userId);
        _userInvitationsCache.delete(userId);
    } else {
        _userProjectsCache.clear();
        _userInvitationsCache.clear();
    }
}

export async function invalidateTableCountCache(tableName?: string) {
    if (tableName) {
        for (const key of Array.from(_tableCountCache.keys())) {
            if (key.includes(`:${tableName}:`)) {
                _tableCountCache.delete(key);
            }
        }
        for (const key of Array.from(_tableColumnsCache.keys())) {
            if (key.includes(`:${tableName}`)) {
                _tableColumnsCache.delete(key);
            }
        }
    } else {
        _tableCountCache.clear();
        _projectTablesCache.clear();
        _tableColumnsCache.clear();
    }
}

// Terminal log throttling: avoids spamming the console 10 times a second during DNS outages.
let _lastHealthLogTime = 0;
const HEALTH_LOG_THROTTLE_MS = 60000;

export async function checkDatabaseHealthAction(): Promise<boolean> {
    try {
        const pool = getPgPool();
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Database health check timed out after 10s')), 10000)
        );

        await Promise.race([
            pool.query('SELECT 1'),
            timeoutPromise
        ]);

        return true;
    } catch (error: any) {
        const now = Date.now();
        if (now - _lastHealthLogTime > HEALTH_LOG_THROTTLE_MS) {
            console.error("[Health Check Failed]:", error?.message || error);
            _lastHealthLogTime = now;
        }
        return false;
    }
}


// --- Projects ---

export async function getProjectsForCurrentUser(overrideUserId?: string): Promise<Project[]> {
    const userId = overrideUserId || (await getCurrentUserId());
    if (!userId) return [];

    const cached = _userProjectsCache.get(userId);
    if (cached) return cached;

    try {
        const pool = getPgPool();
        const sqlQuery = `
            SELECT p.project_id, p.display_name, p.created_at, p.dialect, p.timezone, p.ai_allow_destructive, p.ai_schema_inference, p.status, p.creator_role, p.billing_preference,
                   p.connection_type, p.connection_config, p.schema_name, p.is_serverless, p.github_repo,
                   COALESCE(pm.role, CASE WHEN p.user_id = $1::text THEN 'admin' ELSE 'developer' END) as role
            FROM fluxbase_global.projects p
            LEFT JOIN fluxbase_global.project_members pm ON p.project_id = pm.project_id AND pm.user_id = $1::text
            WHERE p.user_id = $1::text OR pm.user_id = $1::text
            ORDER BY p.created_at DESC
        `;

        let result;
        try {
            result = await pool.query(sqlQuery, [userId]);
        } catch (initialErr: any) {
            // If connection was dropped/timed out by AWS RDS idle timer, retry once cleanly
            if (initialErr?.message?.includes('Connection') || initialErr?.code === '57P01' || initialErr?.code === 'ECONNRESET') {
                await new Promise(res => setTimeout(res, 300));
                result = await pool.query(sqlQuery, [userId]);
            } else {
                throw initialErr;
            }
        }

        const projects = result.rows.map(row => ({
            project_id: row.project_id,
            user_id: userId,
            display_name: row.display_name,
            description: '',
            created_at: row.created_at.toISOString(),
            dialect: row.dialect,
            timezone: row.timezone,
            role: row.role,
            creator_role: row.creator_role || 'student',
            billing_preference: row.billing_preference || 'monthly',
            ai_allow_destructive: row.ai_allow_destructive ?? false,
            ai_schema_inference: row.ai_schema_inference ?? true,
            status: row.status || 'active',
            connection_type: row.connection_type || 'internal',
            connection_config: row.connection_config || {},
            schema_name: row.schema_name,
            is_serverless: row.is_serverless,
            github_repo: row.github_repo
        }));
        _userProjectsCache.set(userId, projects);
        return projects;
    } catch (error) {
        console.error("Error fetching projects:", error);
        return [];
    }
}

export async function getPendingInvitationsForCurrentUser(): Promise<any[]> {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    const cached = _userInvitationsCache.get(userId);
    if (cached) return cached;

    try {
        const pool = getPgPool();
        // Single optimized query joining user and pending invitations in one database roundtrip
        const result = await pool.query(`
            SELECT pi.id, pi.role, pi.created_at as "invitedAt",
                   COALESCE(p.display_name, 'Unknown Project') as "projectName", 
                   COALESCE(u_inv.display_name, 'A team member') as "inviterName",
                   pi.status
            FROM fluxbase_global.project_invitations pi
            JOIN fluxbase_global.users u_target ON LOWER(pi.email) = LOWER(u_target.email)
            LEFT JOIN fluxbase_global.projects p ON p.project_id = pi.project_id
            LEFT JOIN fluxbase_global.users u_inv ON u_inv.id = pi.invited_by
            WHERE u_target.id = $1::text
            ORDER BY pi.created_at DESC
        `, [userId]);

        const pending = result.rows.filter(r => r.status === 'pending' || r.status === null);
        _userInvitationsCache.set(userId, pending);
        return pending;
    } catch (error) {
        console.error("Error fetching pending invitations:", error);
        return [];
    }
}
let migrationRun = false;
async function ensureMigration(pool: any) {
    if (migrationRun) return;
    try {
        await pool.query(`
            ALTER TABLE fluxbase_global.projects 
                ADD COLUMN IF NOT EXISTS is_serverless BOOLEAN DEFAULT false,
                ADD COLUMN IF NOT EXISTS schema_name VARCHAR(128),
                ADD COLUMN IF NOT EXISTS connection_type VARCHAR(50) DEFAULT 'internal',
                ADD COLUMN IF NOT EXISTS connection_config JSONB DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
                ADD COLUMN IF NOT EXISTS github_repo VARCHAR(255),
                ADD COLUMN IF NOT EXISTS github_branch VARCHAR(128),
                ADD COLUMN IF NOT EXISTS github_module_path VARCHAR(255),
                ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP WITH TIME ZONE,
                ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE,
                ADD COLUMN IF NOT EXISTS import_source VARCHAR(32);

            CREATE TABLE IF NOT EXISTS fluxbase_global.github_tokens (
                user_id VARCHAR(64) PRIMARY KEY,
                encrypted_token TEXT NOT NULL,
                token_iv VARCHAR(32) NOT NULL,
                scopes TEXT DEFAULT 'repo',
                github_username VARCHAR(255),
                connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                last_used_at TIMESTAMP WITH TIME ZONE
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.import_logs (
                id SERIAL PRIMARY KEY,
                project_id VARCHAR(32) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                repo_full_name VARCHAR(255) NOT NULL,
                branch VARCHAR(128) DEFAULT 'main',
                module_path VARCHAR(255) DEFAULT 'fluxbase',
                file_name VARCHAR(255) NOT NULL,
                file_sha VARCHAR(64),
                status VARCHAR(16) NOT NULL,
                statements_executed INTEGER DEFAULT 0,
                error_message TEXT,
                execution_time_ms INTEGER,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_import_logs_project ON fluxbase_global.import_logs(project_id);

            CREATE TABLE IF NOT EXISTS fluxbase_global.plans (
                id SERIAL PRIMARY KEY,
                plan_key VARCHAR(64) UNIQUE NOT NULL,
                name VARCHAR(128) NOT NULL,
                description TEXT,
                category VARCHAR(64) DEFAULT 'student',
                price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                billing_interval VARCHAR(32) DEFAULT 'monthly',
                max_projects INT DEFAULT 1,
                storage_bytes BIGINT DEFAULT 524288000,
                requests_limit INT DEFAULT 50000,
                max_connections INT DEFAULT 20,
                features JSONB DEFAULT '[]'::jsonb,
                is_active BOOLEAN DEFAULT true,
                sort_order INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.discounts (
                id SERIAL PRIMARY KEY,
                code VARCHAR(64) UNIQUE NOT NULL,
                description TEXT,
                discount_type VARCHAR(32) NOT NULL DEFAULT 'percentage',
                discount_value NUMERIC(10, 2) NOT NULL DEFAULT 20.00,
                applicable_plans JSONB DEFAULT '["all"]'::jsonb,
                min_order_amount NUMERIC(10, 2) DEFAULT 0.00,
                max_discount_amount NUMERIC(10, 2) DEFAULT 1000.00,
                is_active BOOLEAN DEFAULT true,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.pricing_configs (
                id SERIAL PRIMARY KEY,
                pro_price NUMERIC(10, 2) DEFAULT 999.00,
                max_price NUMERIC(10, 2) DEFAULT 2499.00,
                discount_pro_price NUMERIC(10, 2) DEFAULT 499.00,
                discount_max_price NUMERIC(10, 2) DEFAULT 1499.00,
                enable_discount BOOLEAN DEFAULT true,
                discount_code VARCHAR(50) DEFAULT 'PROMO50',
                upi_id VARCHAR(255) DEFAULT 'sumith0909@axl',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            ALTER TABLE fluxbase_global.pricing_configs ADD COLUMN IF NOT EXISTS upi_id VARCHAR(255) DEFAULT 'sumith0909@axl';

            CREATE TABLE IF NOT EXISTS fluxbase_global.bank_payments (
                utr VARCHAR(64) PRIMARY KEY,
                amount NUMERIC(10, 2) NOT NULL,
                day_name VARCHAR(10) NOT NULL,
                payment_date DATE NOT NULL,
                payment_time TIME NOT NULL,
                source VARCHAR(30) NOT NULL,
                order_id VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.pending_orders (
                order_id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                amount NUMERIC(10, 2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                utr_number VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                fulfilled_at TIMESTAMP WITH TIME ZONE
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id VARCHAR(255),
                user_id VARCHAR(255),
                action VARCHAR(50),
                statement TEXT,
                metadata JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.analytics_rollups (
                id SERIAL PRIMARY KEY,
                project_id VARCHAR(255) NOT NULL,
                period_start TIMESTAMP WITH TIME ZONE NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                count BIGINT NOT NULL DEFAULT 0,
                UNIQUE(project_id, period_start, event_type)
            );

            CREATE TABLE IF NOT EXISTS fluxbase_global.ai_error_memory (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id VARCHAR(255),
                dialect VARCHAR(50) NOT NULL DEFAULT 'postgresql',
                error_category VARCHAR(50) NOT NULL,
                error_message TEXT NOT NULL,
                failed_input TEXT NOT NULL,
                resolution_fix TEXT NOT NULL,
                occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                success_count INT DEFAULT 1
            );

            CREATE INDEX IF NOT EXISTS idx_error_mem_dialect ON fluxbase_global.ai_error_memory (dialect, error_category);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_project_created ON fluxbase_global.audit_logs (project_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_analytics_rollups_project_period ON fluxbase_global.analytics_rollups (project_id, period_start DESC);
            CREATE INDEX IF NOT EXISTS idx_projects_user_id ON fluxbase_global.projects (user_id);
            CREATE INDEX IF NOT EXISTS idx_project_members_user ON fluxbase_global.project_members (user_id);
        `);
        migrationRun = true;
    } catch (err) {
        console.error("[Migration Error] Failed to execute schema migrations:", err);
    }
}

export async function getProjectById(projectId: string, explicitUserId?: string): Promise<Project | null> {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) return null;

    // Cache key includes userId so role (admin/developer/member) is correctly scoped per user.
    const cacheKey = `${projectId}:${userId}`;
    const cached = _projectCache.get(cacheKey);
    let project: Project | null = null;

    if (cached !== undefined) {
        project = cached;
    } else {
        try {
            const { redis } = await import('@/lib/redis');
            const redisKey = `project_meta:${projectId}:${userId}`;
            const redisCached = await redis.get<Project>(redisKey);
            if (redisCached) {
                _projectCache.set(cacheKey, redisCached);
                project = redisCached;
            } else {
                const pool = getPgPool();
                await ensureMigration(pool);
                const result = await pool.query(`
                    SELECT p.project_id, p.display_name, p.created_at, p.dialect, p.timezone, p.user_id as owner_id, p.ai_allow_destructive, p.ai_schema_inference, p.status, p.creator_role, p.billing_preference,
                           p.connection_type, p.connection_config, p.schema_name, p.is_serverless, p.github_repo, p.github_branch, p.github_module_path, p.imported_at, p.last_synced_at, p.import_source,
                           COALESCE(pm.role, CASE WHEN p.user_id = $2::text THEN 'admin' ELSE NULL END) as role
                    FROM fluxbase_global.projects p
                    LEFT JOIN fluxbase_global.project_members pm ON p.project_id = pm.project_id AND pm.user_id = $2::text
                    WHERE p.project_id = $1 AND (p.user_id = $2::text OR pm.user_id = $2::text)
                `, [projectId, userId]);
                if (result.rows.length === 0) {
                    return null;
                }

                const row = result.rows[0];
                const newProject: Project = {
                    project_id: row.project_id,
                    user_id: row.owner_id,
                    display_name: row.display_name,
                    description: '',
                    created_at: row.created_at.toISOString(),
                    dialect: row.dialect,
                    timezone: row.timezone,
                    role: row.role,
                    creator_role: row.creator_role || 'student',
                    billing_preference: row.billing_preference || 'monthly',
                    ai_allow_destructive: row.ai_allow_destructive ?? false,
                    ai_schema_inference: row.ai_schema_inference ?? true,
                    status: row.status || 'active',
                    connection_type: row.connection_type || 'internal',
                    connection_config: row.connection_config || {},
                    schema_name: row.schema_name,
                    is_serverless: row.is_serverless,
                    github_repo: row.github_repo,
                    github_branch: row.github_branch,
                    github_module_path: row.github_module_path,
                    imported_at: row.imported_at ? row.imported_at.toISOString() : undefined,
                    last_synced_at: row.last_synced_at ? row.last_synced_at.toISOString() : undefined,
                    import_source: row.import_source
                };
                _projectCache.set(cacheKey, newProject);
                await redis.set(redisKey, newProject, { ex: 300 }); // Cache in Redis for 5 minutes
                project = newProject;
            }
        } catch (error) {
            console.error("Error fetching project:", error);
            return null;
        }
    }

    if (project) {
        // Clone project object so we don't mutate the cached entry shared across other request threads
        project = { ...project };
        try {
            const { cookies } = require('next/headers');
            const cookieStore = await cookies();
            const activeDb = cookieStore.get(`fluxbase_active_db_${projectId}`)?.value;
            if (activeDb) {
                project.active_db = activeDb;
            }
        } catch {
            // ignore: not in request context
        }
    }

    return project;
}

/**
 * Invalidates the project cache for a specific project.
 * Useful when status or metadata changes.
 */
export async function invalidateProjectCache(projectId: string) {
    // Since cache keys are composite (projectId:userId), we iterate and clear all for this projectId.
    // Optimization: Only iterate if we have entries.
    if (_projectCache.size > 0) {
        const keys = _projectCache.keys();
        for (const key of keys) {
            if (key.startsWith(`${projectId}:`)) {
                _projectCache.delete(key);
            }
        }
    }

    // Invalidate Redis cache
    try {
        const { redis } = await import('@/lib/redis');
        const keys = await redis.keys(`project_meta:${projectId}:*`);
        if (keys && keys.length > 0) {
            await redis.del(...keys);
        }
    } catch (e) {
        console.warn('[Redis Error] invalidateProjectCache failed:', e);
    }
}

/**
 * Checks if a project or its owner (organization) is suspended.
 * Throws a FluxbaseError if access should be blocked.
 */
export async function ensureNotSuspended(project: Project | null) {
    if (!project) return; // Let 404 handler take care of it if applicable

    const { redis } = await import('./redis');

    // 1. Check Project Level (Redis Cache First)
    let projectStatus = project.status;
    const redisProjectStatus = await redis.get<string>(`project_status:${project.project_id}`);
    if (redisProjectStatus) {
        projectStatus = redisProjectStatus as any;
    }

    if (projectStatus === 'suspended') {
        const { ERROR_CODES, FluxbaseError } = await import('./error-codes');
        throw new FluxbaseError(
            `Project '${project.display_name}' is currently suspended. Please resume it in Settings.`,
            ERROR_CODES.FORBIDDEN,
            403
        );
    }

    // 2. Check Organization (User) Level (Redis Cache First)
    let orgStatus: string = 'active';
    const redisOrgStatus = await redis.get<string>(`org_status:${project.user_id}`);
    
    if (redisOrgStatus) {
        orgStatus = redisOrgStatus;
    } else {
        // Fallback to DB and cache in Redis for next time
        try {
            const pool = (await import('./pg')).getPgPool();
            const { rows } = await pool.query('SELECT status FROM fluxbase_global.users WHERE id = $1', [project.user_id]);
            orgStatus = rows[0]?.status || 'active';
            await redis.set(`org_status:${project.user_id}`, orgStatus, { ex: 300 }); // Cache for 5 mins
        } catch (e) {
            console.error('[Suspension Check Error] Falling back to active:', e);
        }
    }

    if (orgStatus === 'suspended') {
        const { ERROR_CODES, FluxbaseError } = await import('./error-codes');
        throw new FluxbaseError(
            "Your organization is currently suspended. Database access and webhooks are disabled.",
            ERROR_CODES.FORBIDDEN,
            403
        );
    }
}


// --- User Profile ---

export async function getUserProfile(userId: string) {
    try {
        const pool = getPgPool();
        const result = await pool.query('SELECT id, email, display_name, photo_url, created_at FROM fluxbase_global.users WHERE id = $1::text', [userId]);
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return null;
    }
}

export async function createUserProfile(userId: string, email: string, displayName?: string, photoURL?: string) {
    // Mostly handled by native signupAction now, but here for compatibility
    const pool = getPgPool();
    try {
        await pool.query(
            'INSERT INTO fluxbase_global.users (id, email, display_name, photo_url) VALUES ($1::text, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
            [userId, email, displayName || email.split('@')[0], photoURL || null]
        );
    } catch (error) {
        console.error("createUserProfile error:", error);
        throw error;
    }
}

export async function updateUserProfile(userId: string, displayName?: string, photoURL?: string) {
    const pool = getPgPool();
    const updates: string[] = [];
    const values: any[] = [userId];
    let idx = 2;

    if (displayName) {
        updates.push(`display_name = $${idx++}`);
        values.push(displayName);
    }
    if (photoURL) {
        updates.push(`photo_url = $${idx++}`);
        values.push(photoURL);
    }

    if (updates.length > 0) {
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        const query = `UPDATE fluxbase_global.users SET ${updates.join(', ')} WHERE id = $1::text`;
        await pool.query(query, values);
    }
}

export async function ensureUserProfile(userId: string, email: string, displayName?: string, photoURL?: string) {
    const profile = await getUserProfile(userId);
    if (!profile) {
        await createUserProfile(userId, email, displayName, photoURL);
    } else {
        await updateUserProfile(userId, displayName, photoURL);
    }
}


export async function createProject(
    name: string, 
    description: string, 
    dialect: string = 'postgresql', 
    timezone?: string,
    connectionType: 'internal' | 'external_db' | 'external_server' = 'internal',
    connectionConfig: any = {},
    userRole?: 'student' | 'employee' | 'org_owner' | string,
    overrideUserId?: string
): Promise<Project> {
    const userId = overrideUserId || (await getCurrentUserId());
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const pool = getPgPool();
    await ensureMigration(pool);

    // Fetch Subscription Plan from DB
    const userSnapshot = await pool.query('SELECT plan_type FROM fluxbase_global.users WHERE id = $1::text', [userId]);
    const planType = userSnapshot.rows[0]?.plan_type || 'free';

    let maxProjects = 1;
    try {
        const planDbRes = await pool.query('SELECT max_projects FROM fluxbase_global.plans WHERE plan_key = $1', [planType]);
        if (planDbRes.rows.length > 0 && planDbRes.rows[0].max_projects) {
            maxProjects = parseInt(planDbRes.rows[0].max_projects, 10);
        } else {
            if (planType === 'pro') maxProjects = 3;
            else if (planType === 'max' || planType === 'org_owner') maxProjects = 999999;
            else if (planType === 'employee' || planType === 'pay_as_you_go') maxProjects = 10;
        }
    } catch {
        if (planType === 'pro') maxProjects = 3;
        else if (planType === 'max' || planType === 'org_owner') maxProjects = 999999;
        else if (planType === 'employee' || planType === 'pay_as_you_go') maxProjects = 10;
    }

    // Check limit
    const projectsSnapshot = await pool.query('SELECT COUNT(*) as count FROM fluxbase_global.projects WHERE user_id = $1::text', [userId]);
    const count = parseInt(projectsSnapshot.rows[0].count);
    if (count >= maxProjects) {
        throw new FluxbaseError(`Project limit reached. Your ${planType.toUpperCase()} plan only allows ${maxProjects} project(s). Please upgrade your subscription to create more.`, ERROR_CODES.RATE_LIMIT_EXCEEDED, 429);
    }

    const projectId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    const finalTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    await pool.query(
        'INSERT INTO fluxbase_global.projects (project_id, user_id, display_name, dialect, timezone, connection_type, connection_config) VALUES ($1, $2::text, $3, $4, $5, $6, $7)',
        [projectId, userId, name, dialect, finalTimezone, connectionType, typeof connectionConfig === 'string' ? connectionConfig : JSON.stringify(connectionConfig)]
    );

    // Persist user role in Fluxbase database (Student / Employee / Org Owner)
    if (userRole) {
        try {
            await pool.query('UPDATE fluxbase_global.users SET user_role = $1 WHERE id = $2', [userRole, userId]);
            await pool.query('UPDATE fluxbase_global.projects SET creator_role = $1 WHERE project_id = $2', [userRole, projectId]);
        } catch (roleErr) {
            console.warn('[Role Save] Non-critical role update error:', roleErr);
        }
    }

    const project: Project = {
        project_id: projectId,
        user_id: userId,
        display_name: name,
        created_at: new Date().toISOString(),
        dialect: dialect as any,
        timezone: finalTimezone,
        connection_type: connectionType,
        connection_config: connectionConfig,
        role: 'admin',
        schema_name: `flux_tenant_${projectId}`,
        is_serverless: true
    };

    // [AWS NATIVE MIGRATION] Automatically provision a dedicated Schema/DB for this tenant.
    if (connectionType === 'internal') {
        try {
            if (dialect.toLowerCase() === 'mysql') {
                const { getMysqlPool } = await import('@/lib/mysql');
                const mysqlPool = getMysqlPool();
                const safeDbName = quoteMysqlProjectSchemaSafe(projectId);
                await mysqlPool.query(safeSql`CREATE DATABASE ${safeDbName}`);
                console.log(`[Fluxbase Native] Successfully provisioned MySQL DB: project_${projectId}`);
            } else {
                // Default PostgreSQL Schema approach: provision isolated tenant schema
                const safeSchemaName = `flux_tenant_${projectId}`;
                await pool.query(`CREATE SCHEMA IF NOT EXISTS "${safeSchemaName}"`);
                console.log(`[Fluxbase Native] Successfully provisioned PG Schema: ${safeSchemaName}`);
            }
        } catch (dbError) {
            console.error(`[Fluxbase Native] Failed to provision native environment for project_${projectId}`, dbError);
        }
    }

    // Realtime notification broadcast for instant UI updates across all clients
    try {
        const notifyPayload = JSON.stringify({
            table: 'projects',
            action: 'INSERT',
            project_id: 'global',
            record: {
                project_id: projectId,
                user_id: userId,
                display_name: name,
                dialect,
                timezone: finalTimezone,
                connection_type: connectionType,
                created_at: project.created_at,
                role: 'admin',
                creator_role: userRole || 'student'
            }
        });
        await pool.query(`NOTIFY flux_realtime, '${notifyPayload.replace(/'/g, "''")}'`);
        await pool.query(`NOTIFY fluxbase_changes, '${notifyPayload.replace(/'/g, "''")}'`);
    } catch (notifyErr) {
        console.warn('[Realtime Projects NOTIFY Warning]:', notifyErr);
    }

    return project;
}

export async function resetProjectData(projectId: string) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const pool = getPgPool();
    const project = await ensureRole(await getProjectById(projectId, userId), ['admin']);

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const safeDbName = quoteMysqlIdentifierSafe(dbName);
        await mysqlPool.query(safeSql`DROP DATABASE IF EXISTS ${safeDbName}`);
        await mysqlPool.query(safeSql`CREATE DATABASE ${safeDbName}`);
    } else {
        const tenantPool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchemaName = quotePgIdentifierSafe(schemaName);
        // Drop and recreate schema to wipe all data natively
        await tenantPool.query(safeSql`DROP SCHEMA IF EXISTS ${safeSchemaName} CASCADE`);
        await tenantPool.query(safeSql`CREATE SCHEMA ${safeSchemaName}`);
    }

    try {
        const { redis } = await import('@/lib/redis');
        await redis.del(`schema_inference_${projectId}`);
    } catch { }
}

export async function updateProjectTimezone(projectId: string, timezone: string): Promise<boolean> {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    await ensureRole(await getProjectById(projectId, userId), ['admin']);

    const pool = getPgPool();
    await pool.query(
        'UPDATE fluxbase_global.projects SET timezone = $1 WHERE project_id = $2 AND user_id = $3::text',
        [timezone, projectId, userId]
    );

    return true;
}

export async function deleteProject(projectId: string) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin']);

    const pool = getPgPool();

    if (project.dialect?.toLowerCase() === 'mysql') {
        if (project.connection_type === 'internal') {
            const { getMysqlPool } = await import('@/lib/mysql');
            const mysqlPool = getMysqlPool();
            const safeDbName = quoteMysqlProjectSchemaSafe(projectId);
            await mysqlPool.query(safeSql`DROP DATABASE IF EXISTS ${safeDbName}`);
        }
    } else {
        if (project.connection_type === 'internal' || (project as any).is_serverless || (project as any).schema_name) {
            const safeSchemaName = quotePgProjectSchemaSafe(projectId);
            await pool.query(safeSql`DROP SCHEMA IF EXISTS ${safeSchemaName} CASCADE`);

            if ((project as any).schema_name) {
                const targetSafe = `"${(project as any).schema_name.replace(/"/g, '""')}"`;
                await pool.query(`DROP SCHEMA IF EXISTS ${targetSafe} CASCADE`);
            }

            const tenantSchema = `flux_tenant_${projectId}`;
            await pool.query(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE`);
        }
    }

    // Close tenant pool if it is cached
    const { closeTenantPool } = await import('@/lib/tenant-pools');
    await closeTenantPool(projectId);

    // Remove the catalog entry
    const res = await pool.query('DELETE FROM fluxbase_global.projects WHERE project_id = $1 AND user_id = $2::text', [projectId, userId]);
    if (res.rowCount === 0) {
        // User might be a member but not the owner. Delete from members instead.
        await pool.query('DELETE FROM fluxbase_global.project_members WHERE project_id = $1 AND user_id = $2::text', [projectId, userId]);
    }

    try {
        const { redis } = await import('@/lib/redis');
        await redis.del(`schema_inference_${projectId}`);
    } catch { }

    try {
        const notifyPayload = JSON.stringify({
            table: 'projects',
            action: 'DELETE',
            project_id: 'global',
            record: { project_id: projectId, user_id: userId }
        });
        await pool.query(`NOTIFY flux_realtime, '${notifyPayload.replace(/'/g, "''")}'`);
        await pool.query(`NOTIFY fluxbase_changes, '${notifyPayload.replace(/'/g, "''")}'`);
    } catch (notifyErr) {
        console.warn('[Realtime Projects DELETE NOTIFY Warning]:', notifyErr);
    }
}

// --- Tables ---

export async function getTablesForProject(projectId: string, explicitUserId?: string): Promise<Table[]> {
    const cachedTables = _projectTablesCache.get(projectId);
    if (cachedTables) return cachedTables;

    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await getProjectById(projectId, userId);
    if (!project) throw new FluxbaseError("Project not found or access denied.", ERROR_CODES.PROJECT_NOT_FOUND, 404);

    try {
        const isExternal = project.connection_type && project.connection_type !== 'internal';

        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);

            let [rows]: any = await mysqlPool.query(`
                SELECT DISTINCT table_name 
                FROM information_schema.tables 
                WHERE table_schema = ? AND table_type = 'BASE TABLE'
                AND table_name NOT LIKE '_flux_internal_%'
            `, [dbName || '']);

            if (isExternal && (!rows || rows.length === 0)) {
                // Fallback 1 for external DBs: Active DATABASE()
                try {
                    const [dbRes]: any = await mysqlPool.query(`SELECT DATABASE() as active_db`);
                    const activeDb = dbRes?.[0]?.active_db;
                    if (activeDb) {
                        [rows] = await mysqlPool.query(`
                            SELECT DISTINCT table_name 
                            FROM information_schema.tables 
                            WHERE table_schema = ? AND table_type = 'BASE TABLE'
                            AND table_name NOT LIKE '_flux_internal_%'
                        `, [activeDb]);
                    }
                } catch {}
            }

            if (isExternal && (!rows || rows.length === 0)) {
                // Fallback 2 for external DBs: All non-system MySQL databases
                [rows] = await mysqlPool.query(`
                    SELECT DISTINCT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') 
                    AND table_type = 'BASE TABLE'
                    AND table_name NOT LIKE '_flux_internal_%'
                `);
            }

            const tables = (rows || []).map((row: any) => ({
                table_id: row.TABLE_NAME || row.table_name,
                project_id: projectId,
                table_name: row.TABLE_NAME || row.table_name,
                description: "Managed by Fluxbase Native MySQL",
                created_at: project.created_at,
                updated_at: new Date().toISOString()
            }));
            _projectTablesCache.set(projectId, tables);
            return tables;

        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);

            let result;
            try {
                result = await pool.query(`
                    SELECT tablename as table_name 
                    FROM pg_tables 
                    WHERE schemaname = $1
                    AND tablename NOT LIKE '_flux_%'
                `, [schemaName]);
            } catch (err: any) {
                if (err?.message?.includes('Connection terminated') || err?.code === 'ECONNRESET') {
                    await new Promise(r => setTimeout(r, 500));
                    result = await pool.query(`
                        SELECT tablename as table_name 
                        FROM pg_tables 
                        WHERE schemaname = $1
                        AND tablename NOT LIKE '_flux_%'
                    `, [schemaName]);
                } else {
                    throw err;
                }
            }

            // Fallback 1: If 0 tables found and schemaName is project_*, check flux_tenant_* or vice-versa
            if (result.rows.length === 0) {
                const altSchema = schemaName.startsWith('project_')
                    ? `flux_tenant_${project.project_id}`
                    : `project_${project.project_id}`;
                if (altSchema !== schemaName) {
                    const altResult = await pool.query(`
                        SELECT tablename as table_name 
                        FROM pg_tables 
                        WHERE schemaname = $1
                        AND tablename NOT LIKE '_flux_%'
                    `, [altSchema]);
                    if (altResult.rows.length > 0) {
                        result = altResult;
                        try {
                            const globalPool = getPgPool();
                            await globalPool.query(
                                'UPDATE fluxbase_global.projects SET schema_name = $1 WHERE project_id = $2',
                                [altSchema, project.project_id]
                            );
                            project.schema_name = altSchema;
                        } catch (syncErr) {
                            console.warn('Failed to sync schema_name:', syncErr);
                        }
                    }
                }
            }

            if (isExternal && result.rows.length === 0 && schemaName !== 'public') {
                result = await pool.query(`
                    SELECT tablename as table_name 
                    FROM pg_tables 
                    WHERE schemaname = 'public'
                    AND tablename NOT LIKE '_flux_%'
                `);
            }

            const tables = result.rows.map(row => ({
                table_id: row.table_name,
                project_id: projectId,
                table_name: row.table_name,
                description: "Managed by Fluxbase Native Postgres",
                created_at: project.created_at,
                updated_at: new Date().toISOString()
            }));
            _projectTablesCache.set(projectId, tables);
            return tables;
        }
    } catch (error) {
        console.error("Error fetching tables:", error);
        return [];
    }
}

import { checkTableLimit } from '@/lib/limits';

export async function createTable(projectId: string, tableName: string, description: string, columns: Column[], explicitUserId?: string): Promise<Table> {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    await checkTableLimit(projectId, userId);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);

        const columnDefs: SafeSqlFragment[] = [];
        for (const col of columns) {
            let type = col.data_type.toUpperCase();
            if (type === 'NUMBER') type = 'DOUBLE';
            else if (type === 'VARCHAR') type = 'VARCHAR(255)';
            else if (type === 'BOOLEAN') type = 'TINYINT(1)';
            else if (type === 'UUID') type = 'CHAR(36)';
            else if (type === 'TIMETZ' || type === 'TIMESTAMPTZ') type = 'TIMESTAMP';
            else if (type === 'JSONB') type = 'JSON';
            else if (type.includes('[]')) type = 'JSON';

            if (!/^[A-Z0-9_()]+$/.test(type)) {
                throw new Error("Invalid data type: " + type);
            }

            const safeColName = quoteMysqlIdentifierSafe(col.column_name);
            let defStr = `${safeColName} ${type}`;

            if (col.is_primary_key) {
                if (type.includes('VARCHAR')) defStr = `${safeColName} VARCHAR(255) PRIMARY KEY`;
                else defStr += ' PRIMARY KEY';
            } else if (!col.is_nullable) {
                defStr += ' NOT NULL';
            }

            if (col.default_value) {
                if (col.default_value.includes('now()')) {
                    if (type === 'DATE') defStr += ' DEFAULT (CURRENT_DATE)';
                    else if (type === 'TIME') defStr += ' DEFAULT (CURRENT_TIME)';
                    else defStr += ' DEFAULT CURRENT_TIMESTAMP';
                }
                else if (col.default_value.includes('uuid()')) defStr += ' DEFAULT (UUID())';
                else {
                    const sanitizedDefault = col.default_value.replace(/'/g, "''");
                    defStr += ` DEFAULT '${sanitizedDefault}'`;
                }
            }
            columnDefs.push(toSafeSql(defStr));
        }

        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(tableName);
        const joinedDefs = toSafeSql(columnDefs.join(', '));
        const ddl = safeSql`CREATE TABLE ${safeDb}.${safeTable} (${joinedDefs})`;
        await mysqlPool.query(ddl);

    } else {
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);

        const columnDefs: SafeSqlFragment[] = [];
        for (const col of columns) {
            let type = col.data_type.toUpperCase();
            if (type === 'NUMBER') type = 'NUMERIC';
            else if (type === 'VARCHAR') type = 'VARCHAR(255)';

            if (!/^[A-Z0-9_()]+$/.test(type)) {
                throw new Error("Invalid data type: " + type);
            }

            const safeColName = quotePgIdentifierSafe(col.column_name);
            let defStr = `${safeColName} ${type}`;

            if (col.is_primary_key) {
                if (type === 'VARCHAR(255)') defStr = `${safeColName} VARCHAR(128) PRIMARY KEY`;
                else defStr += ' PRIMARY KEY';
            } else if (!col.is_nullable) {
                defStr += ' NOT NULL';
            }

            if (col.default_value) {
                if (col.default_value.includes('now()')) defStr += ' DEFAULT CURRENT_TIMESTAMP';
                else if (col.default_value.includes('uuid()')) defStr += ' DEFAULT gen_random_uuid()';
                else {
                    const sanitizedDefault = col.default_value.replace(/'/g, "''");
                    defStr += ` DEFAULT '${sanitizedDefault}'`;
                }
            }
            columnDefs.push(toSafeSql(defStr));
        }

        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(tableName);
        const joinedDefs = toSafeSql(columnDefs.join(', '));
        const ddl = safeSql`CREATE TABLE ${safeSchema}.${safeTable} (${joinedDefs})`;
        await pool.query(ddl);

        // --- Phase 2: PostgreSQL Realtime Event Trigger ---
        try {
            const safeTriggerName = quotePgIdentifierSafe(`${safeTableName}_ws_trigger`);
            const triggerFunctionSql = safeSql`
                CREATE OR REPLACE FUNCTION ${safeSchema}.notify_table_change()
                RETURNS trigger AS $$
                DECLARE
                  payload JSON;
                  row_data RECORD;
                BEGIN
                  IF TG_OP = 'DELETE' THEN
                    row_data := OLD;
                  ELSE
                    row_data := NEW;
                  END IF;

                  payload := json_build_object(
                    'table', TG_TABLE_NAME,
                    'project_id', '${toSafeSql(projectId.replace(/'/g, "''"))}',
                    'operation', TG_OP,
                    'data', row_to_json(row_data)
                  );

                  -- PostgreSQL NOTIFY has a hard limit of 8000 bytes.
                  -- If exceeded (e.g. large base64 strings, long JSON, binary data), send truncated payload so transaction never fails:
                  IF octet_length(payload::text) > 7500 THEN
                    payload := json_build_object(
                      'table', TG_TABLE_NAME,
                      'project_id', '${toSafeSql(projectId.replace(/'/g, "''"))}',
                      'operation', TG_OP,
                      'data', json_build_object('id', row_to_json(row_data)->'id'),
                      'truncated', true
                    );
                  END IF;

                  PERFORM pg_notify('flux_realtime', payload::text);
                  PERFORM pg_notify('fluxbase_changes', payload::text);
                  RETURN row_data;
                END;
                $$ LANGUAGE plpgsql;
            `;
            await pool.query(triggerFunctionSql);

            const attachTriggerSql = safeSql`
                DROP TRIGGER IF EXISTS ${safeTriggerName} ON ${safeSchema}.${safeTable};
                CREATE TRIGGER ${safeTriggerName}
                AFTER INSERT OR UPDATE OR DELETE
                ON ${safeSchema}.${safeTable}
                FOR EACH ROW
                EXECUTE FUNCTION ${safeSchema}.notify_table_change();
            `;
            await pool.query(attachTriggerSql);
        } catch (triggerError) {
            console.warn(`[Realtime Trigger Warning] Failed to provision triggers on external database for project ${projectId}:`, triggerError);
        }
    }

    const { invalidateTableCache } = await import('@/lib/cache');
    invalidateTableCache(projectId, safeTableName);

    return {
        table_id: safeTableName,
        project_id: projectId,
        table_name: safeTableName,
        description,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

export async function deleteTable(projectId: string, tableId: string, explicitUserId?: string) {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(tableId);
        await mysqlPool.query(safeSql`DROP TABLE IF EXISTS ${safeDb}.${safeTable}`);
    } else {
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(tableId);
        await pool.query(safeSql`DROP TABLE IF EXISTS ${safeSchema}.${safeTable} CASCADE`);
    }

    const { invalidateTableCache } = await import('@/lib/cache');
    invalidateTableCache(projectId, tableId);
}


// --- Columns ---

export async function getColumnsForTable(projectId: string, tableId: string, explicitUserId?: string): Promise<Column[]> {
    const safeTableName = tableId.replace(/[^a-zA-Z0-9_]/g, '');
    const cacheKey = `${projectId}:${safeTableName}`;
    const cachedCols = _tableColumnsCache.get(cacheKey);
    if (cachedCols) return cachedCols;

    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await getProjectById(projectId, userId);
    if (!project) throw new FluxbaseError("Project not found", ERROR_CODES.PROJECT_NOT_FOUND, 404);

    const isExternal = project.connection_type && project.connection_type !== 'internal';

    try {
        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);

            let [result]: any = await mysqlPool.query(`
                SELECT 
                    COLUMN_NAME as column_name, 
                    DATA_TYPE as data_type, 
                    IS_NULLABLE as is_nullable, 
                    COLUMN_DEFAULT as column_default,
                    CASE WHEN COLUMN_KEY = 'PRI' THEN true ELSE false END as is_primary_key
                FROM information_schema.columns 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                ORDER BY ORDINAL_POSITION
            `, [dbName || '', safeTableName]);

            if (isExternal && (!result || result.length === 0)) {
                // Fallback ONLY for external non-standard databases:
                [result] = await mysqlPool.query(`
                    SELECT 
                        COLUMN_NAME as column_name, 
                        DATA_TYPE as data_type, 
                        IS_NULLABLE as is_nullable, 
                        COLUMN_DEFAULT as column_default,
                        CASE WHEN COLUMN_KEY = 'PRI' THEN true ELSE false END as is_primary_key
                    FROM information_schema.columns 
                    WHERE TABLE_NAME = ? 
                    AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
                    ORDER BY ORDINAL_POSITION
                `, [safeTableName]);
            }

            const cols = (result || []).map((row: any) => ({
                column_id: row.column_name,
                table_id: safeTableName,
                column_name: row.column_name,
                data_type: row.data_type,
                is_nullable: row.is_nullable === 'YES',
                is_primary_key: row.is_primary_key === 1 || row.is_primary_key === true,
                default_value: row.column_default,
                created_at: new Date().toISOString()
            }));
            _tableColumnsCache.set(cacheKey, cols);
            return cols;

        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);

            // Fetch columns and identify primary keys using fast native catalog
            let result;
            try {
                result = await pool.query(`
                    SELECT
                        a.attname AS column_name,
                        format_type(a.atttypid, a.atttypmod) AS data_type,
                        NOT a.attnotnull AS is_nullable,
                        pg_get_expr(d.adbin, d.adrelid) AS column_default,
                        COALESCE(i.indisprimary, false) AS is_primary_key
                    FROM pg_attribute a
                    JOIN pg_class c ON c.oid = a.attrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                    LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND a.attnum = ANY(i.indkey) AND i.indisprimary
                    WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
                    ORDER BY a.attnum
                `, [schemaName, safeTableName]);
            } catch {
                result = { rows: [] };
            }

            if (result.rows.length === 0) {
                // Fallback to information_schema if table is not qualified by schemaName
                result = await pool.query(`
                    SELECT 
                        c.column_name, 
                        c.data_type, 
                        c.is_nullable, 
                        c.column_default,
                        (
                            SELECT count(*) > 0
                            FROM information_schema.key_column_usage kcu
                            JOIN information_schema.table_constraints tc 
                                ON kcu.constraint_name = tc.constraint_name
                            WHERE tc.constraint_type = 'PRIMARY KEY' 
                                AND kcu.table_schema = c.table_schema 
                                AND kcu.table_name = c.table_name 
                                AND kcu.column_name = c.column_name
                        ) as is_primary_key
                    FROM information_schema.columns c
                    WHERE c.table_schema = $1 AND c.table_name = $2
                    ORDER BY c.ordinal_position
                `, [schemaName, safeTableName]);
            }

            if (result.rows.length === 0) {
                const altSchema = schemaName.startsWith('project_')
                    ? `flux_tenant_${project.project_id}`
                    : `project_${project.project_id}`;
                if (altSchema !== schemaName) {
                    try {
                        const altResult = await pool.query(`
                            SELECT
                                a.attname AS column_name,
                                format_type(a.atttypid, a.atttypmod) AS data_type,
                                NOT a.attnotnull AS is_nullable,
                                pg_get_expr(d.adbin, d.adrelid) AS column_default,
                                COALESCE(i.indisprimary, false) AS is_primary_key
                            FROM pg_attribute a
                            JOIN pg_class c ON c.oid = a.attrelid
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                            LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND a.attnum = ANY(i.indkey) AND i.indisprimary
                            WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
                            ORDER BY a.attnum
                        `, [altSchema, safeTableName]);
                        if (altResult.rows.length > 0) {
                            result = altResult;
                        }
                    } catch {}
                }
            }

            if (isExternal && result.rows.length === 0 && schemaName !== 'public') {
                result = await pool.query(`
                    SELECT 
                        c.column_name, 
                        c.data_type, 
                        c.is_nullable, 
                        c.column_default,
                        (
                            SELECT count(*) > 0
                            FROM information_schema.key_column_usage kcu
                            JOIN information_schema.table_constraints tc 
                                ON kcu.constraint_name = tc.constraint_name
                            WHERE tc.constraint_type = 'PRIMARY KEY' 
                                AND kcu.table_schema = c.table_schema 
                                AND kcu.table_name = c.table_name 
                                AND kcu.column_name = c.column_name
                        ) as is_primary_key
                    FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = $1
                    ORDER BY c.ordinal_position
                `, [safeTableName]);
            }

            if (isExternal && result.rows.length === 0) {
                result = await pool.query(`
                    SELECT 
                        c.column_name, 
                        c.data_type, 
                        c.is_nullable, 
                        c.column_default,
                        (
                            SELECT count(*) > 0
                            FROM information_schema.key_column_usage kcu
                            JOIN information_schema.table_constraints tc 
                                ON kcu.constraint_name = tc.constraint_name
                            WHERE tc.constraint_type = 'PRIMARY KEY' 
                                AND kcu.table_schema = c.table_schema 
                                AND kcu.table_name = c.table_name 
                                AND kcu.column_name = c.column_name
                        ) as is_primary_key
                    FROM information_schema.columns c
                    WHERE c.table_name = $1 AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
                    ORDER BY c.ordinal_position
                `, [safeTableName]);
            }

            const cols = result.rows.map(row => ({
                column_id: row.column_name, // natively, name is ID
                table_id: safeTableName,
                column_name: row.column_name,
                data_type: row.data_type as any,
                is_nullable: row.is_nullable === 'YES',
                is_primary_key: row.is_primary_key,
                default_value: row.column_default,
                created_at: new Date().toISOString()
            }));
            _tableColumnsCache.set(cacheKey, cols);
            return cols;
        }
    } catch (error) {
        console.error("Native Get Columns Error:", error);
        return [];
    }
}

export async function addColumn(projectId: string, tableId: string, column: Omit<Column, 'column_id' | 'table_id'>, explicitUserId?: string) {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);

        let type = column.data_type.toUpperCase();
        if (type === 'NUMBER') type = 'DOUBLE';
        else if (type === 'VARCHAR') type = 'VARCHAR(255)';
        else if (type === 'BOOLEAN') type = 'TINYINT(1)';

        if (!/^[A-Z0-9_()]+$/.test(type)) {
            throw new Error("Invalid data type: " + type);
        }

        const safeColName = quoteMysqlIdentifierSafe(column.column_name);
        let defStr = `ADD COLUMN ${safeColName} ${type}`;
        if (!column.is_nullable && !column.is_primary_key) defStr += ' NOT NULL';
        if (column.default_value) {
            if (column.default_value.includes('now()')) defStr += ' DEFAULT CURRENT_TIMESTAMP';
            else if (column.default_value.includes('uuid()')) defStr += ' DEFAULT (UUID())';
            else {
                const sanitizedDefault = column.default_value.replace(/'/g, "''");
                defStr += ` DEFAULT '${sanitizedDefault}'`;
            }
        }

        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(tableId);
        const def = toSafeSql(defStr);
        await mysqlPool.query(safeSql`ALTER TABLE ${safeDb}.${safeTable} ${def}`);

    } else {
        const pool = await getTenantPgPool(project);

        let type = column.data_type.toUpperCase();
        if (type === 'NUMBER') type = 'NUMERIC';
        else if (type === 'VARCHAR') type = 'VARCHAR(255)';

        if (!/^[A-Z0-9_()]+$/.test(type)) {
            throw new Error("Invalid data type: " + type);
        }

        const safeColName = quotePgIdentifierSafe(column.column_name);
        let defStr = `ADD COLUMN ${safeColName} ${type}`;
        if (!column.is_nullable && !column.is_primary_key) defStr += ' NOT NULL';
        if (column.default_value) {
            if (column.default_value.includes('now()')) defStr += ' DEFAULT CURRENT_TIMESTAMP';
            else if (column.default_value.includes('uuid()')) defStr += ' DEFAULT gen_random_uuid()';
            else {
                const sanitizedDefault = column.default_value.replace(/'/g, "''");
                defStr += ` DEFAULT '${sanitizedDefault}'`;
            }
        }

        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(tableId);
        const def = toSafeSql(defStr);
        await pool.query(safeSql`ALTER TABLE ${safeSchema}.${safeTable} ${def}`);
    }

    const { invalidateTableCache } = await import('@/lib/cache');
    invalidateTableCache(projectId, tableId);
    revalidateTag(`columns-${projectId}-${tableId}`);
}

export async function deleteColumn(projectId: string, tableId: string, columnId: string) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(tableId);
        const safeCol = quoteMysqlIdentifierSafe(columnId);
        await mysqlPool.query(safeSql`ALTER TABLE ${safeDb}.${safeTable} DROP COLUMN ${safeCol}`);
    } else {
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(tableId);
        const safeCol = quotePgIdentifierSafe(columnId);
        await pool.query(safeSql`ALTER TABLE ${safeSchema}.${safeTable} DROP COLUMN ${safeCol} CASCADE`);
    }

    const { invalidateTableCache } = await import('@/lib/cache');
    invalidateTableCache(projectId, tableId);
    revalidateTag(`columns-${projectId}-${tableId}`);
}

export async function updateColumn(projectId: string, tableId: string, columnId: string, updates: Partial<Column>) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(tableId);
        const safeCol = quoteMysqlIdentifierSafe(columnId);

        if (updates.column_name && updates.column_name !== columnId) {
            const newName = quoteMysqlIdentifierSafe(updates.column_name);
            await mysqlPool.query(safeSql`ALTER TABLE ${safeDb}.${safeTable} RENAME COLUMN ${safeCol} TO ${newName}`);
        }

        if (updates.data_type) {
            let type = updates.data_type.toUpperCase();
            if (type === 'NUMBER') type = 'DOUBLE';
            else if (type === 'VARCHAR') type = 'VARCHAR(255)';
            else if (type === 'BOOLEAN') type = 'TINYINT(1)';

            if (!/^[A-Z0-9_()]+$/.test(type)) {
                throw new Error("Invalid data type: " + type);
            }

            const targetCol = (updates.column_name && updates.column_name !== columnId) ? quoteMysqlIdentifierSafe(updates.column_name) : safeCol;
            const safeType = toSafeSql(type);
            await mysqlPool.query(safeSql`ALTER TABLE ${safeDb}.${safeTable} MODIFY COLUMN ${targetCol} ${safeType}`);
        }

    } else {
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(tableId);
        const safeCol = quotePgIdentifierSafe(columnId);

        if (updates.column_name && updates.column_name !== columnId) {
            const newName = quotePgIdentifierSafe(updates.column_name);
            await pool.query(safeSql`ALTER TABLE ${safeSchema}.${safeTable} RENAME COLUMN ${safeCol} TO ${newName}`);
        }

        if (updates.data_type) {
            let type = updates.data_type.toUpperCase();
            if (type === 'NUMBER') type = 'NUMERIC';
            else if (type === 'VARCHAR') type = 'VARCHAR(255)';

            if (!/^[A-Z0-9_()]+$/.test(type)) {
                throw new Error("Invalid data type: " + type);
            }

            const targetCol = (updates.column_name && updates.column_name !== columnId) ? quotePgIdentifierSafe(updates.column_name) : safeCol;
            const safeType = toSafeSql(type);
            await pool.query(safeSql`ALTER TABLE ${safeSchema}.${safeTable} ALTER COLUMN ${targetCol} TYPE ${safeType} USING ${targetCol}::${safeType}`);
        }
    }

    const { invalidateTableCache } = await import('@/lib/cache');
    invalidateTableCache(projectId, tableId);
    revalidateTag(`columns-${projectId}-${tableId}`);
}


// --- Constraints ---

export async function getConstraintsForProject(projectId: string, explicitUserId?: string): Promise<Constraint[]> {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await getProjectById(projectId, userId);
    if (!project) throw new FluxbaseError("Project not found", ERROR_CODES.PROJECT_NOT_FOUND, 404);

    try {
        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);

            const [result]: any = await mysqlPool.query(`
                SELECT 
                    tc.TABLE_NAME as table_id,
                    tc.CONSTRAINT_NAME as constraint_id,
                    tc.CONSTRAINT_TYPE as type,
                    kcu.COLUMN_NAME as column_names,
                    kcu.REFERENCED_TABLE_NAME as referenced_table_id,
                    kcu.REFERENCED_COLUMN_NAME as referenced_column_names,
                    rc.DELETE_RULE as on_delete,
                    rc.UPDATE_RULE as on_update
                FROM information_schema.TABLE_CONSTRAINTS tc
                JOIN information_schema.KEY_COLUMN_USAGE kcu
                  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
                LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                  ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND tc.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                WHERE tc.TABLE_SCHEMA = ?
            `, [dbName]);

            return result;
        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);

            const result = await pool.query(`
                SELECT 
                    tc.table_name as table_id,
                    tc.constraint_name as constraint_id, 
                    tc.constraint_type as type,
                    kcu.column_name as column_names, 
                    ccu.table_name AS referenced_table_id,
                    ccu.column_name AS referenced_column_names
                FROM information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                LEFT JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                WHERE tc.table_schema = $1 AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
            `, [schemaName]);

            let rows = result.rows;
            if (rows.length === 0) {
                const altSchema = schemaName.startsWith('project_')
                    ? `flux_tenant_${project.project_id}`
                    : `project_${project.project_id}`;
                if (altSchema !== schemaName) {
                    try {
                        const altResult = await pool.query(`
                            SELECT 
                                tc.table_name as table_id,
                                tc.constraint_name as constraint_id, 
                                tc.constraint_type as type,
                                kcu.column_name as column_names, 
                                ccu.table_name AS referenced_table_id,
                                ccu.column_name AS referenced_column_names
                            FROM information_schema.table_constraints AS tc 
                            JOIN information_schema.key_column_usage AS kcu
                              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                            LEFT JOIN information_schema.constraint_column_usage AS ccu
                              ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                            WHERE tc.table_schema = $1 AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
                        `, [altSchema]);
                        if (altResult.rows.length > 0) rows = altResult.rows;
                    } catch {}
                }
            }
            return rows;
        }
    } catch (error) {
        console.error("Native Get Project Constraints Error:", error);
        return [];
    }
}

export async function getConstraintsForTable(projectId: string, tableId: string, explicitUserId?: string): Promise<Constraint[]> {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await getProjectById(projectId, userId);
    if (!project) throw new FluxbaseError("Project not found", ERROR_CODES.PROJECT_NOT_FOUND, 404);

    const safeTableName = tableId.replace(/[^a-zA-Z0-9_]/g, '');

    try {
        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);

            const [result]: any = await mysqlPool.query(`
                SELECT 
                    tc.CONSTRAINT_NAME as constraint_id,
                    tc.CONSTRAINT_TYPE as type,
                    kcu.COLUMN_NAME as column_names,
                    kcu.REFERENCED_TABLE_NAME as referenced_table_id,
                    kcu.REFERENCED_COLUMN_NAME as referenced_column_names,
                    rc.DELETE_RULE as on_delete,
                    rc.UPDATE_RULE as on_update
                FROM information_schema.TABLE_CONSTRAINTS tc
                JOIN information_schema.KEY_COLUMN_USAGE kcu
                  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME
                LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                  ON tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND tc.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
                  AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY')
            `, [dbName, safeTableName]);

            return result.map((row: any) => ({
                constraint_id: row.constraint_id,
                table_id: safeTableName,
                type: row.type as ConstraintType,
                column_names: row.column_names,
                referenced_table_id: row.referenced_table_id,
                referenced_column_names: row.referenced_column_names,
                on_delete: row.on_delete as any,
                on_update: row.on_update as any
            }));
        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            let result = await pool.query(`
                SELECT 
                    tc.constraint_name as constraint_id,
                    tc.constraint_type as type,
                    kcu.column_name as column_names,
                    ccu.table_name as referenced_table_id,
                    ccu.column_name as referenced_column_names,
                    rc.delete_rule as on_delete,
                    rc.update_rule as on_update
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
                LEFT JOIN information_schema.referential_constraints rc
                  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
                LEFT JOIN information_schema.constraint_column_usage ccu
                  ON rc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                WHERE tc.table_schema = $1 AND tc.table_name = $2
                  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
            `, [schemaName, safeTableName]);

            if (result.rows.length === 0) {
                const altSchema = schemaName.startsWith('project_')
                    ? `flux_tenant_${project.project_id}`
                    : `project_${project.project_id}`;
                if (altSchema !== schemaName) {
                    try {
                        const altResult = await pool.query(`
                            SELECT 
                                tc.constraint_name as constraint_id,
                                tc.constraint_type as type,
                                kcu.column_name as column_names,
                                ccu.table_name as referenced_table_id,
                                ccu.column_name as referenced_column_names,
                                rc.delete_rule as on_delete,
                                rc.update_rule as on_update
                            FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
                            LEFT JOIN information_schema.referential_constraints rc
                              ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
                            LEFT JOIN information_schema.constraint_column_usage ccu
                              ON rc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                            WHERE tc.table_schema = $1 AND tc.table_name = $2
                              AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
                        `, [altSchema, safeTableName]);
                        if (altResult.rows.length > 0) result = altResult;
                    } catch {}
                }
            }

            return result.rows.map(row => ({
                constraint_id: row.constraint_id,
                table_id: safeTableName,
                type: row.type as ConstraintType,
                column_names: row.column_names,
                referenced_table_id: row.referenced_table_id,
                referenced_column_names: row.referenced_column_names,
                on_delete: row.on_delete as any,
                on_update: row.on_update as any
            }));
        }
    } catch (error) {
        console.error("Native Get Constraints Error:", error);
        return [];
    }
}

export async function addConstraint(projectId: string, constraint: Omit<Constraint, 'constraint_id'>) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    const safeTableName = constraint.table_id.replace(/[^a-zA-Z0-9_]/g, '');
    const colName = constraint.column_names.replace(/[^a-zA-Z0-9_]/g, '');

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(constraint.table_id);
        const safeCol = quoteMysqlIdentifierSafe(constraint.column_names);
        const safeConstraintName = quoteMysqlIdentifierSafe(`${safeTableName}_${colName}_${Date.now()}`);

        let ddlStr = `ALTER TABLE ${safeDb}.${safeTable} ADD CONSTRAINT ${safeConstraintName} `;

        if (constraint.type === 'PRIMARY KEY') {
            ddlStr += `PRIMARY KEY (${safeCol})`;
        } else if (constraint.type === 'FOREIGN KEY' && constraint.referenced_table_id && constraint.referenced_column_names) {
            const safeRefTable = quoteMysqlIdentifierSafe(constraint.referenced_table_id);
            const safeRefCol = quoteMysqlIdentifierSafe(constraint.referenced_column_names);
            ddlStr += `FOREIGN KEY (${safeCol}) REFERENCES ${safeDb}.${safeRefTable} (${safeRefCol})`;

            if (constraint.on_delete) {
                if (!/^[A-Z ]+$/.test(constraint.on_delete)) throw new Error("Invalid action");
                ddlStr += ` ON DELETE ${constraint.on_delete}`;
            }
            if (constraint.on_update) {
                if (!/^[A-Z ]+$/.test(constraint.on_update)) throw new Error("Invalid action");
                ddlStr += ` ON UPDATE ${constraint.on_update}`;
            }
        }

        await mysqlPool.query(toSafeSql(ddlStr));
    } else {
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(constraint.table_id);
        const safeCol = quotePgIdentifierSafe(constraint.column_names);
        const safeConstraintName = quotePgIdentifierSafe(`${safeTableName}_${colName}_${Date.now()}`);

        let ddlStr = `ALTER TABLE ${safeSchema}.${safeTable} ADD CONSTRAINT ${safeConstraintName} `;

        if (constraint.type === 'PRIMARY KEY') {
            ddlStr += `PRIMARY KEY (${safeCol})`;
        } else if (constraint.type === 'FOREIGN KEY' && constraint.referenced_table_id && constraint.referenced_column_names) {
            const safeRefTable = quotePgIdentifierSafe(constraint.referenced_table_id);
            const safeRefCol = quotePgIdentifierSafe(constraint.referenced_column_names);
            ddlStr += `FOREIGN KEY (${safeCol}) REFERENCES ${safeSchema}.${safeRefTable} (${safeRefCol})`;

            if (constraint.on_delete) {
                if (!/^[A-Z ]+$/.test(constraint.on_delete)) throw new Error("Invalid action");
                ddlStr += ` ON DELETE ${constraint.on_delete}`;
            }
            if (constraint.on_update) {
                if (!/^[A-Z ]+$/.test(constraint.on_update)) throw new Error("Invalid action");
                ddlStr += ` ON UPDATE ${constraint.on_update}`;
            }
        }

        await pool.query(toSafeSql(ddlStr));
    }
}

export async function deleteConstraint(projectId: string, constraintId: string, tableId?: string) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    if (!tableId) throw new FluxbaseError("Table ID required for native constraint deletion", ERROR_CODES.BAD_REQUEST, 400);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    if (project.dialect?.toLowerCase() === 'mysql') {
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const safeDb = quoteMysqlIdentifierSafe(dbName);
        const safeTable = quoteMysqlIdentifierSafe(tableId);
        const safeConstraint = quoteMysqlIdentifierSafe(constraintId);
        await mysqlPool.query(safeSql`ALTER TABLE ${safeDb}.${safeTable} DROP CONSTRAINT ${safeConstraint}`);
    } else {
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        const safeSchema = quotePgIdentifierSafe(schemaName);
        const safeTable = quotePgIdentifierSafe(tableId);
        const safeConstraint = quotePgIdentifierSafe(constraintId);
        await pool.query(safeSql`ALTER TABLE ${safeSchema}.${safeTable} DROP CONSTRAINT ${safeConstraint}`);
    }
}


// --- Validation ---




// --- Rows (Data) ---

export interface TableFilter {
    field: string;
    op: 'contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with' | 'gt' | 'lt' | 'gte' | 'lte' | 'is_null' | 'is_not_null' | 'between';
    value: string;
    value2?: string;
}
export interface TableSort { field: string; direction: 'asc' | 'desc'; }

function _pgWhere(filters: TableFilter[], start: number): { clause: string; params: any[] } {
    const parts: string[] = []; const params: any[] = []; let i = start;
    const sc = (c: string) => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`;
    for (const f of filters) {
        const col = sc(f.field);
        switch (f.op) {
            case 'contains':    parts.push(`${col}::text ILIKE $${i++}`); params.push(`%${f.value}%`); break;
            case 'equals':      parts.push(`${col}::text = $${i++}`);     params.push(f.value); break;
            case 'not_equals':  parts.push(`${col}::text <> $${i++}`);    params.push(f.value); break;
            case 'starts_with': parts.push(`${col}::text ILIKE $${i++}`); params.push(`${f.value}%`); break;
            case 'ends_with':   parts.push(`${col}::text ILIKE $${i++}`); params.push(`%${f.value}`); break;
            case 'gt':          parts.push(`${col} > $${i++}`);  params.push(f.value); break;
            case 'lt':          parts.push(`${col} < $${i++}`);  params.push(f.value); break;
            case 'gte':         parts.push(`${col} >= $${i++}`); params.push(f.value); break;
            case 'lte':         parts.push(`${col} <= $${i++}`); params.push(f.value); break;
            case 'is_null':     parts.push(`${col} IS NULL`);     break;
            case 'is_not_null': parts.push(`${col} IS NOT NULL`); break;
            case 'between':     parts.push(`${col} BETWEEN $${i++} AND $${i++}`); params.push(f.value, f.value2 ?? f.value); break;
        }
    }
    return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}
function _pgOrder(sorts: TableSort[]): string {
    if (!sorts.length) return '';
    const sc = (c: string) => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`;
    return 'ORDER BY ' + sorts.map(s => `${sc(s.field)} ${s.direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`).join(', ');
}
function _myWhere(filters: TableFilter[]): { clause: string; params: any[] } {
    const parts: string[] = []; const params: any[] = [];
    const sc = (c: string) => `\`${c.replace(/[^a-zA-Z0-9_]/g, '')}\``;
    for (const f of filters) {
        const col = sc(f.field);
        switch (f.op) {
            case 'contains':    parts.push(`${col} LIKE ?`);        params.push(`%${f.value}%`); break;
            case 'equals':      parts.push(`${col} = ?`);           params.push(f.value); break;
            case 'not_equals':  parts.push(`${col} <> ?`);          params.push(f.value); break;
            case 'starts_with': parts.push(`${col} LIKE ?`);        params.push(`${f.value}%`); break;
            case 'ends_with':   parts.push(`${col} LIKE ?`);        params.push(`%${f.value}`); break;
            case 'gt':          parts.push(`${col} > ?`);           params.push(f.value); break;
            case 'lt':          parts.push(`${col} < ?`);           params.push(f.value); break;
            case 'gte':         parts.push(`${col} >= ?`);          params.push(f.value); break;
            case 'lte':         parts.push(`${col} <= ?`);          params.push(f.value); break;
            case 'is_null':     parts.push(`${col} IS NULL`);       break;
            case 'is_not_null': parts.push(`${col} IS NOT NULL`);   break;
            case 'between':     parts.push(`${col} BETWEEN ? AND ?`); params.push(f.value, f.value2 ?? f.value); break;
        }
    }
    return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}
function _myOrder(sorts: TableSort[]): string {
    if (!sorts.length) return '';
    const sc = (c: string) => `\`${c.replace(/[^a-zA-Z0-9_]/g, '')}\``;
    return 'ORDER BY ' + sorts.map(s => `${sc(s.field)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`).join(', ');
}

async function resolvePgSchemaForTable(pool: any, defaultSchema: string, tableName: string): Promise<string> {
    const cacheKey = `${defaultSchema}:${tableName}`;
    const cached = _schemaCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let result = defaultSchema || 'public';
    if (defaultSchema) {
        try {
            const check = await pool.query(
                `SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = $2 LIMIT 1`,
                [defaultSchema, tableName]
            );
            if (check.rows.length > 0) {
                result = defaultSchema;
                _schemaCache.set(cacheKey, result);
                return result;
            }
        } catch {}
    }
    try {
        const check = await pool.query(
            `SELECT schemaname FROM pg_tables WHERE tablename = $1 AND schemaname NOT IN ('pg_catalog', 'information_schema') LIMIT 1`,
            [tableName]
        );
        if (check.rows.length > 0 && check.rows[0].schemaname) {
            result = check.rows[0].schemaname;
            _schemaCache.set(cacheKey, result);
            return result;
        }
    } catch {}
    _schemaCache.set(cacheKey, result);
    return result;
}

async function resolveMysqlDbForTable(mysqlPool: any, defaultDb: string, tableName: string): Promise<string> {
    const cacheKey = `${defaultDb}:${tableName}`;
    const cached = _schemaCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let result = defaultDb || '';
    if (defaultDb) {
        try {
            const [check]: any = await mysqlPool.query(
                `SELECT TABLE_SCHEMA as table_schema FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE' LIMIT 1`,
                [defaultDb, tableName]
            );
            if (check && check.length > 0) {
                result = defaultDb;
                _schemaCache.set(cacheKey, result);
                return result;
            }
        } catch {}
    }
    try {
        const [check]: any = await mysqlPool.query(
            `SELECT TABLE_SCHEMA as table_schema FROM information_schema.TABLES WHERE TABLE_NAME = ? AND TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') AND TABLE_TYPE = 'BASE TABLE' LIMIT 1`,
            [tableName]
        );
        if (check && check.length > 0 && check[0].table_schema) {
            result = check[0].table_schema;
            _schemaCache.set(cacheKey, result);
            return result;
        }
    } catch {}
    _schemaCache.set(cacheKey, result);
    return result;
}

export async function getTableData(
    projectId: string,
    tableName: string,
    page: number = 0,
    pageSize: number = 50,
    explicitUserId?: string,
    sorts: TableSort[] = [],
    filters: TableFilter[] = [],
    preloadedProject?: Project | null,
) {
    const userId = explicitUserId || await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = preloadedProject || await getProjectById(projectId, userId);
    if (!project) throw new FluxbaseError("Project not found", ERROR_CODES.PROJECT_NOT_FOUND, 404);

    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    const limit = Math.min(Math.max(1, pageSize), 100);
    const offset = page * limit;
    const fetchLimit = limit + 1; // Fetch 1 extra row to instantly evaluate hasMore without relying on COUNT(*)
    const hasActiveState = sorts.length > 0 || filters.length > 0;

    try {
        const { getCachedTableRows, setCachedTableRows } = await import('@/lib/cache');

        // Skip cache when filters/sorts are active (dynamic queries need fresh results)
        if (!hasActiveState) {
            const cachedData = await getCachedTableRows(projectId, tableName, page);
            if (cachedData) return cachedData;
        }

        let rows: any[] = [];
        let totalRows = 0;
        let hasMore = false;

        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const targetDb = (!project.connection_type || project.connection_type === 'internal')
                ? dbName
                : await resolveMysqlDbForTable(mysqlPool, dbName, safeTableName);
            const fromTable = targetDb ? `\`${targetDb}\`.\`${safeTableName}\`` : `\`${safeTableName}\``;

            const { clause: wClause, params: wParams } = _myWhere(filters);
            const orderBy = _myOrder(sorts);

            const pkKey = `mysql:${targetDb || dbName || ''}:${safeTableName}`;
            const cachedPk = _tablePkCache.get(pkKey);
            const pkPromise = cachedPk !== undefined
                ? Promise.resolve(cachedPk || null)
                : mysqlPool.query(`SELECT COLUMN_NAME as column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI' LIMIT 1`, [targetDb || dbName || '', safeTableName])
                    .then(([res]: any) => {
                        const pk = res?.[0]?.column_name || '';
                        _tablePkCache.set(pkKey, pk);
                        return pk || null;
                    }).catch(() => null);

            // Only run COUNT(*) on page 0 if not cached. When scrolling/paginating (page > 0), COUNT(*) is redundant.
            const countKey = `count:${projectId}:${safeTableName}:${wClause}`;
            const cachedCount = _tableCountCache.get(countKey);
            const shouldQueryCount = page === 0 && cachedCount === undefined;

            const countPromise = shouldQueryCount
                ? (wClause
                    ? mysqlPool.query(`SELECT COUNT(*) as count FROM ${fromTable} ${wClause}`, wParams)
                        .then(([cnt]: any) => {
                            const c = parseInt(cnt?.[0]?.count || '0', 10);
                            _tableCountCache.set(countKey, c);
                            return c;
                        }).catch(() => 0)
                    : mysqlPool.query(`SELECT TABLE_ROWS as count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [targetDb || dbName || '', safeTableName])
                        .then(([cnt]: any) => {
                            const c = parseInt(cnt?.[0]?.count || '0', 10);
                            _tableCountCache.set(countKey, c);
                            return c;
                        }).catch(() => 0)
                  )
                : Promise.resolve(cachedCount ?? 0);

            const [
                [dataResult],
                countVal,
                pkName
            ]: any = await Promise.all([
                mysqlPool.query(`SELECT * FROM ${fromTable} ${wClause} ${orderBy} LIMIT ${fetchLimit} OFFSET ${offset}`, wParams),
                countPromise,
                pkPromise
            ]);

            totalRows = countVal;
            const rawRows = dataResult || [];
            hasMore = rawRows.length > limit;
            const slicedRows = hasMore ? rawRows.slice(0, limit) : rawRows;

            rows = slicedRows.map((row: any, index: number) => {
                const idField = (pkName && row[pkName]) ? row[pkName] : (row.id || row.uuid || `row_${offset + index}`);
                return { ...row, id: idField, _id: idField };
            });

        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const targetSchema = (!project.connection_type || project.connection_type === 'internal')
                ? schemaName
                : await resolvePgSchemaForTable(pool, schemaName, safeTableName);
            const { clause: wClause, params: wParams } = _pgWhere(filters, 3);
            const orderBy = _pgOrder(sorts);

            const pkKey = `pg:${targetSchema}:${safeTableName}`;
            const cachedPk = _tablePkCache.get(pkKey);
            const pkPromise = cachedPk !== undefined
                ? Promise.resolve(cachedPk || null)
                : pool.query(`
                    SELECT a.attname AS column_name
                    FROM pg_index i
                    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                    WHERE i.indrelid = ('"' || $1 || '"."' || $2 || '"')::regclass AND i.indisprimary
                    LIMIT 1
                `, [targetSchema, safeTableName])
                    .then(r => {
                        const pk = r.rows[0]?.column_name || '';
                        _tablePkCache.set(pkKey, pk);
                        return pk || null;
                    }).catch(() => null);

            // Only run COUNT(*) on page 0 if not cached. When scrolling/paginating (page > 0), COUNT(*) is redundant.
            const countKey = `count:${projectId}:${safeTableName}:${wClause}`;
            const cachedCount = _tableCountCache.get(countKey);
            const shouldQueryCount = page === 0 && cachedCount === undefined;

            const countPromise = shouldQueryCount
                ? (wClause
                    ? pool.query(`SELECT COUNT(*) FROM "${targetSchema}"."${safeTableName}" ${wClause}`, wParams)
                        .then(r => {
                            const c = parseInt(r.rows[0]?.count || '0', 10);
                            _tableCountCache.set(countKey, c);
                            return c;
                        }).catch(() => 0)
                    : pool.query(`
                        SELECT reltuples::bigint AS count
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = $1 AND c.relname = $2
                      `, [targetSchema, safeTableName])
                        .then(r => {
                            const c = Math.max(0, parseInt(r.rows[0]?.count || '0', 10));
                            _tableCountCache.set(countKey, c);
                            return c;
                        }).catch(() => 0)
                  )
                : Promise.resolve(cachedCount ?? 0);

            const [dataResult, countVal, pkName] = await Promise.all([
                pool.query(`SELECT * FROM "${targetSchema}"."${safeTableName}" ${wClause} ${orderBy} LIMIT $1 OFFSET $2`, [fetchLimit, offset, ...wParams]),
                countPromise,
                pkPromise
            ]);

            totalRows = countVal;
            const rawRows = dataResult.rows || [];
            hasMore = rawRows.length > limit;
            const slicedRows = hasMore ? rawRows.slice(0, limit) : rawRows;

            rows = slicedRows.map((row, index) => {
                const idField = (pkName && row[pkName]) ? row[pkName] : (row.id || row.uuid || `row_${offset + index}`);
                return { ...row, id: idField, _id: idField };
            });
        }

        const payload = {
            rows,
            totalRows,
            nextCursorId: hasMore ? String(page + 1) : null,
            hasMore
        };

        // Cache only unfiltered/unsorted pages
        if (!hasActiveState) {
            await setCachedTableRows(projectId, tableName, page, payload);
        }

        return payload;
    } catch (error) {
        console.error("Native getTableData error:", error);
        return { rows: [], totalRows: 0, nextCursorId: null, hasMore: false };
    }
}

export async function insertRow(projectId: string, tableId: string, rowData: Record<string, any>) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    const columns = await getColumnsForTable(projectId, tableId);
    validateRow(rowData as Row, columns);

    const safeTableName = tableId.replace(/[^a-zA-Z0-9_]/g, '');

    const cols: any[] = [];
    const vals: any[] = [];
    const params: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(rowData)) {
        if (key === 'id' || key === '_id') continue;
        if (columns.some(c => c.column_name === key)) {
            // MySQL uses ``, Postgres uses ""
            cols.push(project.dialect?.toLowerCase() === 'mysql' ? `\`${key.replace(/[^a-zA-Z0-9_]/g, '')}\`` : `"${key.replace(/[^a-zA-Z0-9_]/g, '')}"`);

            if (project.dialect?.toLowerCase() === 'mysql') {
                vals.push(`?`);
            } else {
                vals.push(`$${i++}`);
            }
            params.push(value);
        }
    }

    if (cols.length === 0) throw new FluxbaseError("No valid columns provided for insertion.", ERROR_CODES.BAD_REQUEST, 400);

    try {
        let insertedRow;

        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const targetDb = await resolveMysqlDbForTable(mysqlPool, dbName, safeTableName);
            const fromTable = targetDb ? `\`${targetDb}\`.\`${safeTableName}\`` : `\`${safeTableName}\``;

            // MySQL does not naturally support RETURNING *. We do an INSERT then a SELECT of the last insert if needed, 
            // but for simple webhook fire, we'll try to reconstruct the object locally since this is a basic interface.
            const ddl = `INSERT INTO ${fromTable} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;

            try {
                const [result]: any = await mysqlPool.query(ddl as any, params);
                insertedRow = { ...rowData, _internal_last_id: result.insertId }; // Approximation
            } catch (mysqlError: any) {
                if (mysqlError.code === 'ER_DUP_ENTRY') throw new FluxbaseError(`Duplicate entry for unique/primary key constraint.`, ERROR_CODES.BAD_REQUEST, 400);
                throw mysqlError;
            }

        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const targetSchema = await resolvePgSchemaForTable(pool, schemaName, safeTableName);
            const ddl = `INSERT INTO "${targetSchema}"."${safeTableName}" (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`;

            try {
                const result = await pool.query(ddl, params);
                insertedRow = result.rows[0];
            } catch (pgError: any) {
                if (pgError.code === '23505') throw new FluxbaseError(`Duplicate entry for unique/primary key constraint.`, ERROR_CODES.BAD_REQUEST, 400);
                throw pgError;
            }
        }

        const { invalidateTableCache } = await import('@/lib/cache');
        await invalidateTableCache(projectId, tableId);

        fireWebhooks(projectId, userId, tableId, 'row.inserted', insertedRow).catch(err => {
            console.error(`[Webhook Fire Error] ${tableId} insert:`, err);
        });
    } catch (error: any) {
        throw new FluxbaseError(`Insertion failed: ${error.message}`, ERROR_CODES.INTERNAL_ERROR, 500);
    }
}

export async function updateRow(projectId: string, tableId: string, rowId: string, updates: Record<string, any>) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    const columns = await getColumnsForTable(projectId, tableId);
    const pkCol = columns.find(c => c.is_primary_key);

    if (!pkCol) {
        throw new FluxbaseError("Table must have a Primary Key to update specific rows natively.", ERROR_CODES.BAD_REQUEST, 400);
    }

    const safeTableName = tableId.replace(/[^a-zA-Z0-9_]/g, '');
    const setClauses: any[] = [];
    const params: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(updates)) {
        if (key.toLowerCase() === 'id' || key.toLowerCase() === '_id' || key.toLowerCase() === pkCol.column_name.toLowerCase()) continue;
        const matchingCol = columns.find(c => c.column_name.toLowerCase() === key.toLowerCase());
        if (matchingCol && value !== undefined) {
            setClauses.push(project.dialect?.toLowerCase() === 'mysql' ? `\`${matchingCol.column_name.replace(/[^a-zA-Z0-9_]/g, '')}\` = ?` : `"${matchingCol.column_name.replace(/[^a-zA-Z0-9_]/g, '')}" = $${i++}`);
            params.push(value);
        }
    }

    if (setClauses.length === 0) return;

    params.push(rowId);

    try {
        let updatedRow;
        let oldData;

        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const targetDb = await resolveMysqlDbForTable(mysqlPool, dbName, safeTableName);
            const fromTable = targetDb ? `\`${targetDb}\`.\`${safeTableName}\`` : `\`${safeTableName}\``;

            const [oldDataResult]: any = await mysqlPool.query(`SELECT * FROM ${fromTable} WHERE \`${pkCol.column_name}\` = ?` as any, [rowId]);
            if (oldDataResult.length === 0) throw new Error(`Row with PK '${rowId}' not found.`);
            oldData = oldDataResult[0];

            const ddl = `UPDATE ${fromTable} SET ${setClauses.join(', ')} WHERE \`${pkCol.column_name}\` = ?`;
            await mysqlPool.query(ddl as any, params);

            // MySQL lacks RETURNING *, grab it again or approximate
            updatedRow = { ...oldData, ...updates };

        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const targetSchema = await resolvePgSchemaForTable(pool, schemaName, safeTableName);

            const oldDataResult = await pool.query(`SELECT * FROM "${targetSchema}"."${safeTableName}" WHERE "${pkCol.column_name}"::text = $1`, [rowId]);
            if (oldDataResult.rows.length === 0) throw new Error(`Row with PK '${rowId}' not found.`);
            oldData = oldDataResult.rows[0];

            const ddl = `UPDATE "${targetSchema}"."${safeTableName}" SET ${setClauses.join(', ')} WHERE "${pkCol.column_name}"::text = $${i} RETURNING *`;
            const result = await pool.query(ddl, params);
            updatedRow = result.rows[0];
        }

        const { invalidateTableCache } = await import('@/lib/cache');
        await invalidateTableCache(projectId, tableId);

        fireWebhooks(projectId, userId, tableId, 'row.updated', updatedRow, oldData).catch(err => {
            console.error(`[Webhook Fire Error] ${tableId} update:`, err);
        });
    } catch (error: any) {
        throw new Error(`Update failed: ${error.message}`);
    }
}

export async function deleteRow(projectId: string, tableId: string, rowId: string) {
    const userId = await getCurrentUserId();
    if (!userId) throw new FluxbaseError("Unauthorized", ERROR_CODES.UNAUTHORIZED, 401);

    const project = await ensureRole(await getProjectById(projectId, userId), ['admin', 'developer']);

    const columns = await getColumnsForTable(projectId, tableId);
    const pkCol = columns.find(c => c.is_primary_key);

    if (!pkCol) {
        throw new Error("Table must have a Primary Key to delete specific rows natively.");
    }

    const safeTableName = tableId.replace(/[^a-zA-Z0-9_]/g, '');

    try {
        let oldData = null;

        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const targetDb = await resolveMysqlDbForTable(mysqlPool, dbName, safeTableName);
            const fromTable = targetDb ? `\`${targetDb}\`.\`${safeTableName}\`` : `\`${safeTableName}\``;

            const [oldDataResult]: any = await mysqlPool.query(`SELECT * FROM ${fromTable} WHERE \`${pkCol.column_name}\` = ?`, [rowId]);
            oldData = oldDataResult.length > 0 ? oldDataResult[0] : null;

            if (oldData) {
                await mysqlPool.query(`DELETE FROM ${fromTable} WHERE \`${pkCol.column_name}\` = ?`, [rowId]);
            }
        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const targetSchema = await resolvePgSchemaForTable(pool, schemaName, safeTableName);

            // Fetch old data for webhook
            const oldDataResult = await pool.query(`SELECT * FROM "${targetSchema}"."${safeTableName}" WHERE "${pkCol.column_name}"::text = $1`, [rowId]);
            oldData = oldDataResult.rows.length > 0 ? oldDataResult.rows[0] : null;

            if (oldData) {
                await pool.query(`DELETE FROM "${targetSchema}"."${safeTableName}" WHERE "${pkCol.column_name}"::text = $1`, [rowId]);
            }
        }
        if (oldData) {
            const { invalidateTableCache } = await import('@/lib/cache');
            await invalidateTableCache(projectId, tableId);

            fireWebhooks(projectId, userId, tableId, 'row.deleted', undefined, oldData).catch(err => {
                console.error(`[Webhook Fire Error] ${tableId} delete:`, err);
            });
        }
    } catch (error: any) {
        throw new Error(`Deletion failed: ${error.message}`);
    }
}


// --- Analytics ---

export interface ProjectAnalytics {
    totalSize: number;
    totalRows: number;
    tables: { name: string; rows: number; size: number }[];
}

export async function getProjectAnalytics(projectId: string, explicitUserId?: string): Promise<ProjectAnalytics> {
    const cachedLocal = _projectAnalyticsCache.get(projectId);
    if (cachedLocal) return cachedLocal;

    let userId: string | null | undefined = explicitUserId;
    if (!userId) {
        try {
            userId = await getCurrentUserId();
        } catch {
            // Outside request context
        }
    }

    if (!userId) {
        try {
            const pool = getPgPool();
            const res = await pool.query('SELECT user_id FROM fluxbase_global.projects WHERE project_id = $1', [projectId]);
            userId = res.rows[0]?.user_id;
        } catch {}
    }

    if (!userId) {
        return { totalSize: 0, totalRows: 0, tables: [] };
    }

    const cacheKey = `analytics_fast:${projectId}`;

    try {
        const { redis } = await import('@/lib/redis');
        try {
            const cached = await redis.get<ProjectAnalytics>(cacheKey);
            if (cached) {
                _projectAnalyticsCache.set(projectId, cached);
                return cached;
            }
        } catch {}

        const project = await getProjectById(projectId, userId);
        if (!project) return { totalSize: 0, totalRows: 0, tables: [] };

        let tablesStats: { name: string; rows: number; size: number }[] = [];

        if (project.dialect?.toLowerCase() === 'mysql') {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const targetDb = dbName || `project_${projectId}`;

            const [rows]: any = await mysqlPool.query(`
                SELECT 
                    table_name AS name,
                    COALESCE(table_rows, 0) AS row_count,
                    COALESCE(data_length + index_length, 0) AS size
                FROM information_schema.tables
                WHERE table_schema = ? AND table_type = 'BASE TABLE'
                AND table_name NOT LIKE '\\_flux\\_%'
            `, [targetDb]);

            tablesStats = (rows || []).map((r: any) => ({
                name: r.name || r.NAME,
                rows: Math.max(0, parseInt(r.row_count || r.rows || r.ROWS || '0', 10)),
                size: parseInt(r.size || r.SIZE || '0', 10)
            }));
        } else {
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const isExternal = project.connection_type && project.connection_type !== 'internal';
            const activeSchema = schemaName || `project_${projectId}`;

            let result = await pool.query(`
                SELECT 
                    c.relname AS name,
                    n.nspname AS schema_name,
                    GREATEST(0, COALESCE(c.reltuples, 0)::bigint) AS rows,
                    COALESCE(pg_total_relation_size(c.oid), 0)::bigint AS size
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = $1 
                  AND c.relkind IN ('r', 'p')
                  AND c.relname NOT LIKE '_flux_%';
            `, [activeSchema]);

            if (isExternal && result.rows.length === 0 && activeSchema !== 'public') {
                result = await pool.query(`
                    SELECT 
                        c.relname AS name,
                        n.nspname AS schema_name,
                        GREATEST(0, COALESCE(c.reltuples, 0)::bigint) AS rows,
                        COALESCE(pg_total_relation_size(c.oid), 0)::bigint AS size
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' 
                      AND c.relkind IN ('r', 'p')
                      AND c.relname NOT LIKE '_flux_%';
                `);
            }

            tablesStats = result.rows.map(r => ({
                name: r.name,
                schemaName: r.schema_name || activeSchema,
                rows: Math.max(0, parseInt(r.rows || '0', 10)),
                size: parseInt(r.size || '0', 10)
            }));
        }

        const totalRows = tablesStats.reduce((sum, stat) => sum + stat.rows, 0);
        let totalSize = tablesStats.reduce((sum, stat) => sum + stat.size, 0);

        try {
            const globalPool = getPgPool();
            const s3Res = await globalPool.query(
                `SELECT COALESCE(SUM(size), 0) as s3_bytes FROM fluxbase_global.storage_objects WHERE project_id = $1`,
                [projectId]
            );
            const s3Bytes = parseInt(s3Res.rows[0]?.s3_bytes || '0', 10);
            totalSize += s3Bytes;
        } catch (s3Err) {
            console.warn('[Analytics] Failed to fetch storage_objects size:', s3Err);
        }

        const analyticsResult: ProjectAnalytics = {
            totalRows,
            totalSize,
            tables: tablesStats
        };

        _projectAnalyticsCache.set(projectId, analyticsResult);
        try {
            await redis.set(cacheKey, analyticsResult, { ex: 60 });
        } catch {}
        return analyticsResult;

    } catch (error) {
        console.error("Native Analytics error:", error);
        return { totalSize: 0, totalRows: 0, tables: [] };
    }
}

// --- Audit & Security ---

export async function logAuditAction(projectId: string, userId: string, action: string, statement: string, metadata: any = {}) {
    try {
        const pool = getPgPool();
        await pool.query(
            'INSERT INTO fluxbase_global.audit_logs (project_id, user_id, action, statement, metadata) VALUES ($1, $2::text, $3, $4, $5)',
            [projectId, userId, action, statement, JSON.stringify(metadata)]
        );
    } catch (e) {
        // Failing to log shouldn't necessarily crash the process, but needs tracking
        console.error("[AUDIT LOG FAILURE]", e);
    }
}
