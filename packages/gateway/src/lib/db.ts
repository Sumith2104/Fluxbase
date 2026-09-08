import { Pool } from 'pg';

declare global {
  var _gatewayPool: Pool | undefined;
}

export const FLUXBASE_SCHEMA =
  process.env.FLUXBASE_PROJECT_SCHEMA || 'flux_tenant_0e3d63b989b94d08';

const connectionString =
  process.env.AWS_RDS_POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  '';

const needsSsl = !!(
  connectionString.includes('rds.amazonaws.com') ||
  connectionString.includes('supabase') ||
  connectionString.includes('neon.tech') ||
  connectionString.includes('sslmode=require') ||
  process.env.NODE_ENV === 'production'
);

export const pool: Pool =
  global._gatewayPool ||
  new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
  });

if (process.env.NODE_ENV !== 'production') {
  global._gatewayPool = pool;
}

pool.on('connect', (client) => {
  client.query(`SET search_path TO ${FLUXBASE_SCHEMA}, gateway, public`).catch((err) => {
    console.warn('[Gateway DB] Error setting search_path:', err?.message || err);
  });
});

pool.on('error', (err: any) => {
  console.warn('[Gateway DB] Idle client warning:', err?.message || err);
});

export function getPool(): Pool {
  return pool;
}
