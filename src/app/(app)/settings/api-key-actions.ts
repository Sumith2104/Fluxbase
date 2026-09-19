'use server';

import { generateApiKey, listApiKeys, revokeApiKey } from '@/lib/api-keys';
import { getCurrentUserId } from '@/lib/auth';


import { getProjectById, getProjectsForCurrentUser } from '@/lib/data';

export async function createApiKeyAction(name: string, projectId?: string, scopes: string[] = ['read']) {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: "Not authenticated" };

    try {
        const { checkApiKeyLimit } = await import('@/lib/limits');
        await checkApiKeyLimit(userId);

        let projectName: string | undefined;

        if (projectId) {
            const project = await getProjectById(projectId, userId);
            if (!project) {
                return { success: false, error: "Project not found or unauthorized" };
            }
            projectName = project.display_name;
        }

        const result = await generateApiKey(userId, name, projectId, projectName, scopes);
        // revalidatePath('/settings'); // Don't revalidate, let client handle state to keep the secret key visible
        return { success: true, data: result };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getApiKeysAction(projectId?: string) {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: "Not authenticated" };

    try {
        const keys = await listApiKeys(userId, projectId);
        return { success: true, data: keys };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function revokeApiKeyAction(keyId: string) {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: "Not authenticated" };

    try {
        await revokeApiKey(userId, keyId);
        // revalidatePath('/settings');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getProjectsAction() {
    const userId = await getCurrentUserId();
    if (!userId) return { success: false, error: "Not authenticated" };

    try {
        const projects = await getProjectsForCurrentUser();
        return { success: true, data: projects };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
