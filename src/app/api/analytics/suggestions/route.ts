import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getTablesForProject, getColumnsForTable, getProjectById } from '@/lib/data';
import { AnalyticsAgent } from '@/lib/agent-core/analytics-agent';
import logger from '@/lib/logger';

export async function POST(req: Request) {
    const userId = await getCurrentUserId();
    if (!userId) return new NextResponse('Unauthorized', { status: 401 });

    try {
        const { projectId, model } = await req.json();
        if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });

        const project = await getProjectById(projectId, userId);
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

        // Introspect Schema
        const tables = await getTablesForProject(projectId, userId);
        let schemaString = '';

        if (tables.length === 0) {
            return NextResponse.json({ 
                success: true, 
                suggestions: [
                    "Create your first database table",
                    "How to define table columns and relationships",
                    "Import an existing SQL schema"
                ] 
            });
        }

        for (const table of tables) {
            const columns = await getColumnsForTable(projectId, table.table_id, userId);
            const colDefs = columns.map(c => `${c.column_name} (${c.data_type})`).join(', ');
            schemaString += `Table: ${table.table_name}\nColumns: ${colDefs}\n\n`;
        }

        const suggestions = await AnalyticsAgent.generateSuggestions({
            projectId,
            schemaString,
            model
        });

        return NextResponse.json({ 
            success: true, 
            suggestions
        });

    } catch (error: any) {
        logger.error('Analytics Suggestions Error:', error);
        return NextResponse.json({ error: error.message || 'AI Generation failed' }, { status: 500 });
    }
}
