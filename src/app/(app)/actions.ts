
'use server';

import { cookies } from 'next/headers';
import { logout, getCurrentUserId } from '@/lib/auth';
import { findUserById } from '@/lib/auth-actions';
import { getProjectsForCurrentUser, checkDatabaseHealthAction, getPendingInvitationsForCurrentUser } from '@/lib/data';

/**
 * Server action to log out the current user.
 */
export async function logoutAction() {
    await logout();
    // Also clear the selected project cookie on logout.
    (await cookies()).delete('selectedProject');
    return { success: true };
}

/**
 * Consolidates all necessary layout data into a single parallelized round-trip.
 * This is the primary optimization to fix the 'Initializing' waterfall.
 */
export async function getAppLayoutBootstrapData() {
    try {
        const userId = await getCurrentUserId();
        if (!userId) {
            return { userId: null, isOffline: false };
        }

        // Parallelize data fetching for the authenticated user
        const [user, projects, invitations] = await Promise.all([
            findUserById(userId).catch(() => null),
            getProjectsForCurrentUser().catch(() => []),
            getPendingInvitationsForCurrentUser().catch(() => [])
        ]);

        // If user query failed completely, perform a fallback database health check
        if (!user && (!projects || projects.length === 0)) {
            const isHealthy = await checkDatabaseHealthAction();
            if (!isHealthy) {
                return { isOffline: true };
            }
        }

        const userPlan = user?.plan_type || 'free';
        const userRole = user?.user_role || userPlan || 'student';
        const billingCycleEnd = user?.billing_cycle_end || null;
        const userStatus = user?.status || 'active';

        const plan = user 
            ? { 
                plan: userPlan,
                type: userPlan, 
                role: userRole,
                billing_cycle_end: billingCycleEnd,
                status: userStatus 
              }
            : null;

        return {
            userId,
            user,
            plan,
            projects: projects || [],
            invitations: invitations || [],
            isOffline: false
        };
    } catch (error) {
        console.error("[Bootstrap Action Error]:", error);
        return { isOffline: false, userId: null, error: "Failed to initialize application data" };
    }
}
