'use server';

import { createProject } from '@/lib/data';
import { provisionDatabaseInstance } from '@/lib/aws-rds';
import { checkInstanceSizeLimit, getUserPlan } from '@/lib/limits';
import { getCurrentUserId } from '@/lib/auth';
import { TenantProvisioner } from '@/lib/tenant-engine';
import { getPgPool } from '@/lib/pg';
import crypto from 'crypto';
import logger from '@/lib/logger';

export async function createProjectAction(formData: FormData) {
  const projectName = formData.get('projectName') as string;
  const dialect = formData.get('dialect') as string;
  const timezone = formData.get('timezone') as string;
  const instanceSize = formData.get('instanceSize') as string;
  const connectionType = (formData.get('connectionType') as string) || 'internal';
  const connectionConfigRaw = formData.get('connectionConfig') as string;
  const connectionConfig = connectionConfigRaw ? JSON.parse(connectionConfigRaw) : {};
  const importMode = (formData.get('importMode') as string) || 'direct';
  const userRole = (formData.get('userRole') as string) || (formData.get('role') as string) || 'student';
  const companyName = (formData.get('companyName') as string) || '';
  const workDescription = (formData.get('workDescription') as string) || '';

  const billingPreference = (formData.get('billingPreference') as string) || 'monthly';

  if (!projectName) {
    return { error: 'Project name is required.' };
  }

  const actualConnectionType = (connectionType !== 'internal' && importMode === 'import')
    ? 'internal'
    : connectionType;

  try {
    const userId = await getCurrentUserId();
    if (!userId) return { error: 'Unauthorized login required to create a project.' };

    // Idempotency guard: Prevent duplicate project creation if already provisioned (e.g. by payment webhook)
    const pool = getPgPool();
    const existingRecent = await pool.query(
        `SELECT project_id, display_name, schema_name FROM fluxbase_global.projects 
         WHERE user_id = $1 AND display_name = $2 AND created_at > NOW() - INTERVAL '30 minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, projectName]
    );
    if (existingRecent.rows.length > 0) {
        const p = existingRecent.rows[0];
        if (!p.schema_name && actualConnectionType === 'internal') {
            try {
                const tenantResult = await TenantProvisioner.createTenantSchema(
                    p.project_id,
                    dialect === 'mysql' ? 'mysql' : 'postgresql'
                );
                await pool.query(
                    'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
                    [tenantResult.schemaName, p.project_id]
                );
                p.schema_name = tenantResult.schemaName;
            } catch (err) {
                logger.error('[Provisioning Schema Error]:', err);
            }
        }
        return { success: true, project: p };
    }

    if (instanceSize && actualConnectionType === 'internal') {
        await checkInstanceSizeLimit(userId, instanceSize);
    }

    // 1. Create the project entry in the metadata table
    const project = await createProject(
      projectName, 
      "No description provided", 
      dialect || 'postgresql', 
      timezone,
      actualConnectionType as any,
      actualConnectionType === 'internal' ? {} : connectionConfig,
      userRole
    );

    // If role is employee or org_owner, record verification request and send email notification
    if (userRole === 'employee' || userRole === 'org_owner') {
      try {
        const { submitRoleRequest } = await import('@/lib/role-requests');
        const userRes = await pool.query('SELECT email FROM fluxbase_global.users WHERE id = $1', [userId]);
        const userEmail = userRes.rows[0]?.email;
        await submitRoleRequest({
          userId,
          userEmail,
          role: userRole as 'employee' | 'org_owner',
          companyName,
          workDescription,
          projectName,
          dialect: dialect || 'postgresql',
          billingPreference: billingPreference as any
        });
      } catch (reqErr) {
        logger.warn('[Role Request] Non-critical submission warning:', reqErr);
      }
    }

    // If copying database to internal cloud, run the schema & data replication helper
    if (connectionType !== 'internal' && importMode === 'import') {
      try {
        const { replicateExternalDatabase } = await import('@/lib/tenant-pools');
        await replicateExternalDatabase(project.project_id, dialect, connectionConfig);
      } catch (replicationError: any) {
        // Cleanup projects table entry on replication failure
        await pool.query('DELETE FROM fluxbase_global.projects WHERE project_id = $1', [project.project_id]);
        throw replicationError;
      }
    }

    // 2. Provision Supabase-style Serverless Tenant Schema ($0 cost, <50ms instant creation)
    if (actualConnectionType === 'internal') {
      try {
        const tenantResult = await TenantProvisioner.createTenantSchema(
          project.project_id,
          dialect === 'mysql' ? 'mysql' : 'postgresql'
        );

        await pool.query(
          'UPDATE fluxbase_global.projects SET is_serverless = true, schema_name = $1 WHERE project_id = $2',
          [tenantResult.schemaName, project.project_id]
        );
        project.schema_name = tenantResult.schemaName;
        project.is_serverless = true;
        project.role = 'admin';
        logger.info(`[Supabase Engine] Instant Serverless Tenant Created: ${tenantResult.schemaName} in ${tenantResult.executionTimeMs}ms`);
      } catch (tenantErr) {
        logger.error(`[Serverless Provisioning Error] Project ${project.project_id}:`, tenantErr);
      }
    }

    if (billingPreference) {
      await pool.query(
        'UPDATE fluxbase_global.projects SET billing_preference = $1 WHERE project_id = $2',
        [billingPreference, project.project_id]
      ).catch(() => {});
      project.billing_preference = billingPreference;
    }
    if (userRole) {
      project.creator_role = userRole;
    }

    if (billingPreference === 'pay_as_you_go') {
      try {
        await pool.query(
          "UPDATE fluxbase_global.users SET plan_type = 'pay_as_you_go', status = 'active' WHERE id = $1 AND plan_type NOT IN ('org_owner', 'max')",
          [userId]
        );
        const { getOrCreateCurrentCycle } = await import('@/lib/payg-engine');
        await getOrCreateCurrentCycle(project.project_id, userId);
        logger.info(`[PAYG Initialized] 28-day billing cycle active for project ${project.project_id}`);
      } catch (paygErr) {
        logger.warn('[PAYG Initialization Error]:', paygErr);
      }
    }

    return { success: true, project: project };
  } catch (error: any) {
    logger.error('Project creation failed:', error);
    return { error: error.message || 'Failed to create project.' };
  }
}

export async function getAllowedInstanceSizesAction() {
  const userId = await getCurrentUserId();
  if (!userId) return { allowedSizes: ['db.t3.micro'] as string[] }; // Default safe fallback

  try {
    const plan = await getUserPlan(userId);
    // Fetch directly from limits logic to avoid duplication
    switch (plan) {
      case 'max': return { allowedSizes: ['db.t3.micro', 'db.t3.medium', 'db.t3.large'] as string[] };
      case 'pro': return { allowedSizes: ['db.t3.micro', 'db.t3.medium'] as string[] };
      case 'free':
      default: return { allowedSizes: ['db.t3.micro'] as string[] };
    }
  } catch {
    return { allowedSizes: ['db.t3.micro'] as string[] };
  }
}

export async function testExternalConnectionAction(dialect: string, config: any) {
  try {
    if (dialect === 'postgresql') {
      const { Pool } = await import('pg');
      const client = new Pool({
        host: config.host,
        port: parseInt(config.port, 10) || 5432,
        user: config.user,
        password: config.password,
        database: config.database || 'postgres',
        ssl: config.ssl ? { rejectUnauthorized: true } : false,
        connectionTimeoutMillis: 5000,
      });
      await client.query('SELECT 1');
      await client.end();
    } else {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host: config.host,
        port: parseInt(config.port, 10) || 3306,
        user: config.user,
        password: config.password,
        database: config.database || undefined,
        ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
        connectTimeout: 5000,
      });
      await connection.ping();
      await connection.end();
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to connect to database' };
  }
}

export async function listExternalDatabasesAction(dialect: string, config: any) {
  try {
    if (dialect === 'postgresql') {
      const { Pool } = await import('pg');
      const client = new Pool({
        host: config.host,
        port: parseInt(config.port, 10) || 5432,
        user: config.user,
        password: config.password,
        database: config.database || 'postgres', // default admin db to query list
        ssl: config.ssl ? { rejectUnauthorized: true } : false,
        connectionTimeoutMillis: 5000,
      });
      const res = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;');
      await client.end();
      return { success: true, databases: res.rows.map(r => r.datname) };
    } else {
      const mysql = await import('mysql2/promise');
      const connection = await mysql.createConnection({
        host: config.host,
        port: parseInt(config.port, 10) || 3306,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
        connectTimeout: 5000,
      });
      const [rows]: any = await connection.query('SHOW DATABASES;');
      await connection.end();
      return { success: true, databases: rows.map((r: any) => Object.values(r)[0]) };
    }
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to list databases' };
  }
}

export async function getProjectDatabasesAction(projectId: string) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: 'Unauthorized' };

    const { getProjectById } = await import('@/lib/data');
    const project = await getProjectById(projectId, userId);
    if (!project) return { success: false, error: 'Project not found' };

    if (project.connection_type !== 'external_server') {
      return { success: false, error: 'Project is not connected to an external server' };
    }

    const config = typeof project.connection_config === 'string'
      ? JSON.parse(project.connection_config)
      : project.connection_config;

    return await listExternalDatabasesAction(project.dialect || 'postgresql', config);
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to list databases' };
  }
}

export async function checkGitHubConnectionAction(): Promise<{ connected: boolean; username?: string; connectedAt?: string }> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return { connected: false };
    const { getGitHubConnection } = await import('@/lib/github-token');
    const info = await getGitHubConnection(userId);
    return info || { connected: false };
  } catch {
    return { connected: false };
  }
}

export async function disconnectGitHubAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: 'Unauthorized' };
    const { revokeGitHubToken } = await import('@/lib/github-token');
    await revokeGitHubToken(userId);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || 'Failed to disconnect GitHub' };
  }
}
