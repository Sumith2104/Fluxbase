import { Pool } from 'pg';
import { ERROR_CODES } from './error-codes';
import { NextResponse } from 'next/server';

// --- GLOBAL POOL SINGLETON (Serverless Optimization) ---
declare global {
    var _pool: Pool | undefined;
}

const isServerless = process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
// AWS RDS db.t3/t4g instances have max_connections = 81. Keeping pool max at 10 leaves
// ample capacity for other lambdas, background workers, and dev server reloads.
const defaultPoolMax = isServerless ? '8' : '20';

const connectionString = process.env.AWS_RDS_POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const needsSsl = !!(
    connectionString?.includes('rds.amazonaws.com') ||
    connectionString?.includes('supabase') ||
    connectionString?.includes('neon.tech') ||
    connectionString?.includes('sslmode=require') ||
    process.env.NODE_ENV === 'production'
);

const isNewPool = !global._pool;

export const pool: Pool = global._pool || new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: parseInt(process.env.DATABASE_POOL_MAX || defaultPoolMax, 10),
    // 5 minutes in dedicated EC2 production to maintain warm pool; 5s in ephemeral serverless
    idleTimeoutMillis: isServerless ? 5000 : 300000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
});

global._pool = pool;

if (isNewPool) {
    // Pre-warm connection pool immediately in background so first query does not suffer cold TLS handshake
    if (connectionString) {
        pool.query('SELECT 1').catch(() => {});
    }

    pool.on('error', (err: any) => {
        console.warn('[PostgreSQL Pool] Idle client warning (handled safely):', err?.message || err);
    });

    if (typeof process !== 'undefined') {
        const handleShutdown = async () => {
            try {
                await pool.end();
            } catch {}
        };
        process.once('SIGTERM', handleShutdown);
        process.once('SIGINT', handleShutdown);
    }
}

// Keep backward compatibility for existing routes
export function getPgPool(): Pool {
    return pool;
}


/**
 * Standard utility to handle database connectivity errors and return 503 instead of 500.
 */
export function handleDatabaseError(e: any) {
    console.error('[Database Error Details]:', {
        message: e.message,
        code: e.code,
        syscall: e.syscall,
        hostname: e.hostname
    });

    const isConnectivityError = 
        e.code === 'ENOTFOUND' || 
        e.code === 'ECONNRESET' || 
        e.code === 'ETIMEDOUT' ||
        e.message?.includes('Connection terminated');

    if (isConnectivityError) {
        return NextResponse.json({
            success: false,
            error: {
                message: "Database host unreachable. Our infrastructure is currently experiencing a DNS or connectivity spike. Please try again in a few moments.",
                code: ERROR_CODES.DATABASE_CONNECTION_ERROR
            }
        }, { status: 503 });
    }

    // Default error response
    return NextResponse.json({
        success: false,
        error: {
            message: e.message || "An unexpected database error occurred.",
            code: ERROR_CODES.INTERNAL_ERROR
        }
    }, { status: 500 });
}

