'use server';

import { v4 as uuidv4 } from 'uuid';
import { getCurrentUserId } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import {
    getColumnsForTable,
    getConstraintsForTable,
    getTableData,
    getConstraintsForProject,
    getTablesForProject,
    insertRow,
    updateRow,
    addColumn,
    updateColumn,
    deleteColumn,
    addConstraint,
    deleteConstraint,
    deleteTable,
    Constraint,
    getProjectById
} from '@/lib/data';
import { getLocalTimestamp } from '@/lib/utils';
import { getPgPool } from '@/lib/pg';
import logger from '@/lib/logger';

async function broadcastSchemaUpdate(projectId: string) {
    try {
        const pool = getPgPool();
        const payload = {
            event_type: 'schema_update',
            timestamp: new Date().toISOString(),
            project_id: projectId
        };
        const payloadString = JSON.stringify(payload).replace(/'/g, "''");
        await pool.query(`NOTIFY fluxbase_live, '${payloadString}'`);
    } catch (e) {
        logger.warn('Failed to broadcast schema update:', e);
    }
}

// --- Constraint Validation Helpers ---

async function validatePrimaryKey(projectId: string, tableId: string, newRow: Record<string, any>, rowIdToExclude?: string) {
    const pkConstraints = (await getConstraintsForTable(projectId, tableId)).filter(c => c.type === 'PRIMARY KEY');
    if (pkConstraints.length === 0) return;

    // For simplicity in this phase, we fetch the whole table (up to limit) to check for uniqueness.
    // In a production app, we would query specifically for the conflicting values.
    const { rows: existingRows } = await getTableData(projectId, (await getTablesForProject(projectId)).find(t => t.table_id === tableId)?.table_name || '', 1, 10000);

    for (const constraint of pkConstraints) {
        const pkColumns = constraint.column_names.split(',');
        const pkValue = pkColumns.map(col => newRow[col]).join('-');

        // Check for null/empty values
        for (const col of pkColumns) {
            if (newRow[col] === null || newRow[col] === undefined || newRow[col] === '') {
                throw new Error(`Primary key violation: Column '${col}' cannot be null.`);
            }
        }

        // Check for uniqueness
        const duplicate = existingRows.some((row: any) => {
            // If editing, exclude the current row from the check
            if (rowIdToExclude && row.id === rowIdToExclude) {
                return false;
            }
            const existingPkValue = pkColumns.map(col => row[col]).join('-');
            return existingPkValue === pkValue;
        });

        if (duplicate) {
            throw new Error(`Primary key violation: A row with the value(s) '${pkValue.replace(/-/g, ', ')}' for column(s) '${constraint.column_names}' already exists.`);
        }
    }
}

async function validateForeignKey(projectId: string, tableId: string, newRow: Record<string, any>) {
    const fkConstraints = (await getConstraintsForTable(projectId, tableId)).filter(c => c.type === 'FOREIGN KEY');

    if (fkConstraints.length === 0) return;

    for (const constraint of fkConstraints) {
        const fkColumns = constraint.column_names.split(',');
        const fkValue = fkColumns.map(col => newRow[col]).join('-');

        // Skip validation if FK value is null or empty for any column in the key
        if (!fkValue || fkColumns.some(col => !newRow[col])) continue;

        const referencedTable = (await getTablesForProject(projectId)).find(t => t.table_id === constraint.referenced_table_id);
        if (!referencedTable) throw new Error(`Internal error: Referenced table with ID '${constraint.referenced_table_id}' not found.`);

        const { rows: referencedData } = await getTableData(projectId, referencedTable.table_name, 0, 100);
        const referencedPkColumns = (constraint.referenced_column_names || '').split(',');

        const referenceExists = referencedData.some((refRow: any) => {
            // If the key is 'id', it might be the doc ID, which is always present in 'refRow.id'
            // But strict column checking relies on row content.
            const refPkValue = referencedPkColumns.map(col => refRow[col]).join('-');
            return refPkValue === fkValue;
        });

        if (!referenceExists) {
            throw new Error(`Foreign key violation on table '${referencedTable.table_name}': The value '${fkValue}' for column '${constraint.column_names}' does not exist in the referenced table.`);
        }
    }
}

// --- Row Actions ---

export async function addRowAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const tableId = formData.get('tableId') as string;
    const tableName = formData.get('tableName') as string;
    const userId = await getCurrentUserId();

    if (!projectId || !tableName || !userId || !tableId) {
        return { error: 'Missing required fields.' };
    }

    try {
        const { checkRowLimit, checkProjectTrafficLimits } = await import('@/lib/limits');
        await checkProjectTrafficLimits(projectId);
        await checkRowLimit(projectId, userId, tableName, 1);

        // 1. Prepare data
        const columns = await getColumnsForTable(projectId, tableId);
        if (!columns.length) return { error: 'No columns found for this table.' };

        // Fetch project for timezone context
        const project = await getProjectById(projectId, userId);

        const newRowObject: Record<string, any> = {};


        for (const col of columns) {
            let value: string | null = null;
            const formValues = formData.getAll(col.column_name);
            if (formValues.length > 0) {
                value = formValues[formValues.length - 1] as string;
            }

            // Logic to generate default values
            if (col.default_value === 'now()' || (!value && ['created_at', 'updated_at'].includes(col.column_name.toLowerCase()))) {
                if (!value) {
                    value = getLocalTimestamp(project?.timezone);
                }
            }

            // Intercept manual "now()" typings from the table UI
            if (value === 'now()') {
                value = getLocalTimestamp(project?.timezone);
            }

            if (col.column_name === 'id' && !value) {
                const isNumeric = ['INT', 'INTEGER', 'NUMBER', 'FLOAT'].includes(col.data_type.toUpperCase());
                value = isNumeric ? Date.now().toString() : uuidv4();
            }

            if (value) {
                const dataType = col.data_type.toUpperCase();
                if (dataType === 'TIME') {
                    // Extract HH:mm:ss from ISO string if it is a full string
                    if (value.includes('T')) {
                        const timePart = value.split('T')[1];
                        value = timePart.split('.')[0].slice(0, 8); // Ensures HH:mm:ss format without timezone Z
                    }
                } else if (dataType === 'DATE') {
                    // Extract YYYY-MM-DD
                    if (value.includes('T')) {
                        value = value.split('T')[0];
                    }
                } else if (['TIMESTAMP', 'TIMESTAMPTZ', 'DATETIME'].includes(dataType)) {
                    try {
                        value = new Date(value).toISOString();
                    } catch {
                        logger.error("Invalid date value", value);
                    }
                }
            }

            const isStringType = ['VARCHAR', 'TEXT', 'CHAR', 'STRING'].includes(col.data_type.toUpperCase());
            if (value === null || value === '') {
                newRowObject[col.column_name] = isStringType ? '' : null;
            } else {
                newRowObject[col.column_name] = value;
            }
        }

        // Ensure ID exists
        if (!newRowObject['id']) {
            newRowObject['id'] = uuidv4();
        }

        // 2. Validate
        await validatePrimaryKey(projectId, tableId, newRowObject);
        await validateForeignKey(projectId, tableId, newRowObject);

        // 3. Insert
        await insertRow(projectId, tableId, newRowObject);

        // revalidatePath(`/editor?projectId=${projectId}&tableId=${tableId}&tableName=${tableName}`);
        return { success: true };
    } catch (error) {
        logger.error('Failed to add row:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

/**
 * Ultra-fast single cell update action for inline spreadsheet editing.
 * Executes a single direct UPDATE query (~20ms) instead of 10+ sequential roundtrips.
 */
/**
 * Ultra-fast single cell update action for inline spreadsheet editing.
 * Executes a single direct UPDATE query (~20ms) instead of 10+ sequential roundtrips.
 */
/**
 * Ultra-fast single cell update action for inline spreadsheet editing.
 * Executes a single direct UPDATE query (~20ms) instead of 10+ sequential roundtrips.
 */
export async function updateCellAction(
    projectId: string,
    tableId: string,
    tableName: string,
    rowId: string,
    field: string,
    value: string,
    pkColName?: string
) {
    const userId = await getCurrentUserId();
    if (!projectId || !tableName || !userId || !rowId || !field) {
        return { error: 'Missing required parameters.' };
    }

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return { error: 'Project not found.' };

        const isMysql = project.dialect?.toLowerCase() === 'mysql';
        const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const safeField = field.replace(/[^a-zA-Z0-9_]/g, '');
        const pk = (pkColName || 'id').replace(/[^a-zA-Z0-9_]/g, '');

        if (isMysql) {
            const { getTenantMysqlPool, getProjectDbAndSchema } = await import('@/lib/tenant-pools');
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const targetDb = (!project.connection_type || project.connection_type === 'internal')
                ? dbName
                : (project.active_db || dbName);

            const ddl = `UPDATE \`${targetDb}\`.\`${safeTable}\` SET \`${safeField}\` = ? WHERE \`${pk}\` = ?`;
            await mysqlPool.query(ddl as any, [value === '' ? null : value, rowId]);
        } else {
            const { getTenantPgPool, getProjectDbAndSchema } = await import('@/lib/tenant-pools');
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const targetSchema = (!project.connection_type || project.connection_type === 'internal')
                ? schemaName
                : ((project as any).schema_name || 'public');

            const ddl = `UPDATE "${targetSchema}"."${safeTable}" SET "${safeField}" = $1 WHERE "${pk}"::text = $2`;
            await pool.query(ddl, [value === '' ? null : value, rowId]);
        }

        // Invalidate cache and webhooks in background (non-blocking)
        import('@/lib/cache').then(m => m.invalidateTableCache(projectId, tableId)).catch(() => {});
        import('@/lib/webhooks').then(m => {
            m.fireWebhooks(projectId, userId, tableId, 'row.updated', { [safeField]: value, [pk]: rowId }, undefined).catch(() => {});
        }).catch(() => {});

        return { success: true };
    } catch (error: any) {
        logger.error('Failed to update cell:', error);
        return { error: error.message || 'Update failed' };
    }
}

export async function editRowAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const tableId = formData.get('tableId') as string;
    const tableName = formData.get('tableName') as string;
    const rowId = formData.get('rowId') as string;
    const userId = await getCurrentUserId();

    if (!projectId || !tableName || !userId || !rowId) {
        return { error: 'Missing required fields for editing.' };
    }

    try {
        const columns = await getColumnsForTable(projectId, tableId);
        const project = await getProjectById(projectId, userId);

        const newRowObject: Record<string, any> = { id: rowId };
        columns.forEach(col => {
            if (col.column_name !== 'id') {
                let value = formData.get(col.column_name) as string | null;

                // Auto-fill updated_at on edits
                if (!value && col.column_name.toLowerCase() === 'updated_at') {
                    value = getLocalTimestamp(project?.timezone);
                }

                // Intercept manual "now()" typings from the table UI
                if (value === 'now()') {
                    value = getLocalTimestamp(project?.timezone);
                }

                if (value) {
                    const dataType = col.data_type.toUpperCase();
                    if (dataType === 'TIME') {
                        if (value.includes('T')) {
                            const timePart = value.split('T')[1];
                            value = timePart.split('.')[0].slice(0, 8);
                        }
                    } else if (dataType === 'DATE') {
                        if (value.includes('T')) {
                            value = value.split('T')[0];
                        }
                    } else if (['TIMESTAMP', 'TIMESTAMPTZ', 'DATETIME'].includes(dataType)) {
                        try {
                            value = new Date(value).toISOString();
                        } catch {
                            // Keep original
                        }
                    }
                }

                const isStringType = ['VARCHAR', 'TEXT', 'CHAR', 'STRING'].includes(col.data_type.toUpperCase());
                if (value === null || value === '') {
                    newRowObject[col.column_name] = isStringType ? '' : null;
                } else {
                    newRowObject[col.column_name] = value;
                }
            }
        });

        // Validate
        await validatePrimaryKey(projectId, tableId, newRowObject, rowId);
        await validateForeignKey(projectId, tableId, newRowObject);

        // Update
        await updateRow(projectId, tableId, rowId, newRowObject);

        // revalidatePath(`/editor?projectId=${projectId}&tableId=${tableId}&tableName=${tableName}`);
        return { success: true };
    } catch (error) {
        logger.error('Failed to edit row:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function deleteRowAction(projectId: string, tableId: string, tableName: string, rowIds: string[]) {
    const userId = await getCurrentUserId();
    if (!projectId || (!tableName && !tableId) || !userId || !rowIds || rowIds.length === 0) {
        return { error: 'Missing required fields for deletion.' };
    }

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return { error: 'Project not found.' };

        // Resolve the PK column once (not N times)
        let cols = await getColumnsForTable(projectId, tableId);
        if (!cols.length && tableName) {
            cols = await getColumnsForTable(projectId, tableName);
        }
        let pkCol = cols.find(c => c.is_primary_key);
        if (!pkCol) {
            // Fallback: check if 'id' or '_id' exists in the table
            pkCol = cols.find(c => c.column_name.toLowerCase() === 'id' || c.column_name.toLowerCase() === '_id');
        }
        if (!pkCol) return { error: 'Table has no primary key — cannot delete rows.' };

        const safeTable = (tableName || tableId).replace(/[^a-zA-Z0-9_]/g, '');
        const pkName = pkCol.column_name;
        let deletedCount = 0;

        if (project.dialect?.toLowerCase() === 'mysql') {
            const { getTenantMysqlPool, getProjectDbAndSchema } = await import('@/lib/tenant-pools');
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);
            const fromTable = dbName ? `\`${dbName}\`.\`${safeTable}\`` : `\`${safeTable}\``;

            // Single batch DELETE
            const placeholders = rowIds.map(() => '?').join(', ');
            const [result]: any = await mysqlPool.query(
                `DELETE FROM ${fromTable} WHERE \`${pkName}\` IN (${placeholders})`,
                rowIds
            );
            deletedCount = result.affectedRows ?? rowIds.length;
        } else {
            const { getTenantPgPool, getProjectDbAndSchema } = await import('@/lib/tenant-pools');
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);

            let targetSchema = schemaName || 'public';
            try {
                const check = await pool.query(
                    `SELECT schemaname FROM pg_tables WHERE schemaname = $1 AND tablename = $2 LIMIT 1`,
                    [schemaName, safeTable]
                );
                if (check.rows.length === 0) {
                    const fallbackCheck = await pool.query(
                        `SELECT schemaname FROM pg_tables WHERE tablename = $1 AND schemaname NOT IN ('pg_catalog', 'information_schema') LIMIT 1`,
                        [safeTable]
                    );
                    if (fallbackCheck.rows.length > 0 && fallbackCheck.rows[0].schemaname) {
                        targetSchema = fallbackCheck.rows[0].schemaname;
                    }
                }
            } catch (schemaResolveErr) {
                logger.warn('[deleteRowAction] Schema resolution warning:', schemaResolveErr);
            }

            // Cast pk to text so this works for uuid, integer, varchar, etc.
            const result = await pool.query(
                `DELETE FROM "${targetSchema}"."${safeTable}" WHERE "${pkName}"::text = ANY($1::text[])`,
                [rowIds]
            );
            deletedCount = result.rowCount ?? rowIds.length;
        }

        // Invalidate cache once for the whole batch
        const { invalidateTableCache } = await import('@/lib/cache');
        await invalidateTableCache(projectId, tableId);
        if (tableName && tableName !== tableId) {
            await invalidateTableCache(projectId, tableName);
        }

        return { success: true, deletedCount };

    } catch (error) {
        logger.error('Failed to delete row(s):', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}


// --- Column Actions ---

export async function addColumnAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const tableId = formData.get('tableId') as string;
    const tableName = formData.get('tableName') as string;
    const columnName = formData.get('columnName') as string;
    const dataType = (formData.get('dataType') || formData.get('columnType')) as string;
    const isNullable = formData.get('isNullable') !== 'false';
    const defaultValue = formData.get('defaultValue') as string || undefined;

    if (!projectId || !tableId || !tableName || !columnName || !dataType) {
        return { error: 'Missing required fields.' };
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
        return { error: 'Column name must start with a letter or underscore and contain only letters, numbers, and underscores.' };
    }

    try {
        await addColumn(projectId, tableId, {
            column_name: columnName,
            data_type: dataType.toUpperCase() as any,
            is_primary_key: false,
            is_nullable: isNullable,
            default_value: defaultValue,
        });
        await broadcastSchemaUpdate(projectId);
        return { success: true };
    } catch (error) {
        logger.error('Failed to add column:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function editColumnAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const tableId = formData.get('tableId') as string;
    const columnId = formData.get('columnId') as string;
    const newColumnName = formData.get('newColumnName') as string;

    // Phase 2: We just update the metadata. No data migration implemented yet for simple renames 
    // (since data is key-value in Firestore, renaming a column requires updating ALL docs).
    // For this prototype, we'll update the column definition, but old data might be lost/hidden.
    // WARNING: Renaming columns in Firestore is expensive (Update all docs).

    try {
        await updateColumn(projectId, tableId, columnId, { column_name: newColumnName });
        await broadcastSchemaUpdate(projectId);
        // revalidatePath(`/editor?projectId=${projectId}&tableId=${tableId}&tableName=${tableName}`);
        return { success: true };
    } catch (error) {
        logger.error('Failed to edit column:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}


export async function deleteColumnAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const tableId = formData.get('tableId') as string;
    const columnId = formData.get('columnId') as string;
    const columnName = formData.get('columnName') as string;
    const userId = await getCurrentUserId();

    if (!userId || !projectId) {
        return { error: 'Unauthorized' };
    }

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return { error: 'Forbidden: Insufficient project permissions.' };

        // Validation: Check constraints
        const constraints = await getConstraintsForProject(projectId);
        const isUsedInConstraint = constraints.some(c => c.table_id === tableId && c.column_names.split(',').includes(columnName));
        if (isUsedInConstraint) {
            return { error: `Cannot delete column '${columnName}' being used in a constraint.` };
        }

        const targetTable = (formData.get('tableName') as string) || tableId;
        const targetColumn = columnName || columnId;
        await deleteColumn(projectId, targetTable, targetColumn);
        await broadcastSchemaUpdate(projectId);
        return { success: true };
    } catch (error) {
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

// --- Constraint Actions ---

export async function addConstraintAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const tableId = formData.get('tableId') as string;
    const type = formData.get('type') as Constraint['type'];
    const columnNames = formData.get('columnNames') as string;
    const userId = await getCurrentUserId();

    if (!userId || !projectId) {
        return { error: 'Unauthorized' };
    }

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return { error: 'Forbidden: Insufficient project permissions.' };
        const constraint: any = {
            table_id: tableId,
            type,
            column_names: columnNames,
        };

        if (type === 'FOREIGN KEY') {
            constraint.referenced_table_id = formData.get('referencedTableId');
            constraint.referenced_column_names = formData.get('referencedColumnNames');
            constraint.on_delete = formData.get('onDelete');
        }

        await addConstraint(projectId, constraint);
        await broadcastSchemaUpdate(projectId);
        // revalidatePath(`/editor?projectId=${projectId}&tableId=${tableId}&tableName=${formData.get('tableName')}`);
        return { success: true };

    } catch (error) {
        logger.error('Failed to add constraint:', error);
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function deleteConstraintAction(formData: FormData) {
    const projectId = formData.get('projectId') as string;
    const constraintId = formData.get('constraintId') as string;
    const userId = await getCurrentUserId();

    if (!userId || !projectId) {
        return { error: 'Unauthorized' };
    }

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return { error: 'Forbidden: Insufficient project permissions.' };

        await deleteConstraint(projectId, constraintId);
        await broadcastSchemaUpdate(projectId);
        return { success: true };
    } catch (error) {
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteTableAction(projectId: string, tableId: string, tableName: string) {
    const userId = await getCurrentUserId();
    if (!userId || !projectId) {
        return { error: 'Unauthorized' };
    }

    try {
        const project = await getProjectById(projectId, userId);
        if (!project) return { error: 'Forbidden: Project not found or insufficient access.' };

        const targetTable = tableName || tableId;
        await deleteTable(projectId, targetTable);
        await broadcastSchemaUpdate(projectId);
        revalidatePath(`/dashboard?projectId=${projectId}`);
        return { success: true };
    } catch (error) {
        return { error: `An unexpected error occurred: ${(error as Error).message}` };
    }
}

export async function updateTableCellValueAction(
    projectId: string,
    tableName: string,
    rowId: string,
    columnName: string,
    newValue: any
) {
    const userId = await getCurrentUserId();
    if (!userId) return { error: 'Unauthorized' };

    try {
        const columns = await getColumnsForTable(projectId, tableName);
        const targetCol = columns.find(c => c.column_name.toLowerCase() === columnName.toLowerCase());
        if (!targetCol) {
            return { error: `Column '${columnName}' not found in table '${tableName}'.` };
        }

        const updates = {
            [targetCol.column_name]: newValue === '' ? null : newValue
        };

        await updateRow(projectId, tableName, rowId, updates);
        return { success: true };
    } catch (error: any) {
        logger.error('Failed to update table cell:', error);
        return { error: error.message || 'Failed to update cell.' };
    }
}

export async function updateFullRowAction(
    projectId: string,
    tableName: string,
    rowId: string,
    updates: Record<string, any>
) {
    const userId = await getCurrentUserId();
    if (!userId) return { error: 'Unauthorized' };

    try {
        await updateRow(projectId, tableName, rowId, updates);
        return { success: true };
    } catch (error: any) {
        logger.error('Failed to update row:', error);
        return { error: error.message || 'Failed to update row.' };
    }
}


