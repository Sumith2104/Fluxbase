
import { Suspense } from 'react';
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTablesForProject, getAllColumnsForProject, getConstraintsForProject } from '@/lib/data';
import { Skeleton } from '@/components/ui/skeleton';
import { DatabaseErdSkeleton } from '@/components/skeletons/page-skeletons';
import { ErdView } from '@/components/erd-view';



async function Database({ projectId }: { projectId: string }) {
    const { getCurrentUserId } = await import('@/lib/auth');
    const { getProjectById } = await import('@/lib/data');
    const userId = await getCurrentUserId();
    const project = await getProjectById(projectId, userId || undefined);
    if (!project) {
        redirect('/dashboard');
    }

    const [allTables, allColumns, allConstraints] = await Promise.all([
        getTablesForProject(projectId),
        getAllColumnsForProject(projectId),
        getConstraintsForProject(projectId)
    ]);

    return (
        <div className="h-full w-full">
            <ErdView
                tables={allTables}
                columns={allColumns}
                constraints={allConstraints}
                projectId={projectId}
            />
        </div>
    );
}

function DatabaseSkeleton() {
    return <DatabaseErdSkeleton />;
}

export default async function DatabasePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const cookieStore = await cookies();
    const selectedProjectCookie = cookieStore.get('selectedProject');
    let selectedProject: any = null;
    try {
        selectedProject = selectedProjectCookie ? JSON.parse(selectedProjectCookie.value) : null;
    } catch (e) {
        console.warn("Failed to parse selectedProject cookie:", e);
    }
    const resolvedSearchParams = await searchParams;
    const projectId = (resolvedSearchParams?.projectId as string) || selectedProject?.project_id;

    if (!projectId) {
        redirect('/dashboard/projects');
    }

    return (
        <Suspense fallback={<DatabaseSkeleton />}>
            <Database projectId={projectId} />
        </Suspense>
    );
}
