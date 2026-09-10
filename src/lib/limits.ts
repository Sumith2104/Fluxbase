import { getPgPool } from '@/lib/pg';
import { getProjectById, getTablesForProject } from '@/lib/data';
import { sendLimitAlertEmail } from '@/lib/email';
import logger from '@/lib/logger';

const PLAN_LIMITS = {
    free: {
        projects: 1,
        tablesPerProject: 5,
        rowsPerTable: 10000,
        apiKeys: 2,
        webhooks: 0,
        scrapers: 0,
        allowedInstanceSizes: ['db.t3.micro']
    },
    pro: {
        projects: 3,
        tablesPerProject: 15,
        rowsPerTable: 50000,
        apiKeys: 10,
        webhooks: 5,
        scrapers: 3,
        allowedInstanceSizes: ['db.t3.micro', 'db.t3.medium']
    },
    max: {
        projects: 999999, // Practically unlimited
        tablesPerProject: 999999,
        rowsPerTable: 999999999,
        apiKeys: 999999,
        webhooks: 999999,
        scrapers: 999999,
        allowedInstanceSizes: ['db.t3.micro', 'db.t3.medium', 'db.t3.large']
    },
    employee: {
        projects: 10,
        tablesPerProject: 50,
        rowsPerTable: 500000,
        apiKeys: 25,
        webhooks: 10,
        scrapers: 10,
        allowedInstanceSizes: ['db.t3.micro', 'db.t3.medium', 'db.t3.large']
    },
    org_owner: {
        projects: 999999,
        tablesPerProject: 999999,
        rowsPerTable: 999999999,
        apiKeys: 999999,
        webhooks: 999999,
        scrapers: 999999,
        allowedInstanceSizes: ['db.t3.micro', 'db.t3.medium', 'db.t3.large', 'db.m5.large']
    },
    pay_as_you_go: {
        projects: 10,
        tablesPerProject: 50,
        rowsPerTable: 500000,
        apiKeys: 25,
        webhooks: 10,
        scrapers: 10,
        allowedInstanceSizes: ['db.t3.micro', 'db.t3.medium', 'db.t3.large']
    }
} as const;

type PlanType = keyof typeof PLAN_LIMITS;

export class LimitExceededError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LimitExceededError';
    }
}

// In-memory cache for traffic limit results to avoid slamming Redis/DB on every SQL request
// Key: projectId, Value: { timestamp, error? }
const trafficLimitCache = new Map<string, { timestamp: number; error: string | null }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function getUserPlan(userId: string): Promise<PlanType> {
    const pool = getPgPool();
    const res = await pool.query('SELECT plan_type FROM fluxbase_global.users WHERE id = $1', [userId]);
    const plan = res.rows[0]?.plan_type || 'free';
    // Validate the plan falls into one of our tiers, fallback to free
    if (plan in PLAN_LIMITS) return plan as PlanType;
    return 'free';
}

export async function checkProjectLimit(userId: string): Promise<void> {
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].projects;

    const pool = getPgPool();
    const res = await pool.query('SELECT COUNT(*) as count FROM fluxbase_global.projects WHERE user_id = $1', [userId]);
    const count = parseInt(res.rows[0].count, 10);

    if (count >= limit) {
        throw new LimitExceededError(`Project limit reached. Your ${plan.toUpperCase()} plan allows a maximum of ${limit} project(s). Please upgrade to create more.`);
    }
}

export async function checkTableLimit(projectId: string, userId: string): Promise<void> {
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].tablesPerProject;

    const tables = await getTablesForProject(projectId, userId);

    if (tables.length >= limit) {
        throw new LimitExceededError(`Table limit reached. Your ${plan.toUpperCase()} plan allows a maximum of ${limit} tables per project. Please upgrade to create more.`);
    }
}

