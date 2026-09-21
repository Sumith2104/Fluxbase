import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';
import { LRUCache } from 'lru-cache';

export interface PaygMetrics {
    totalRequests: number;
    totalTables: number;
    totalRows: number;
    storageMb: number;
    activeApiKeys: number;
    mcpCalls: number;
}

export interface PaygCheckpoint {
    updatedAt: Date;
    totalRequests: number;
    mcpCalls: number;
}

export interface PaygBreakdownItem {
    dimension: string;
    used: number;
    unit: string;
    freeAllowance: number;
    billableUnits: number;
    rateDescription: string;
    cost: number;
}

export interface PaygBill {
    grossAmount: number;
    depositCreditApplied: number;
    totalAmount: number;
    breakdown: PaygBreakdownItem[];
}

export interface UserPlanInfo {
    plan: string;
    role: string;
    isSubscription: boolean;
    planName: string;
    billingCycleEnd: string | null;
}

export interface PaygCycleRecord {
    id: number;
    projectId: string;
    userId: string;
    cycleNumber: number;
    cycleStart: string;
    cycleEnd: string;
    daysRemaining: number;
    daysElapsed: number;
    totalDays: number;
    metrics: PaygMetrics;
    bill: PaygBill;
    spendingLimit: number;
    depositCredit: number;
    status: 'active' | 'due' | 'paid' | 'grace_period';
    userPlan?: UserPlanInfo;
}

export const PAYG_CONFIG = {
    cycleDurationDays: 28,
    freeAllowance: {
        requests: 50000,
        tables: 5,
        rows: 25000,
        storageMb: 100,
        apiKeys: 2,
        mcpCalls: 100
    },
    unitRates: {
        per50kRequests: 10,     // ₹10 per 50k requests beyond 50k
        perTable: 2,            // ₹2 per table beyond 5
        per50kRows: 5,          // ₹5 per 50k rows beyond 25k
        per100MbStorage: 15,    // ₹15 per 100 MB beyond 100 MB
        perApiKey: 5,           // ₹5 per API key beyond 2
        per500McpCalls: 10      // ₹10 per 500 MCP calls beyond 100
    }
};

export function getPlanAllowance(plan: string = '', role: string = '') {
    const p = (plan || '').toLowerCase();
    const r = (role || p || '').toLowerCase();

    if (r === 'org_owner' || p === 'org_owner' || p === 'org') {
        return {
            requests: 5000000,
            tables: 100,
            rows: 10000000,
            storageMb: 100 * 1024,
            apiKeys: 50,
            mcpCalls: 10000,
            planName: 'Organization Owner Tier',
            isSubscription: true,
            overageRatePer10kReqs: 2.00,
            overageRatePerGbStorage: 15.00
        };
    } else if (r === 'employee' || p === 'employee') {
        return {
            requests: 500000,
            tables: 50,
            rows: 2500000,
            storageMb: 10 * 1024,
            apiKeys: 20,
            mcpCalls: 2000,
            planName: 'Employee Tier',
            isSubscription: true,
            overageRatePer10kReqs: 0.50,
            overageRatePerGbStorage: 5.00
        };
    } else if (p === 'max') {
        return {
            requests: 1000000,
            tables: 50,
            rows: 5000000,
            storageMb: 20 * 1024,
            apiKeys: 25,
            mcpCalls: 5000,
            planName: 'Developer Max Tier',
            isSubscription: true,
            overageRatePer10kReqs: 1.00,
            overageRatePerGbStorage: 8.00
        };
    } else if (p === 'pro') {
        return {
            requests: 250000,
            tables: 20,
            rows: 1000000,
            storageMb: 5 * 1024,
            apiKeys: 10,
            mcpCalls: 1000,
            planName: 'Developer Pro Tier',
            isSubscription: true,
            overageRatePer10kReqs: 1.00,
            overageRatePerGbStorage: 10.00
        };
    } else if (p === 'pay_as_you_go' || p === 'payg') {
        return {
            requests: 50000,
            tables: 5,
            rows: 25000,
            storageMb: 100,
            apiKeys: 2,
            mcpCalls: 100,
            planName: 'Pay-As-You-Go',
            isSubscription: false,
            overageRatePer10kReqs: 2.00,
            overageRatePerGbStorage: 15.00
        };
    }

    return {
        requests: 50000,
        tables: 5,
        rows: 25000,
        storageMb: 500,
        apiKeys: 2,
        mcpCalls: 100,
        planName: 'Student Free Tier',
        isSubscription: false,
        overageRatePer10kReqs: 2.00,
        overageRatePerGbStorage: 15.00
    };
}

