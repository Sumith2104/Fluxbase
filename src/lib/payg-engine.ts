import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

export interface PaygMetrics {
    totalRequests: number;
    totalTables: number;
    totalRows: number;
    storageMb: number;
    activeApiKeys: number;
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

/**
 * Calculates current bill and itemized line items from raw usage metrics.
 */
export function calculatePaygBill(metrics: PaygMetrics, depositCredit: number = 0): PaygBill {
    const { freeAllowance, unitRates } = PAYG_CONFIG;

    // 1. API Requests
    const excessRequests = Math.max(0, metrics.totalRequests - freeAllowance.requests);
    const requestUnits = Math.ceil(excessRequests / 50000);
    const requestCost = requestUnits * unitRates.per50kRequests;

    // 2. Tables
    const excessTables = Math.max(0, metrics.totalTables - freeAllowance.tables);
    const tableCost = excessTables * unitRates.perTable;

    // 3. Rows
    const excessRows = Math.max(0, metrics.totalRows - freeAllowance.rows);
    const rowUnits = Math.ceil(excessRows / 50000);
    const rowCost = rowUnits * unitRates.per50kRows;

    // 4. Storage MB
    const excessStorage = Math.max(0, metrics.storageMb - freeAllowance.storageMb);
    const storageUnits = Math.ceil(excessStorage / 100);
    const storageCost = storageUnits * unitRates.per100MbStorage;

    // 5. API Keys
    const excessKeys = Math.max(0, metrics.activeApiKeys - freeAllowance.apiKeys);
    const keyCost = excessKeys * unitRates.perApiKey;

    // 6. MCP Calls
    const excessMcp = Math.max(0, metrics.mcpCalls - freeAllowance.mcpCalls);
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
            freeAllowance: freeAllowance.requests,
            billableUnits: excessRequests,
            rateDescription: '₹10 / 50,000 reqs',
            cost: requestCost
        },
        {
            dimension: 'Database Tables',
            used: metrics.totalTables,
            unit: 'tables',
            freeAllowance: freeAllowance.tables,
            billableUnits: excessTables,
            rateDescription: '₹2 / table',
            cost: tableCost
        },
        {
            dimension: 'Database Rows',
            used: metrics.totalRows,
            unit: 'rows',
            freeAllowance: freeAllowance.rows,
            billableUnits: excessRows,
            rateDescription: '₹5 / 50,000 rows',
            cost: rowCost
        },
        {
            dimension: 'Disk Storage',
            used: metrics.storageMb,
            unit: 'MB',
            freeAllowance: freeAllowance.storageMb,
            billableUnits: Number(excessStorage.toFixed(2)),
            rateDescription: '₹15 / 100 MB',
            cost: storageCost
        },
        {
            dimension: 'Active API Keys',
            used: metrics.activeApiKeys,
            unit: 'keys',
            freeAllowance: freeAllowance.apiKeys,
            billableUnits: excessKeys,
            rateDescription: '₹5 / key',
            cost: keyCost
        },
        {
            dimension: 'MCP Tool Calls',
            used: metrics.mcpCalls,
            unit: 'calls',
            freeAllowance: freeAllowance.mcpCalls,
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
export async function fetchProjectRealtimeMetrics(projectId: string, dialect: string, cycleStart: Date): Promise<PaygMetrics> {
    const pool = getPgPool();
    const isMysql = dialect?.toLowerCase() === 'mysql';

    let totalRequests = 0;
    let totalTables = 0;
    let totalRows = 0;
    let storageMb = 0;
    let activeApiKeys = 0;
    let mcpCalls = 0;

    // 1. Audit logs: Requests and MCP tool calls since cycleStart
    try {
        const auditRes = await pool.query(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE action = 'mcp_tool_call') as mcp_calls
            FROM fluxbase_global.audit_logs 
            WHERE project_id = $1 AND created_at >= $2
        `, [projectId, cycleStart]);

        totalRequests = parseInt(auditRes.rows[0]?.total_requests || '0', 10);
        mcpCalls = parseInt(auditRes.rows[0]?.mcp_calls || '0', 10);
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

/**
 * Gets or initializes the active 28-day billing cycle for a project.
 * Automatically handles rolling rollover when 28 days expire.
 */
export async function getOrCreateCurrentCycle(projectId: string, fallbackUserId?: string): Promise<PaygCycleRecord> {
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
        // Finalize old cycle
        const currentDeposit = parseFloat(cycleRow.deposit_credit || '0');
        const finalMetrics = await fetchProjectRealtimeMetrics(projectId, project.dialect, new Date(cycleRow.cycle_start));
        const finalBill = calculatePaygBill(finalMetrics, currentDeposit);
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
    const currentMetrics = await fetchProjectRealtimeMetrics(projectId, project.dialect, currentCycleStart);
    const bill = calculatePaygBill(currentMetrics, depositCredit);

    // Sync metrics into database row for historical reporting
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
        bill.totalAmount,
        cycleRow.id
    ]);

    const startMs = currentCycleStart.getTime();
    const endMs = new Date(cycleRow.cycle_end).getTime();
    const nowMs = now.getTime();

    const totalDays = PAYG_CONFIG.cycleDurationDays;
    const daysElapsed = Math.min(totalDays, Math.max(0, Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24))));
    const daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / (1000 * 60 * 60 * 24)));

    return {
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
        status: cycleRow.status
    };
}
