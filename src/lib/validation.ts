
import { Row, Column } from '@/lib/data';

export function validateRow(row: Row, columns: Column[]) {
    for (const col of columns) {
        const val = row[col.column_name];

        const defVal = (col.default_value || '').toLowerCase();
        const hasDefault = Boolean(
            col.default_value ||
            defVal.includes('nextval') ||
            defVal.includes('auto_increment') ||
            defVal.includes('gen_random_uuid') ||
            defVal.includes('current_timestamp') ||
            defVal.includes('now()')
        );

        const colType = (col.data_type || '').toUpperCase();
        const isStringType = ['VARCHAR', 'TEXT', 'CHAR', 'STRING', 'CHARACTER VARYING'].some(t => colType.includes(t));

        // 1. Check NOT NULL
        if (!col.is_nullable && (val === null || val === undefined || (val === '' && !isStringType))) {
            // Exceptions: Auto-increment, sequences, or default values handled by DB
            if (!hasDefault && col.column_name.toLowerCase() !== 'id' && col.column_name.toLowerCase() !== '_id' && !col.is_primary_key) {
                throw new Error(`Column '${col.column_name}' cannot be null.`);
            }
        }

        if (val !== null && val !== undefined && val !== '') {
            // 2. Check Data Types
            if (['INT', 'INTEGER', 'NUMBER', 'BIGINT', 'SMALLINT'].some(t => colType.includes(t))) {
                if (isNaN(Number(val))) {
                    throw new Error(`Column '${col.column_name}' expects an integer, got '${val}'.`);
                }
            } else if (['FLOAT', 'DOUBLE', 'NUMERIC', 'REAL'].some(t => colType.includes(t))) {
                if (isNaN(Number(val))) {
                    throw new Error(`Column '${col.column_name}' expects a number, got '${val}'.`);
                }
            } else if (colType.includes('BOOL')) {
                const boolVal = String(val).toLowerCase();
                if (!['true', 'false', '0', '1'].includes(boolVal)) {
                    throw new Error(`Column '${col.column_name}' expects a Boolean, got '${val}'.`);
                }
            } else if (['DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'DATETIME'].some(t => colType.includes(t))) {
                if (isNaN(Date.parse(String(val)))) {
                    throw new Error(`Column '${col.column_name}' expects a valid Date/Timestamp, got '${val}'.`);
                }
            }
        }
    }
}
