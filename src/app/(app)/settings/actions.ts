'use server';

import { getCurrentUserId, invalidateAuthCache } from '@/lib/auth';
import { deleteProject, invalidateProjectCache } from '@/lib/data';
import { redis } from '@/lib/redis';
import { deleteUserAccount } from '@/lib/auth-actions';
import { revalidatePath } from 'next/cache';


export async function getUserPlanAction(): Promise<{ success: boolean; plan?: string; status?: string; error?: string }> {
    try {
        const userId = await getCurrentUserId();
        if (!userId) return { success: false, error: 'Unauthorized' };

        const { getPgPool } = await import('@/lib/pg');
        const pool = getPgPool();
        const { rows } = await pool.query(
            'SELECT plan_type, user_role, status FROM fluxbase_global.users WHERE id = $1',
            [userId]
        );

        let plan = rows[0]?.plan_type || 'free';
        const role = rows[0]?.user_role || 'student';
        if (role === 'student' && plan === 'pay_as_you_go') {
            plan = 'free';
        }

        return { success: true, plan, status: rows[0]?.status || 'active' };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateProjectSettingsAction(projectId: string, timezone: string) {
    const userId = await getCurrentUserId();
    if (!projectId || !userId || !timezone) {
        return { error: 'Missing required fields for project update.' };
    }

    try {
        const { getPgPool } = await import('@/lib/pg');
        const pool = getPgPool();
        await pool.query('UPDATE fluxbase_global.projects SET timezone = $1 WHERE project_id = $2 AND user_id = $3', [timezone, projectId, userId]);

        revalidatePath('/api');
        return { success: true };
    } catch (error) {
        logger.error('Failed to update project settings:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function updateProjectAiSettingsAction(projectId: string, allowDestructive: boolean, schemaInference: boolean) {
    const userId = await getCurrentUserId();
    if (!projectId || !userId) {
        return { error: 'Missing required fields for AI settings update.' };
    }

    try {
        const { getPgPool } = await import('@/lib/pg');
        const pool = getPgPool();
        await pool.query(
            'UPDATE fluxbase_global.projects SET ai_allow_destructive = $1, ai_schema_inference = $2 WHERE project_id = $3 AND user_id = $4',
            [allowDestructive, schemaInference, projectId, userId]
        );

        return { success: true };
    } catch (error) {
        logger.error('Failed to update AI settings:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function deleteProjectAction(projectId: string) {
    const userId = await getCurrentUserId();
    if (!projectId || !userId) {
        return { error: 'Missing required fields for project deletion.' };
    }

    try {
        await deleteProject(projectId);

        revalidatePath('/dashboard');
        revalidatePath('/dashboard/projects');
        return { success: true };

    } catch (error) {
        logger.error('Failed to delete project:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function clearOrganizationAction() {
    const userId = await getCurrentUserId();
    if (!userId) {
        return { error: 'User not authenticated.' };
    }

    try {
        await deleteUserAccount(userId);

        // No revalidate needed as we redirect
        return { success: true };

    } catch (error) {
        logger.error('Failed to clear organization:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function toggleOrganizationSuspensionAction(status: 'suspended' | 'active') {
    const userId = await getCurrentUserId();
    if (!userId) {
        return { error: 'User not authenticated.' };
    }

    try {
        const { getPgPool } = await import('@/lib/pg');
        const pool = getPgPool();
        await pool.query('UPDATE fluxbase_global.users SET status = $1 WHERE id = $2', [status, userId]);

        // Sync to Redis for global instant enforcement
        await redis.set(`org_status:${userId}`, status);

        await invalidateAuthCache(userId);

        revalidatePath('/settings');
        revalidatePath('/dashboard');
        return { success: true };

    } catch (error) {
        logger.error(`Failed to ${status === 'suspended' ? 'suspend' : 'resume'} organization:`, error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

// --- Webhooks Actions ---

import { createWebhook, deleteWebhook, getWebhooksForProject, updateWebhook, type WebhookEvent } from '@/lib/webhooks';
import logger from '@/lib/logger';

export async function getWebhooksAction(projectId: string) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error("Unauthorized");
        const webhooks = await getWebhooksForProject(projectId, userId);
        return { success: true, data: webhooks };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function createWebhookAction(projectId: string, name: string, url: string, event: WebhookEvent, tableId: string, secret?: string) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error("Unauthorized");
        const webhook = await createWebhook(projectId, userId, { name, url, event, table_id: tableId, secret, is_active: true });
        return { success: true, data: webhook };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function toggleWebhookAction(projectId: string, webhookId: string, isActive: boolean) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error("Unauthorized");
        await updateWebhook(projectId, userId, webhookId, { is_active: isActive });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteWebhookAction(projectId: string, webhookId: string) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error("Unauthorized");
        await deleteWebhook(projectId, userId, webhookId);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function toggleProjectSuspensionAction(projectId: string, status: 'active' | 'suspended') {
    try {
        const userId = await getCurrentUserId();
        if (!userId) return { success: false, error: 'Unauthorized' };

        const { getPgPool } = await import('@/lib/pg');
        const pool = getPgPool();
        
        // Ensure user owns the project or is member
        const { rows } = await pool.query(
            'SELECT 1 FROM fluxbase_global.projects WHERE project_id = $1 AND user_id = $2',
            [projectId, userId]
        );

        if (rows.length === 0) return { success: false, error: 'Project not found or permission denied' };

        await pool.query(
            'UPDATE fluxbase_global.projects SET status = $1 WHERE project_id = $2',
            [status, projectId]
        );

        // Sync to Redis for global instant enforcement
        await redis.set(`project_status:${projectId}`, status);

        await invalidateProjectCache(projectId);

        revalidatePath('/settings');
        revalidatePath('/dashboard');
        
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
