import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getTablesForProject, getColumnsForTable, getProjectById } from '@/lib/data';
import { AnalyticsAgent } from '@/lib/agent-core/analytics-agent';
import logger from '@/lib/logger';

export async function POST(req: Request) {
    const userId = await getCurrentUserId();
    if (!userId) return new NextResponse('Unauthorized', { status: 401 });

    try {
        const { prompt, projectId, model } = await req.json();
        if (!prompt || !projectId) return NextResponse.json({ error: 'Missing prompt or projectId' }, { status: 400 });

        const project = await getProjectById(projectId, userId);
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

        // Get Database Schema Context
        const tables = await getTablesForProject(projectId, userId);
        let schemaString = '';
        for (const table of tables) {
            const columns = await getColumnsForTable(projectId, table.table_id, userId);
            const colDefs = columns.map(c => `${c.column_name} (${c.data_type})`).join(', ');
            schemaString += `Table: ${table.table_name}\nColumns: ${colDefs}\n\n`;
        }

        const result = await AnalyticsAgent.generateWidgets({
            projectId,
            userId,
            prompt,
            schemaString,
            dialect: project.dialect,
            model,
            project
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate analytical widgets');
        }

        return NextResponse.json({ 
            success: true, 
            widgets: result.widgets
        });

    } catch (error: any) {
        logger.error('Analytics Generate Error:', error);
        return NextResponse.json({ error: error.message || 'AI Generation failed' }, { status: 500 });
    }
}
