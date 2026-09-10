import { useQuery } from '@tanstack/react-query';
import { getAnalyticsStatsAction } from '@/app/(app)/dashboard/analytics-actions';

export interface AnalyticsStats {
    total_requests: number;
    all_time_requests?: number;
    type_api_call: number;
    type_sql_execution: number;
    type_storage_read: number;
    type_storage_write: number;
    type_sql_select?: number;
    type_sql_insert?: number;
    type_sql_update: number;
    type_sql_delete: number;
    type_sql_alter: number;
    live_sessions: number; // Real-time active connection tracking
}

export function useRealtimeAnalytics(projectId: string | undefined): AnalyticsStats | null {
    const queryKey = ['analytics_stats', projectId];

    const { data } = useQuery({
        queryKey,
        queryFn: () => getAnalyticsStatsAction(projectId!),
        enabled: !!projectId,
        staleTime: 10000,
        refetchInterval: 15000, // Background poll every 15s
        refetchOnWindowFocus: false,
        gcTime: 3 * 60 * 1000,
    });

    return data || null;
}
