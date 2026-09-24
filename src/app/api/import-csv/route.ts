import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getProjectById } from '@/lib/data';
import { getTenantPgPool, getTenantMysqlPool, getProjectDbAndSchema } from '@/lib/tenant-pools';
import Busboy from 'busboy';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_CSV_FILE_SIZE = 25 * 1024 * 1024; // 25 MB hard cap

/**
 * Streams a multipart/form-data request body using busboy with a strict 25 MB payload limit.
 * Returns { fields, files } where files[name] is a Buffer.
 */
async function parseMultipart(req: NextRequest): Promise<{
    fields: Record<string, string>;
    files: Record<string, { buffer: Buffer; filename: string; mimetype: string }>;
}> {
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_CSV_FILE_SIZE + 1024 * 1024) {
        throw new Error('PAYLOAD_TOO_LARGE: Request exceeds 25 MB maximum allowed file size');
    }

    const contentType = req.headers.get('content-type') || '';
    const bb = Busboy({ 
        headers: { 'content-type': contentType }, 
        limits: { fileSize: MAX_CSV_FILE_SIZE, files: 1 } 
    });
    const fields: Record<string, string> = {};
    const files: Record<string, { buffer: Buffer; filename: string; mimetype: string }> = {};

    return new Promise((resolve, reject) => {
        let isRejected = false;
        const rejectOnce = (err: Error) => {
            if (!isRejected) {
                isRejected = true;
                reject(err);
            }
        };

        bb.on('field', (name, val) => { fields[name] = val; });
        bb.on('file', (name, stream, info) => {
            const chunks: Buffer[] = [];
            stream.on('data', (d: Buffer) => chunks.push(d));
            stream.on('limit', () => {
                rejectOnce(new Error('PAYLOAD_TOO_LARGE: CSV file exceeds 25 MB limit'));
            });
            stream.on('end', () => { 
                if (!isRejected) {
                    files[name] = { buffer: Buffer.concat(chunks), filename: info.filename, mimetype: info.mimeType };
                }
            });
            stream.on('error', rejectOnce);
        });
        bb.on('close', () => {
            if (!isRejected) resolve({ fields, files });
        });
        bb.on('error', rejectOnce);

        if (!req.body) { reject(new Error('No request body')); return; }
        const nodeStream = Readable.fromWeb(req.body as any);
        nodeStream.pipe(bb);
    });
}

// Rows per INSERT batch statement
const BATCH_SIZE = 1000;

function parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
    const lines = csvText
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^\uFEFF/, '') // strip BOM
        .trim()
        .split('\n')
        .filter(l => l.trim());

    if (lines.length < 1) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        values.push(current.trim());
        return values;
    };

    const headers = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    const rows = lines.slice(1).map(parseLine);

    return { headers, rows };
}

/**
 * POST /api/import-csv
 * Supports both PostgreSQL and MySQL dialect projects.
 */