export async function checkRowLimit(projectId: string, userId: string, tableName: string, insertingCount: number = 1): Promise<void> {
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].rowsPerTable;

    const project = await getProjectById(projectId, userId);
    if (!project) throw new Error("Project not found");

    let currentRows = 0;

    const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');

    if (project.dialect?.toLowerCase() === 'mysql') {
        const { getTenantMysqlPool, getProjectDbAndSchema } = await import('@/lib/tenant-pools');
        const mysqlPool = await getTenantMysqlPool(project);
        const { dbName } = getProjectDbAndSchema(project);
        const fromTable = dbName ? `\`${dbName}\`.\`${safeTable}\`` : `\`${safeTable}\``;
        try {
            const [rows]: any = await mysqlPool.query(`SELECT COUNT(*) as count FROM ${fromTable}`);
            currentRows = parseInt(rows[0].count, 10);
        } catch {
            // Table might not exist yet, which is fine
            currentRows = 0;
        }
    } else {
        const { getTenantPgPool, getProjectDbAndSchema } = await import('@/lib/tenant-pools');
        const pool = await getTenantPgPool(project);
        const { schemaName } = getProjectDbAndSchema(project);
        let targetSchema = schemaName || 'public';
        try {
            const check = await pool.query(
                `SELECT schemaname FROM pg_tables WHERE schemaname = $1 AND tablename = $2 LIMIT 1`,
                [schemaName, safeTable]
            );
            if (check.rows.length === 0) {
                const fallbackCheck = await pool.query(
                    `SELECT schemaname FROM pg_tables WHERE tablename = $1 AND schemaname NOT IN ('pg_catalog', 'information_schema') LIMIT 1`,
                    [safeTable]
                );
                if (fallbackCheck.rows.length > 0 && fallbackCheck.rows[0].schemaname) {
                    targetSchema = fallbackCheck.rows[0].schemaname;
                }
            }
            const res = await pool.query(`SELECT COUNT(*) as count FROM "${targetSchema}"."${safeTable}"`);
            currentRows = parseInt(res.rows[0].count, 10);
        } catch {
            currentRows = 0;
        }
    }

    const pgPool = getPgPool();
    const configRes = await pgPool.query('SELECT display_name, custom_row_limit, alert_email, alert_threshold_percent, last_row_alert_at FROM fluxbase_global.projects WHERE project_id = $1', [projectId]);
    const pConfig = configRes.rows[0];

    // Priority 1: Custom User Project Limit
    // Priority 2: Global Service Tier Limit
    const activeLimit = pConfig?.custom_row_limit || limit;
    const projectedRows = currentRows + insertingCount;

    if (projectedRows > activeLimit) {
        throw new LimitExceededError(`Row limit reached. The limit is ${activeLimit} rows per table. You are trying to insert ${insertingCount} rows into a table that already has ${currentRows} rows. Please upgrade your plan or adjust custom limits.`);
    }

    // Threshold Alert Tracking
    if (pConfig?.alert_email && activeLimit > 0) {
        const threshold = activeLimit * ((pConfig.alert_threshold_percent || 80) / 100);
        
        // If we exceed threshold and haven't alerted in the last 24h
        if (projectedRows >= threshold) {
            const lastAlert = pConfig.last_row_alert_at ? new Date(pConfig.last_row_alert_at).getTime() : 0;
            const now = Date.now();
            
            // Only send one email every 24 hours per resource to prevent spam
            if (now - lastAlert > 24 * 60 * 60 * 1000) {
                // Fire and forget email dispatch
                sendLimitAlertEmail(pConfig.alert_email, pConfig.display_name, `Rows in table '${tableName}'`, activeLimit, projectedRows >= activeLimit).catch((e) => { logger.error(e); });
                
                // Update alert timestamp
                pgPool.query('UPDATE fluxbase_global.projects SET last_row_alert_at = NOW() WHERE project_id = $1', [projectId]).catch((e) => { logger.error(e); });
            }
        }
    }
}