/**
 * Calculates current bill and itemized line items from raw usage metrics.
 * Subscription tiers (org_owner, employee, max, pro) have full quotas covered by monthly plan.
 */
export function calculatePaygBill(
    metrics: PaygMetrics, 
    depositCredit: number = 0,
    planInfo?: { plan: string; role?: string }
): PaygBill {
    const allowance = getPlanAllowance(planInfo?.plan || '', planInfo?.role || '');
    const { unitRates } = PAYG_CONFIG;

    if (allowance.isSubscription) {
        // Subscription Tier (e.g. Org Owner):
        // Base allowance is fully covered by monthly fee. Overage applies ONLY beyond included limits.
        const excessRequests = Math.max(0, metrics.totalRequests - allowance.requests);
        const requestCost = excessRequests > 0 ? Math.ceil(excessRequests / 10000) * allowance.overageRatePer10kReqs : 0;

        const excessTables = Math.max(0, metrics.totalTables - allowance.tables);
        const tableCost = excessTables > 0 ? excessTables * 2 : 0;

        const excessRows = Math.max(0, metrics.totalRows - allowance.rows);
        const rowCost = excessRows > 0 ? Math.ceil(excessRows / 50000) * 5 : 0;

        const excessStorageMb = Math.max(0, metrics.storageMb - allowance.storageMb);
        const excessStorageGb = excessStorageMb / 1024;
        const storageCost = excessStorageGb > 0 ? Number((excessStorageGb * allowance.overageRatePerGbStorage).toFixed(2)) : 0;

        const excessKeys = Math.max(0, metrics.activeApiKeys - allowance.apiKeys);
        const keyCost = excessKeys > 0 ? excessKeys * 5 : 0;

        const excessMcp = Math.max(0, metrics.mcpCalls - allowance.mcpCalls);
        const mcpCost = excessMcp > 0 ? Math.ceil(excessMcp / 500) * 10 : 0;

        const grossAmount = Number((requestCost + tableCost + rowCost + storageCost + keyCost + mcpCost).toFixed(2));
        const totalAmount = grossAmount;

        const breakdown: PaygBreakdownItem[] = [
            {
                dimension: 'API & Query Requests',
                used: metrics.totalRequests,
                unit: 'requests',
                freeAllowance: allowance.requests,
                billableUnits: excessRequests,
                rateDescription: excessRequests === 0 
                    ? `100% Covered (${allowance.requests.toLocaleString()} included in plan)`
                    : `₹${allowance.overageRatePer10kReqs} / 10k excess beyond ${allowance.requests.toLocaleString()}`,
                cost: requestCost
            },
            {
                dimension: 'Database Tables',
                used: metrics.totalTables,
                unit: 'tables',
                freeAllowance: allowance.tables,
                billableUnits: excessTables,
                rateDescription: excessTables === 0 ? 'Included in subscription' : '₹2 / table excess',
                cost: tableCost
            },
            {
                dimension: 'Database Rows',
                used: metrics.totalRows,
                unit: 'rows',
                freeAllowance: allowance.rows,
                billableUnits: excessRows,
                rateDescription: excessRows === 0 ? 'Included in subscription' : '₹5 / 50k rows excess',
                cost: rowCost
            },
            {
                dimension: 'Storage Footprint',
                used: metrics.storageMb,
                unit: 'MB',
                freeAllowance: allowance.storageMb,
                billableUnits: excessStorageMb,
                rateDescription: excessStorageMb === 0 
                    ? `100% Covered (${(allowance.storageMb / 1024).toFixed(0)}GB included in plan)`
                    : `₹${allowance.overageRatePerGbStorage} / GB excess`,
                cost: storageCost
            },
            {
                dimension: 'Active API Keys',
                used: metrics.activeApiKeys,
                unit: 'keys',
                freeAllowance: allowance.apiKeys,
                billableUnits: excessKeys,
                rateDescription: excessKeys === 0 ? 'Included in subscription' : '₹5 / key excess',
                cost: keyCost
            },
            {
                dimension: 'MCP Tool Calls',
                used: metrics.mcpCalls,
                unit: 'calls',
                freeAllowance: allowance.mcpCalls,
                billableUnits: excessMcp,
                rateDescription: excessMcp === 0 ? 'Included in subscription' : '₹10 / 500 excess',
                cost: mcpCost
            }
        ];

        return {
            grossAmount,
            depositCreditApplied: 0,
            totalAmount,
            breakdown
        };
    }

    // 1. API Requests
    const excessRequests = Math.max(0, metrics.totalRequests - allowance.requests);
    const requestUnits = Math.ceil(excessRequests / 50000);
    const requestCost = requestUnits * unitRates.per50kRequests;

    // 2. Tables
    const excessTables = Math.max(0, metrics.totalTables - allowance.tables);
    const tableCost = excessTables * unitRates.perTable;

    // 3. Rows
    const excessRows = Math.max(0, metrics.totalRows - allowance.rows);
    const rowUnits = Math.ceil(excessRows / 50000);
    const rowCost = rowUnits * unitRates.per50kRows;

    // 4. Storage MB
    const excessStorage = Math.max(0, metrics.storageMb - allowance.storageMb);
    const storageUnits = Math.ceil(excessStorage / 100);
    const storageCost = storageUnits * unitRates.per100MbStorage;

    // 5. API Keys
    const excessKeys = Math.max(0, metrics.activeApiKeys - allowance.apiKeys);
    const keyCost = excessKeys * unitRates.perApiKey;

    // 6. MCP Calls
    const excessMcp = Math.max(0, metrics.mcpCalls - allowance.mcpCalls);
    const mcpUnits = Math.ceil(excessMcp / 500);
    const mcpCost = mcpUnits * unitRates.per500McpCalls;

    const grossAmount = Number((requestCost + tableCost + rowCost + storageCost + keyCost + mcpCost).toFixed(2));
    const depositCreditApplied = depositCredit > 0 ? Math.min(grossAmount, depositCredit) : 0;
    const totalAmount = Number((grossAmount - depositCreditApplied).toFixed(2));

    const breakdown: PaygBreakdownItem[] = [
        {
            dimension: 'API Requests',
            used: metrics.totalRequests,
            unit: 'requests',
            freeAllowance: allowance.requests,
            billableUnits: excessRequests,
            rateDescription: '₹10 / 50,000 reqs',
            cost: requestCost
        },
        {
            dimension: 'Database Tables',
            used: metrics.totalTables,
            unit: 'tables',
            freeAllowance: allowance.tables,
            billableUnits: excessTables,
            rateDescription: '₹2 / table',
            cost: tableCost
        },
        {
            dimension: 'Database Rows',
            used: metrics.totalRows,
            unit: 'rows',
            freeAllowance: allowance.rows,
            billableUnits: excessRows,
            rateDescription: '₹5 / 50,000 rows',
            cost: rowCost
        },
        {
            dimension: 'Storage Footprint',
            used: metrics.storageMb,
            unit: 'MB',
            freeAllowance: allowance.storageMb,
            billableUnits: excessStorage,
            rateDescription: '₹15 / 100 MB',
            cost: storageCost
        },
        {
            dimension: 'Active API Keys',
            used: metrics.activeApiKeys,
            unit: 'keys',
            freeAllowance: allowance.apiKeys,
            billableUnits: excessKeys,
            rateDescription: '₹5 / key',
            cost: keyCost
        },
        {
            dimension: 'MCP Tool Calls',
            used: metrics.mcpCalls,
            unit: 'calls',
            freeAllowance: allowance.mcpCalls,
            billableUnits: excessMcp,
            rateDescription: '₹10 / 500 calls',
            cost: mcpCost
        }
    ];

    if (depositCredit > 0) {
        breakdown.push({
            dimension: 'Verification Deposit Credit',
            used: 1,
            unit: 'deposit credit',
            freeAllowance: 0,
            billableUnits: 0,
            rateDescription: '₹50.00 refundable verification deposit credited on 1st month bill',
            cost: -depositCreditApplied
        });
    }

    return { 
        grossAmount,
        depositCreditApplied,
        totalAmount, 
        breakdown 
    };
}

