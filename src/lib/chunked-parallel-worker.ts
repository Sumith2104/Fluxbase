/**
 * Chunked Parallel Insertion Worker Engine (Option B)
 * ───────────────────────────────────────────────────
 * Breaks massive single-stream write operations into N parallel streaming
 * COPY workers across isolated PostgreSQL connections.
 */

import { Pool, PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import logger from '@/lib/logger';

export interface ChunkedProgress {
    completedRows: number;
    totalRows: number;
    percent: number;
    currentRps: number;
    elapsedMs: number;
    activeWorkers: number;
}

export interface ChunkedJobResult {
    success: boolean;
    totalRows: number;
    durationMs: number;
    rowsPerSecond: number;
    workersUsed: number;
    errors?: string[];
}

export interface ParallelGenerateOptions {
    pool: Pool;
    schemaName: string;
    tableName: string;
    totalCount: number;
    columns: { column_name: string; data_type: string }[];
    concurrency?: number;
    onProgress?: (progress: ChunkedProgress) => void;
}

export interface ParallelRowsOptions<T = any> {
    pool: Pool;
    schemaName: string;
    tableName: string;
    rows: T[];
    quotedCols: string;
    formatRowFn: (row: T) => string;
    concurrency?: number;
    onProgress?: (progress: ChunkedProgress) => void;
}

/**
 * Calculates safe concurrency based on connection pool capacity.
 */
function getOptimalConcurrency(requested?: number): number {
    const defaultWorkers = 4;
    const maxSafeWorkers = 8;
    if (!requested || requested <= 0) return defaultWorkers;
    return Math.min(Math.max(1, requested), maxSafeWorkers);
}

/**
 * Executes high-speed parallel data generation using N concurrent COPY streams.
 */
export async function runParallelGenerateJob(options: ParallelGenerateOptions): Promise<ChunkedJobResult> {
    const { pool, schemaName, tableName, totalCount, columns, onProgress } = options;
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    const insertableCols = columns.filter(col => col.column_name !== 'id' && col.column_name !== '_id');
    if (insertableCols.length === 0) throw new Error("No insertable columns found in table");

    const quotedCols = insertableCols.map(col => `"${col.column_name}"`).join(', ');
    const workerCount = getOptimalConcurrency(options.concurrency || (totalCount >= 100_000 ? 8 : 4));
    const rowsPerWorker = Math.ceil(totalCount / workerCount);

    const t0 = Date.now();
    let completedRows = 0;
    const abortController = new AbortController();

    logger.info(`[ParallelWorker] Starting parallel generation: ${totalCount.toLocaleString()} rows across ${workerCount} workers (~${rowsPerWorker.toLocaleString()} rows/worker)`);

    const workers = Array.from({ length: workerCount }, async (_, workerIdx) => {
        const startRow = workerIdx * rowsPerWorker;
        if (startRow >= totalCount) return;
        const countForThisWorker = Math.min(rowsPerWorker, totalCount - startRow);

        let client: PoolClient | null = null;
        try {
            client = await pool.connect();
            await client.query("SELECT set_config('synchronous_commit', 'off', false)");

            const copySql = `COPY "${schemaName}"."${safeTableName}" (${quotedCols}) FROM STDIN WITH (FORMAT csv, NULL '')`;
            const copyStream = client.query(copyFrom(copySql));

            let generated = 0;
            const dataStream = new Readable({
                read() {
                    if (abortController.signal.aborted) {
                        this.push(null);
                        return;
                    }

                    let chunk = '';
                    while (generated < countForThisWorker && chunk.length < 65536) {
                        generated++;
                        const rowVals: string[] = [];
                        for (const col of insertableCols) {
                            const type = col.data_type.toUpperCase();
                            if (type.includes('VARCHAR') || type.includes('TEXT') || type.includes('STRING')) {
                                rowVals.push(`Gen_${Math.random().toString(36).substring(7)}`);
                            } else if (type.includes('INT') || type.includes('NUMBER') || type.includes('NUMERIC') || type.includes('DOUBLE') || type.includes('FLOAT')) {
                                rowVals.push(String(Math.floor(Math.random() * 1000)));
                            } else if (type.includes('BOOL')) {
                                rowVals.push(Math.random() > 0.5 ? 'true' : 'false');
                            } else if (type.includes('DATE') || type.includes('TIME')) {
                                rowVals.push(new Date().toISOString());
                            } else {
                                rowVals.push('val');
                            }
                        }
                        chunk += rowVals.join(',') + '\n';
                    }

                    if (chunk.length > 0) {
                        this.push(chunk);
                        completedRows += (chunk.match(/\n/g) || []).length;
                        if (onProgress) {
                            const elapsed = Math.max(1, Date.now() - t0);
                            onProgress({
                                completedRows,
                                totalRows: totalCount,
                                percent: Math.min(100, Math.round((completedRows / totalCount) * 100)),
                                currentRps: Math.round((completedRows * 1000) / elapsed),
                                elapsedMs: elapsed,
                                activeWorkers: workerCount,
                            });
                        }
                    } else {
                        this.push(null);
                    }
                }
            });

            await pipeline(dataStream, copyStream);
        } catch (workerErr: any) {
            abortController.abort();
            logger.error(`[ParallelWorker] Worker ${workerIdx} failed:`, workerErr?.message || workerErr);
            throw workerErr;
        } finally {
            if (client) client.release();
        }
    });

    await Promise.all(workers);
    const durationMs = Math.max(1, Date.now() - t0);
    const rowsPerSecond = Math.round((totalCount * 1000) / durationMs);

    logger.info(`[ParallelWorker] Completed parallel generation: ${totalCount.toLocaleString()} rows in ${(durationMs / 1000).toFixed(2)}s (${rowsPerSecond.toLocaleString()} rows/s)`);

    return {
        success: true,
        totalRows: totalCount,
        durationMs,
        rowsPerSecond,
        workersUsed: workerCount,
    };
}

/**
 * Ingests an existing array of rows in parallel partitions using concurrent COPY streams.
 */
export async function runParallelRowsJob<T = any>(options: ParallelRowsOptions<T>): Promise<ChunkedJobResult> {
    const { pool, schemaName, tableName, rows, quotedCols, formatRowFn, onProgress } = options;
    const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    const totalCount = rows.length;
    const workerCount = getOptimalConcurrency(options.concurrency || (totalCount >= 50_000 ? 6 : 4));
    const rowsPerWorker = Math.ceil(totalCount / workerCount);

    const t0 = Date.now();
    let completedRows = 0;
    const abortController = new AbortController();

    const workers = Array.from({ length: workerCount }, async (_, workerIdx) => {
        const startIdx = workerIdx * rowsPerWorker;
        if (startIdx >= totalCount) return;
        const chunkRows = rows.slice(startIdx, startIdx + rowsPerWorker);

        let client: PoolClient | null = null;
        try {
            client = await pool.connect();
            await client.query("SELECT set_config('synchronous_commit', 'off', false)");

            const copySql = `COPY "${schemaName}"."${safeTableName}" (${quotedCols}) FROM STDIN WITH (FORMAT csv, NULL '')`;
            const copyStream = client.query(copyFrom(copySql));

            let rowIdx = 0;
            const dataStream = new Readable({
                read() {
                    if (abortController.signal.aborted) {
                        this.push(null);
                        return;
                    }

                    let chunk = '';
                    while (rowIdx < chunkRows.length && chunk.length < 65536) {
                        chunk += formatRowFn(chunkRows[rowIdx++]);
                    }

                    if (chunk.length > 0) {
                        this.push(chunk);
                        completedRows += (chunk.match(/\n/g) || []).length;
                        if (onProgress) {
                            const elapsed = Math.max(1, Date.now() - t0);
                            onProgress({
                                completedRows,
                                totalRows: totalCount,
                                percent: Math.min(100, Math.round((completedRows / totalCount) * 100)),
                                currentRps: Math.round((completedRows * 1000) / elapsed),
                                elapsedMs: elapsed,
                                activeWorkers: workerCount,
                            });
                        }
                    } else {
                        this.push(null);
                    }
                }
            });

            await pipeline(dataStream, copyStream);
        } catch (workerErr: any) {
            abortController.abort();
            logger.error(`[ParallelRowsWorker] Worker ${workerIdx} failed:`, workerErr?.message || workerErr);
            throw workerErr;
        } finally {
            if (client) client.release();
        }
    });

    await Promise.all(workers);
    const durationMs = Math.max(1, Date.now() - t0);
    const rowsPerSecond = Math.round((totalCount * 1000) / durationMs);

    return {
        success: true,
        totalRows: totalCount,
        durationMs,
        rowsPerSecond,
        workersUsed: workerCount,
    };
}