export async function POST(req: NextRequest) {
    try {
        const userId = await getCurrentUserId();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { fields, files } = await parseMultipart(req);
        const projectId = fields['projectId'];
        const tableName = fields['tableName'];
        const csvFileRaw = files['csvFile'];
        const excludedRaw = fields['excludedColumns'];
        let excludedColumns: string[] = [];
        try {
            if (excludedRaw) excludedColumns = JSON.parse(excludedRaw);
        } catch {}

        if (!projectId || !tableName || !csvFileRaw) {
            return NextResponse.json(
                { error: 'Missing required fields: projectId, tableName, csvFile' },
                { status: 400 }
            );
        }

        const project = await getProjectById(projectId, userId);
        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const csvText = csvFileRaw.buffer.toString('utf-8');
        const { headers, rows: dataRows } = parseCSV(csvText);

        if (headers.length === 0) {
            return NextResponse.json({ error: 'Could not parse CSV headers.' }, { status: 400 });
        }
        if (dataRows.length === 0) {
            return NextResponse.json({ error: 'CSV has no data rows.' }, { status: 400 });
        }

        const { checkRowLimit, checkProjectTrafficLimits } = await import('@/lib/limits');
        await checkProjectTrafficLimits(projectId);
        await checkRowLimit(projectId, userId, safeTableName, dataRows.length);

        const isMysql = project.dialect?.toLowerCase() === 'mysql';
        let importedCount = 0;
        const errors: string[] = [];
        let insertableHeaders: string[] = [];

        if (isMysql) {
            const mysqlPool = await getTenantMysqlPool(project);
            const { dbName } = getProjectDbAndSchema(project);

            const [colResult]: any = await mysqlPool.query(
                `SELECT COLUMN_NAME as column_name, COLUMN_DEFAULT as column_default, IS_NULLABLE as is_nullable
                 FROM information_schema.columns
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                 ORDER BY ORDINAL_POSITION`,
                [dbName, safeTableName]
            );

            if (!colResult || colResult.length === 0) {
                return NextResponse.json(
                    { error: `Table '${safeTableName}' not found in database '${dbName}'.` },
                    { status: 404 }
                );
            }

            const tableColumnNames = colResult.map((r: any) => r.column_name as string);
            const columnHasDefault = new Map<string, boolean>(
                colResult.map((r: any) => [r.column_name as string, !!(r.column_default)])
            );

            const headerToTableCol: Record<string, string> = {};
            for (const h of headers) {
                if (excludedColumns.includes(h)) continue;
                const lh = h.toLowerCase();
                const match = tableColumnNames.find(tc => tc.toLowerCase() === lh);
                if (match) headerToTableCol[h] = match;
            }

            insertableHeaders = Object.keys(headerToTableCol);
            if (insertableHeaders.length === 0) {
                return NextResponse.json({
                    error: `No matching columns found. CSV headers: [${headers.join(', ')}]. Table columns: [${tableColumnNames.join(', ')}].`
                }, { status: 400 });
            }

            type ImportRow = { cols: string[]; vals: (string | null)[] };
            const validRows: ImportRow[] = [];

            for (const rawValues of dataRows) {
                if (rawValues.length === 0 || (rawValues.length === 1 && rawValues[0] === '')) continue;

                const rowCols: string[] = [];
                const rowVals: (string | null)[] = [];

                for (const h of insertableHeaders) {
                    const csvIdx = headers.indexOf(h);
                    const raw = csvIdx === -1 ? '' : (rawValues[csvIdx] ?? '').replace(/^"|"$/g, '').trim();
                    const val = raw === '' ? null : raw;
                    const tableCol = headerToTableCol[h];

                    if (val === null && columnHasDefault.get(tableCol)) continue;

                    rowCols.push(`\`${tableCol}\``);
                    rowVals.push(val);
                }

                if (rowCols.length > 0) validRows.push({ cols: rowCols, vals: rowVals });
            }

            // Group by columns signature
            const groups = new Map<string, ImportRow[]>();
            for (const row of validRows) {
                const sig = row.cols.join(',');
                if (!groups.has(sig)) groups.set(sig, []);
                groups.get(sig)!.push(row);
            }

            for (const [, groupRows] of groups) {
                const quotedCols = groupRows[0].cols.join(', ');
                const colCount = groupRows[0].cols.length;

                for (let batchStart = 0; batchStart < groupRows.length; batchStart += BATCH_SIZE) {
                    const batch = groupRows.slice(batchStart, batchStart + BATCH_SIZE);
                    const flatParams: (string | null)[] = [];
                    const valuePlaceholders: string[] = [];
                    const rowPlaceholder = `(${Array(colCount).fill('?').join(', ')})`;

                    for (const r of batch) {
                        valuePlaceholders.push(rowPlaceholder);
                        flatParams.push(...r.vals);
                    }

                    const sql = `INSERT INTO \`${dbName}\`.\`${safeTableName}\` (${quotedCols}) VALUES ${valuePlaceholders.join(', ')}`;

                    try {
                        await (mysqlPool as any).query(sql, flatParams);
                        importedCount += batch.length;
                    } catch {
                        // Fallback row by row for error identification
                        for (let r = 0; r < batch.length; r++) {
                            const singleRowSql = `INSERT INTO \`${dbName}\`.\`${safeTableName}\` (${batch[r].cols.join(', ')}) VALUES (${Array(batch[r].vals.length).fill('?').join(', ')})`;
                            try {
                                await (mysqlPool as any).query(singleRowSql, batch[r].vals);
                                importedCount++;
                            } catch (rowErr: any) {
                                const absoluteRowNum = batchStart + r + 2;
                                errors.push(`Row ${absoluteRowNum}: ${rowErr.message.split('\n')[0]}`);
                                if (errors.length >= 50) break;
                            }
                        }
                    }
                    if (errors.length >= 50) break;
                }
                if (errors.length >= 50) break;
            }

        } else {
            // PostgreSQL implementation
            const pool = await getTenantPgPool(project);
            const { schemaName } = getProjectDbAndSchema(project);
            const client = await pool.connect();

            try {
                const colResult = await client.query(
                    `SELECT column_name, column_default, is_nullable
                     FROM information_schema.columns
                     WHERE table_schema = $1 AND table_name = $2
                     ORDER BY ordinal_position`,
                    [schemaName, safeTableName]
                );

                if (colResult.rows.length === 0) {
                    return NextResponse.json(
                        { error: `Table '${safeTableName}' not found in schema '${schemaName}'.` },
                        { status: 404 }
                    );
                }

                const tableColumnNames = colResult.rows.map((r: any) => r.column_name as string);
                const columnHasDefault = new Map<string, boolean>(
                    colResult.rows.map((r: any) => [r.column_name as string, !!(r.column_default)])
                );

                const headerToTableCol: Record<string, string> = {};
                for (const h of headers) {
                    if (excludedColumns.includes(h)) continue;
                    const lh = h.toLowerCase();
                    const match = tableColumnNames.find(tc => tc.toLowerCase() === lh);
                    if (match) headerToTableCol[h] = match;
                }

                insertableHeaders = Object.keys(headerToTableCol);
                if (insertableHeaders.length === 0) {
                    return NextResponse.json({
                        error: `No matching columns found. CSV headers: [${headers.join(', ')}]. Table columns: [${tableColumnNames.join(', ')}].`
                    }, { status: 400 });
                }

                type ImportRow = { cols: string[]; vals: (string | null)[] };
                const validRows: ImportRow[] = [];

                for (const rawValues of dataRows) {
                    if (rawValues.length === 0 || (rawValues.length === 1 && rawValues[0] === '')) continue;

                    const rowCols: string[] = [];
                    const rowVals: (string | null)[] = [];

                    for (const h of insertableHeaders) {
                        const csvIdx = headers.indexOf(h);
                        const raw = csvIdx === -1 ? '' : (rawValues[csvIdx] ?? '').replace(/^"|"$/g, '').trim();
                        const val = raw === '' ? null : raw;
                        const tableCol = headerToTableCol[h];

                        if (val === null && columnHasDefault.get(tableCol)) continue;

                        rowCols.push(`"${tableCol}"`);
                        rowVals.push(val);
                    }

                    if (rowCols.length > 0) validRows.push({ cols: rowCols, vals: rowVals });
                }

                await client.query('BEGIN');
                await client.query("SET LOCAL fluxbase.skip_realtime_triggers = 'true'");
                await client.query("SET LOCAL synchronous_commit = 'off'");
                let savepointIdx = 0;

                const groups = new Map<string, ImportRow[]>();
                for (const row of validRows) {
                    const sig = row.cols.join(',');
                    if (!groups.has(sig)) groups.set(sig, []);
                    groups.get(sig)!.push(row);
                }

                for (const [, groupRows] of groups) {
                    const quotedCols = groupRows[0].cols.join(', ');
                    const colCount = groupRows[0].cols.length;
                    for (let batchStart = 0; batchStart < groupRows.length; batchStart += BATCH_SIZE) {
                        const batch = groupRows.slice(batchStart, batchStart + BATCH_SIZE);
                        const flatParams: (string | null)[] = [];
                        const valueClauses: string[] = [];

                        for (let r = 0; r < batch.length; r++) {
                            const vals = batch[r].vals;
                            const placeholders = vals.map((_, c) => `$${r * colCount + c + 1}`).join(', ');
                            valueClauses.push(`(${placeholders})`);
                            flatParams.push(...vals);
                        }

                        const batchSp = `sp_batch_${savepointIdx++}`;
                        await client.query(`SAVEPOINT ${batchSp}`);

                        const sql = `INSERT INTO "${schemaName}"."${safeTableName}" (${quotedCols}) VALUES ${valueClauses.join(', ')}`;

                        try {
                            await client.query(sql, flatParams);
                            await client.query(`RELEASE SAVEPOINT ${batchSp}`);
                            importedCount += batch.length;
                        } catch {
                            await client.query(`ROLLBACK TO SAVEPOINT ${batchSp}`);
                            await client.query(`RELEASE SAVEPOINT ${batchSp}`);

                            for (let r = 0; r < batch.length; r++) {
                                const vals = batch[r].vals;
                                const rowCols = batch[r].cols.join(', ');
                                const placeholders = vals.map((_, c) => `$${c + 1}`).join(', ');
                                const rowSql = `INSERT INTO "${schemaName}"."${safeTableName}" (${rowCols}) VALUES (${placeholders})`;
                                const rowSp = `sp_row_${savepointIdx++}`;

                                await client.query(`SAVEPOINT ${rowSp}`);
                                try {
                                    await client.query(rowSql, vals);
                                    await client.query(`RELEASE SAVEPOINT ${rowSp}`);
                                    importedCount++;
                                } catch (rowErr: any) {
                                    await client.query(`ROLLBACK TO SAVEPOINT ${rowSp}`);
                                    await client.query(`RELEASE SAVEPOINT ${rowSp}`);
                                    const absoluteRowNum = batchStart + r + 2;
                                    errors.push(`Row ${absoluteRowNum}: ${rowErr.message.split('\n')[0]}`);
                                    if (errors.length >= 50) break;
                                }
                                if (errors.length >= 50) break;
                            }
                        }

                        if (errors.length >= 50) break;
                    }
                    if (errors.length >= 50) break;
                }

                if (importedCount === 0 && errors.length > 0) {
                    await client.query('ROLLBACK');
                    return NextResponse.json({
                        error: 'Import failed — all rows had errors.',
                        details: errors
                    }, { status: 422 });
                }

                await client.query('COMMIT');
            } finally {
                client.release();
            }
        }

        try {
            const { invalidateTableCache } = await import('@/lib/cache');
            await invalidateTableCache(projectId, safeTableName);
        } catch (cacheErr) {
            console.warn('[import-csv] Cache invalidation failed:', cacheErr);
        }

        return NextResponse.json({
            success: true,
            importedCount,
            columns: insertableHeaders,
            ...(errors.length > 0 ? { warnings: errors } : {}),
        });

    } catch (error: any) {
        console.error('[import-csv] Error:', error);
        if (error?.message?.includes('PAYLOAD_TOO_LARGE')) {
            return NextResponse.json({
                error: 'Payload Too Large: CSV file exceeds the 25 MB maximum allowed limit.'
            }, { status: 413 });
        }
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