/**
 * Fetches real-time metered metrics for a given project from tenant database and audit tables.
 */
export async function fetchProjectRealtimeMetrics(
    projectId: string, 
    dialect: string, 
    cycleStart: Date,
    checkpoint?: PaygCheckpoint
): Promise<PaygMetrics> {
    const pool = getPgPool();
    const isMysql = dialect?.toLowerCase() === 'mysql';

    let totalRequests = 0;
    let totalTables = 0;
    let totalRows = 0;
    let storageMb = 0;
    let activeApiKeys = 0;
    let mcpCalls = 0;

    // 1. Audit logs: Requests and MCP tool calls
    try {
        const canUseDelta = checkpoint && 
            checkpoint.updatedAt && 
            new Date(checkpoint.updatedAt).getTime() >= new Date(cycleStart).getTime() && 
            checkpoint.totalRequests >= 0;

        if (canUseDelta) {
            // High-performance incremental count: counts only append-only audit events since last checkpoint
            const auditRes = await pool.query(`
                SELECT 
                    COUNT(*) as delta_requests,
                    COUNT(*) FILTER (WHERE action = 'mcp_tool_call') as delta_mcp
                FROM fluxbase_global.audit_logs 
                WHERE project_id = $1 AND created_at > $2
            `, [projectId, checkpoint.updatedAt]);

            const deltaRequests = parseInt(auditRes.rows[0]?.delta_requests || '0', 10);
            const deltaMcp = parseInt(auditRes.rows[0]?.delta_mcp || '0', 10);

            totalRequests = checkpoint.totalRequests + deltaRequests;
            mcpCalls = (checkpoint.mcpCalls || 0) + deltaMcp;
        } else {
            // Full cycle count when no prior checkpoint exists in this cycle
            const auditRes = await pool.query(`
                SELECT 
                    COUNT(*) as total_requests,
                    COUNT(*) FILTER (WHERE action = 'mcp_tool_call') as mcp_calls
                FROM fluxbase_global.audit_logs 
                WHERE project_id = $1 AND created_at >= $2
            `, [projectId, cycleStart]);

            totalRequests = parseInt(auditRes.rows[0]?.total_requests || '0', 10);
            mcpCalls = parseInt(auditRes.rows[0]?.mcp_calls || '0', 10);
        }
    } catch (e) {
        logger.warn('[PAYG Meter] Error fetching audit logs:', e);
    }

    // 2. Active API Keys
    try {
        const keyRes = await pool.query(
            'SELECT COUNT(*) as count FROM fluxbase_global.api_keys WHERE project_id = $1',
            [projectId]
        );
        activeApiKeys = parseInt(keyRes.rows[0]?.count || '0', 10);
    } catch (e) {
        logger.warn('[PAYG Meter] Error fetching API keys:', e);
    }

    // Resolve tenant database and schema dynamically
    let project: any = null;
    try {
        const projectRes = await pool.query(
            'SELECT project_id, dialect, connection_type, connection_config, schema_name, is_serverless FROM fluxbase_global.projects WHERE project_id = $1',
            [projectId]
        );
        project = projectRes.rows[0];
    } catch (e) {
        logger.warn('[PAYG Meter] Error fetching project record:', e);
    }

    const { getProjectDbAndSchema } = await import('@/lib/tenant-pools');
    const dbInfo = project ? getProjectDbAndSchema(project) : {
        dbName: `project_${projectId}`,
        schemaName: `project_${projectId}`
    };
    const dbName = dbInfo.dbName || `project_${projectId}`;
    const schemaName = dbInfo.schemaName || `project_${projectId}`;

    // 3. Database Tables, Rows, and Storage
    if (isMysql) {
        try {
            const { getMysqlPool } = await import('@/lib/mysql');
            const mysqlPool = getMysqlPool();
            const [rows]: any = await mysqlPool.query(`
                SELECT 
                    COUNT(*) as table_count,
                    COALESCE(SUM(table_rows), 0) as row_count,
                    COALESCE(SUM(data_length + index_length), 0) as total_bytes
                FROM information_schema.tables 
                WHERE table_schema = ?
                  AND table_type = 'BASE TABLE'
                  AND table_name NOT LIKE '\\_flux\\_%'
            `, [dbName]);

            if (rows && rows[0]) {
                totalTables = parseInt(rows[0].table_count || '0', 10);
                totalRows = parseInt(rows[0].row_count || '0', 10);
                storageMb = Number(((parseInt(rows[0].total_bytes || '0', 10)) / (1024 * 1024)).toFixed(2));
            }
        } catch (e) {
            logger.warn('[PAYG Meter] Error fetching MySQL metrics:', e);
        }
    } else {
        // PostgreSQL tenant schema
        try {
            const schemaStats = await pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM pg_tables WHERE schemaname = $1 AND tablename NOT LIKE '_flux_%') as table_count,
                    (SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables WHERE schemaname = $1 AND relname NOT LIKE '_flux_%') as row_count,
                    (SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0) 
                     FROM pg_tables WHERE schemaname = $1 AND tablename NOT LIKE '_flux_%') as total_bytes
            `, [schemaName]);

            if (schemaStats.rows.length > 0) {
                totalTables = parseInt(schemaStats.rows[0].table_count || '0', 10);
                totalRows = parseInt(schemaStats.rows[0].row_count || '0', 10);
                const bytes = parseInt(schemaStats.rows[0].total_bytes || '0', 10);
                storageMb = Number((bytes / (1024 * 1024)).toFixed(2));
            }
        } catch (e) {
            logger.warn('[PAYG Meter] Error fetching Postgres schema metrics:', e);
        }
    }

    // 4. S3 Object Storage
    try {
        const s3Res = await pool.query(`
            SELECT COALESCE(SUM(size), 0) as s3_bytes
            FROM fluxbase_global.storage_objects
            WHERE project_id = $1
        `, [projectId]);
        const s3Bytes = parseInt(s3Res.rows[0]?.s3_bytes || '0', 10);
        const s3Mb = s3Bytes / (1024 * 1024);
        storageMb = Number((storageMb + s3Mb).toFixed(2));
    } catch (e) {
        logger.warn('[PAYG Meter] Error fetching S3 object storage metrics:', e);
    }

    return {
        totalRequests,
        totalTables,
        totalRows,
        storageMb,
        activeApiKeys,
        mcpCalls
    };
}

const _cycleMemoryCache = new LRUCache<string, PaygCycleRecord>({ max: 200, ttl: 45 * 1000 });

export function invalidatePaygCache(projectId?: string) {
    if (projectId) {
        _cycleMemoryCache.delete(projectId);
    } else {
        _cycleMemoryCache.clear();
    }
}

/**
 * Gets or initializes the active 28-day billing cycle for a project.
 * Automatically handles rolling rollover when 28 days expire.
 * Uses intelligent checkpointing and cache to return metrics in < 50ms without full-table log scans.
 */
export async function getOrCreateCurrentCycle(
    projectId: string, 
    fallbackUserId?: string,
    forceRecalculate: boolean = false
): Promise<PaygCycleRecord> {
    if (!forceRecalculate) {
        const memoryHit = _cycleMemoryCache.get(projectId);
        if (memoryHit) {
            return memoryHit;
        }
    }

    const pool = getPgPool();

    // 1. Fetch project info to get creation date and dialect
    const pRes = await pool.query(
        'SELECT project_id, user_id, dialect, created_at FROM fluxbase_global.projects WHERE project_id = $1',
        [projectId]
    );

    if (pRes.rows.length === 0) {
        throw new Error(`Project ${projectId} not found`);
    }

    const project = pRes.rows[0];
    const userId = project.user_id || fallbackUserId;
    const projectCreatedAt = new Date(project.created_at || Date.now());

    let userRow: any = {};
    if (userId) {
        try {
            const uRes = await pool.query(
                'SELECT plan_type, user_role, billing_cycle_end, status FROM fluxbase_global.users WHERE id = $1::text',
                [userId]
            );
            userRow = uRes.rows[0] || {};
        } catch (e) {
            logger.warn('[PAYG Meter] Error fetching user plan:', e);
        }
    }

    const plan = (userRow.plan_type || 'free').toLowerCase();
    const role = (userRow.user_role || plan || 'student').toLowerCase();
    const planAllowance = getPlanAllowance(plan, role);
    const userPlanInfo: UserPlanInfo = {
        plan,
        role,
        isSubscription: planAllowance.isSubscription,
        planName: planAllowance.planName,
        billingCycleEnd: userRow.billing_cycle_end ? new Date(userRow.billing_cycle_end).toISOString() : null
    };

    // 2. Look for an active cycle
    const cycleRes = await pool.query(`
        SELECT * FROM fluxbase_global.payg_usage_cycles 
        WHERE project_id = $1 AND status = 'active'
        ORDER BY cycle_number DESC LIMIT 1
    `, [projectId]);

    let cycleRow = cycleRes.rows[0];

    // If no active cycle exists, initialize Cycle 1 starting on project creation date
    if (!cycleRow) {
        const cycleStart = projectCreatedAt;
        const cycleEnd = new Date(cycleStart.getTime() + PAYG_CONFIG.cycleDurationDays * 24 * 60 * 60 * 1000);

        const initRes = await pool.query(`
            INSERT INTO fluxbase_global.payg_usage_cycles 
                (project_id, user_id, cycle_number, cycle_start, cycle_end, deposit_credit, status)
            VALUES ($1, $2, 1, $3, $4, 50.00, 'active')
            ON CONFLICT (project_id, cycle_number) DO UPDATE 
                SET status = 'active'
            RETURNING *;
        `, [projectId, userId, cycleStart, cycleEnd]);

        cycleRow = initRes.rows[0];
    }

    // Check if the current cycle has expired (28 days elapsed)
    const now = new Date();
    const cycleEndDate = new Date(cycleRow.cycle_end);

    if (now > cycleEndDate) {
        // Finalize old cycle using checkpoint if available
        const currentDeposit = parseFloat(cycleRow.deposit_credit || '0');
        const oldCheckpoint: PaygCheckpoint | undefined = (cycleRow.updated_at && cycleRow.total_requests !== null) ? {
            updatedAt: new Date(cycleRow.updated_at),
            totalRequests: parseInt(cycleRow.total_requests || '0', 10),
            mcpCalls: parseInt(cycleRow.mcp_calls || '0', 10)
        } : undefined;

        const finalMetrics = await fetchProjectRealtimeMetrics(projectId, project.dialect, new Date(cycleRow.cycle_start), oldCheckpoint);
        const finalBill = calculatePaygBill(finalMetrics, currentDeposit, userPlanInfo);
        const leftoverCredit = Math.max(0, currentDeposit - finalBill.grossAmount);

        await pool.query(`
            UPDATE fluxbase_global.payg_usage_cycles 
            SET status = 'due', 
                total_requests = $1, 
                total_tables = $2, 
                total_rows = $3, 
                storage_mb = $4, 
                active_api_keys = $5, 
                mcp_calls = $6, 
                calculated_amount = $7, 
                updated_at = NOW()
            WHERE id = $8;
        `, [
            finalMetrics.totalRequests,
            finalMetrics.totalTables,
            finalMetrics.totalRows,
            finalMetrics.storageMb,
            finalMetrics.activeApiKeys,
            finalMetrics.mcpCalls,
            finalBill.totalAmount,
            cycleRow.id
        ]);

        // Rollover: Spawn next cycle starting exactly when the previous cycle ended
        const nextCycleNumber = cycleRow.cycle_number + 1;
        const nextCycleStart = cycleEndDate;
        const nextCycleEnd = new Date(nextCycleStart.getTime() + PAYG_CONFIG.cycleDurationDays * 24 * 60 * 60 * 1000);

        const nextRes = await pool.query(`
            INSERT INTO fluxbase_global.payg_usage_cycles 
                (project_id, user_id, cycle_number, cycle_start, cycle_end, deposit_credit, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'active')
            ON CONFLICT (project_id, cycle_number) DO UPDATE 
                SET status = 'active'
            RETURNING *;
        `, [projectId, userId, nextCycleNumber, nextCycleStart, nextCycleEnd, leftoverCredit]);

        cycleRow = nextRes.rows[0];
    }

    // 3. Compute real-time metrics and bill for current active cycle
    const currentCycleStart = new Date(cycleRow.cycle_start);
    const depositCredit = parseFloat(cycleRow.deposit_credit || '0');

    // Freshness check: if metrics are recent (< 2 minutes old) and forceRecalculate is false, serve instantly
    const rowUpdatedAt = cycleRow.updated_at ? new Date(cycleRow.updated_at).getTime() : 0;
    const isFresh = cycleRow.total_requests !== null && (Date.now() - rowUpdatedAt < 2 * 60 * 1000);

    let currentMetrics: PaygMetrics;

    if (!forceRecalculate && isFresh) {
        currentMetrics = {
            totalRequests: parseInt(cycleRow.total_requests || '0', 10),
            totalTables: parseInt(cycleRow.total_tables || '0', 10),
            totalRows: parseInt(cycleRow.total_rows || '0', 10),
            storageMb: parseFloat(cycleRow.storage_mb || '0'),
            activeApiKeys: parseInt(cycleRow.active_api_keys || '0', 10),
            mcpCalls: parseInt(cycleRow.mcp_calls || '0', 10),
        };
    } else {
        // Incremental recalculation: counts only delta audit events since checkpoint
        const checkpoint: PaygCheckpoint | undefined = (cycleRow.updated_at && cycleRow.total_requests !== null) ? {
            updatedAt: new Date(cycleRow.updated_at),
            totalRequests: parseInt(cycleRow.total_requests || '0', 10),
            mcpCalls: parseInt(cycleRow.mcp_calls || '0', 10)
        } : undefined;

        currentMetrics = await fetchProjectRealtimeMetrics(projectId, project.dialect, currentCycleStart, checkpoint);
        const billPreview = calculatePaygBill(currentMetrics, depositCredit, userPlanInfo);

        // Sync updated metrics into database row for reporting and next delta
        await pool.query(`
            UPDATE fluxbase_global.payg_usage_cycles 
            SET total_requests = $1, 
                total_tables = $2, 
                total_rows = $3, 
                storage_mb = $4, 
                active_api_keys = $5, 
                mcp_calls = $6, 
                calculated_amount = $7, 
                updated_at = NOW()
            WHERE id = $8;
        `, [
            currentMetrics.totalRequests,
            currentMetrics.totalTables,
            currentMetrics.totalRows,
            currentMetrics.storageMb,
            currentMetrics.activeApiKeys,
            currentMetrics.mcpCalls,
            billPreview.totalAmount,
            cycleRow.id
        ]);
    }

    const bill = calculatePaygBill(currentMetrics, depositCredit, userPlanInfo);

    const startMs = currentCycleStart.getTime();
    const endMs = new Date(cycleRow.cycle_end).getTime();
    const nowMs = now.getTime();

    const totalDays = PAYG_CONFIG.cycleDurationDays;
    const daysElapsed = Math.min(totalDays, Math.max(0, Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24))));
    const daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / (1000 * 60 * 60 * 24)));

    const record: PaygCycleRecord = {
        id: cycleRow.id,
        projectId,
        userId,
        cycleNumber: cycleRow.cycle_number,
        cycleStart: currentCycleStart.toISOString(),
        cycleEnd: new Date(cycleRow.cycle_end).toISOString(),
        daysRemaining,
        daysElapsed,
        totalDays,
        metrics: currentMetrics,
        bill,
        spendingLimit: parseFloat(cycleRow.spending_limit || '1000'),
        depositCredit,
        status: cycleRow.status,
        userPlan: userPlanInfo
    };

    _cycleMemoryCache.set(projectId, record);
    return record;
}