export async function checkProjectTrafficLimits(projectId: string): Promise<void> {
    // 1. Check in-memory cache first
    const now = Date.now();
    const cached = trafficLimitCache.get(projectId);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        if (cached.error) throw new LimitExceededError(cached.error);
        return; // Success is cached
    }

    const redisKey = `traffic_limit_check:${projectId}`;
    try {
        const { redis } = await import('@/lib/redis');
        const redisCached = await redis.get<string | null>(redisKey);
        if (redisCached !== null && redisCached !== undefined) {
            if (redisCached === 'OK') {
                trafficLimitCache.set(projectId, { timestamp: now, error: null });
                return;
            } else {
                trafficLimitCache.set(projectId, { timestamp: now, error: redisCached });
                throw new LimitExceededError(redisCached);
            }
        }
    } catch (e) {
        logger.warn('[Redis Error] checkProjectTrafficLimits cache read failed:', e);
    }

    try {
        const pool = getPgPool();
        const pRes = await pool.query(`
            SELECT display_name, custom_api_limit, custom_request_limit, alert_email, alert_threshold_percent, last_api_alert_at 
            FROM fluxbase_global.projects WHERE project_id = $1
        `, [projectId]);
        
        if (pRes.rows.length === 0) {
            trafficLimitCache.set(projectId, { timestamp: now, error: null });
            try {
                const { redis } = await import('@/lib/redis');
                await redis.set(redisKey, 'OK', { ex: 300 });
            } catch {}
            return;
        }
        const pConfig = pRes.rows[0];

        // Read cached traffic stats (assuming it tracks current period)
        const { getAnalyticsStatsAction } = await import('@/app/(app)/dashboard/analytics-actions');
        const stats = await getAnalyticsStatsAction(projectId);
        if (!stats) {
            trafficLimitCache.set(projectId, { timestamp: now, error: null });
            try {
                const { redis } = await import('@/lib/redis');
                await redis.set(redisKey, 'OK', { ex: 300 });
            } catch {}
            return;
        }

        // Check Total Requests
        if (pConfig.custom_request_limit && stats.total_requests > pConfig.custom_request_limit) {
            const err = `Rate limit exceeded. Project has exceeded its custom total request limit of ${pConfig.custom_request_limit}.`;
            trafficLimitCache.set(projectId, { timestamp: now, error: err });
            try {
                const { redis } = await import('@/lib/redis');
                await redis.set(redisKey, err, { ex: 300 });
            } catch {}
            throw new LimitExceededError(err);
        }

        // Check API / DB usage
        const totalApi = stats.type_api_call + stats.type_sql_execution;
        if (pConfig.custom_api_limit && totalApi > pConfig.custom_api_limit) {
            const err = `Rate limit exceeded. Project has exceeded its custom API/Query limit of ${pConfig.custom_api_limit}.`;
            trafficLimitCache.set(projectId, { timestamp: now, error: err });
            try {
                const { redis } = await import('@/lib/redis');
                await redis.set(redisKey, err, { ex: 300 });
            } catch {}
            throw new LimitExceededError(err);
        }

        // Threshold alerts
        if (pConfig.alert_email) {
            const checkAlert = (current: number, limit: number, resourceName: string) => {
                if (!limit) return;
                const threshold = limit * ((pConfig.alert_threshold_percent || 80) / 100);
                if (current >= threshold) {
                    const lastAlert = pConfig.last_api_alert_at ? new Date(pConfig.last_api_alert_at).getTime() : 0;
                    if (Date.now() - lastAlert > 24 * 60 * 60 * 1000) {
                        sendLimitAlertEmail(pConfig.alert_email, pConfig.display_name, resourceName, limit, current >= limit).catch((e) => { logger.error(e); });
                        pool.query('UPDATE fluxbase_global.projects SET last_api_alert_at = NOW() WHERE project_id = $1', [projectId]).catch((e) => { logger.error(e); });
                    }
                }
            };

            checkAlert(stats.total_requests, pConfig.custom_request_limit, "Total Requests");
            checkAlert(totalApi, pConfig.custom_api_limit, "API/SQL Operations");
        }

        // Cache the successful check
        trafficLimitCache.set(projectId, { timestamp: now, error: null });
        try {
            const { redis } = await import('@/lib/redis');
            await redis.set(redisKey, 'OK', { ex: 300 }); // Cache for 5 minutes
        } catch {}

    } catch (error) {
        if (error instanceof LimitExceededError) throw error;
        logger.error("Critical error in checkProjectTrafficLimits:", error);
        // On other errors (DB down etc), fail safe and don't block
    }
}

export async function checkApiKeyLimit(userId: string): Promise<void> {
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].apiKeys;

    const pool = getPgPool();
    const res = await pool.query('SELECT COUNT(*) as count FROM fluxbase_global.api_keys WHERE user_id = $1', [userId]);
    const count = parseInt(res.rows[0].count, 10);

    if (count >= limit) {
        throw new LimitExceededError(`API Key limit reached. Your ${plan.toUpperCase()} plan allows a maximum of ${limit} API keys. Please upgrade to create more.`);
    }
}

export async function checkWebhookLimit(projectId: string, userId: string): Promise<void> {
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].webhooks;

    if (limit === 0) {
        throw new LimitExceededError(`Webhooks are only available on the PRO and MAX plans. Please upgrade to access real-time event triggers.`);
    }

    const pool = getPgPool();
    const res = await pool.query('SELECT COUNT(*) as count FROM fluxbase_global.webhooks WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    const count = parseInt(res.rows[0].count, 10);

    if (count >= limit) {
        throw new LimitExceededError(`Webhook limit reached. Your ${plan.toUpperCase()} plan allows a maximum of ${limit} webhooks per project. Please upgrade to create more.`);
    }
}

export async function checkScraperLimit(projectId: string, userId: string): Promise<void> {
    const plan = await getUserPlan(userId);
    const limit = PLAN_LIMITS[plan].scrapers;

    if (limit === 0) {
        throw new LimitExceededError(`The Cloud Scraper Engine is only available on the PRO and MAX plans. Please upgrade to automate data extraction.`);
    }

    const pool = getPgPool();
    const res = await pool.query('SELECT COUNT(*) as count FROM fluxbase_global.fluxbase_scrapers WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    const count = parseInt(res.rows[0].count, 10);

    if (count >= limit) {
        throw new LimitExceededError(`Scraper limit reached. Your ${plan.toUpperCase()} plan allows a maximum of ${limit} scrapers per project. Please upgrade to allocate more engine workers.`);
    }
}

export async function checkInstanceSizeLimit(userId: string, requestedSize: string): Promise<void> {
    const plan = await getUserPlan(userId);
    const allowedSizes = PLAN_LIMITS[plan].allowedInstanceSizes;

    // We cast to readonly array check
    if (!allowedSizes.includes(requestedSize as any)) {
        throw new LimitExceededError(`Infrastructure Profile limit reached. Your ${plan.toUpperCase()} plan is not authorized to provision a '${requestedSize}' instance. Please upgrade your subscription to access larger database hardware.`);
    }
}
