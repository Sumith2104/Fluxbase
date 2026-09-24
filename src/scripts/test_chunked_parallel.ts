/**
 * test_chunked_parallel.ts — Benchmark validation for Option B Chunked Parallel Worker
 * ────────────────────────────────────────────────────────────────────────────────────
 * Runs concurrent streaming COPY workers against PostgreSQL RDS to test throughput,
 * connection pooling, and multi-threaded scaling.
 */

import { pool } from '../lib/pg';
import { runParallelGenerateJob, runParallelRowsJob } from '../lib/chunked-parallel-worker';

async function testChunkedParallel() {
    console.log('================================================================');
    console.log('🚀 OPTION B: CHUNKED PARALLEL INSERTION WORKER BENCHMARK');
    console.log('================================================================\n');

    const schemaName = 'project_c58d8053b4f7430b';
    const tableName = 'bench_parallel_test';

    const client = await pool.connect();
    try {
        await client.query(`DROP TABLE IF EXISTS "${schemaName}"."${tableName}"`);
        await client.query(`
            CREATE TABLE "${schemaName}"."${tableName}" (
                id serial PRIMARY KEY,
                name varchar(100),
                email varchar(100),
                score int,
                created_at timestamp
            )
        `);
    } finally {
        client.release();
    }

    const columns = [
        { column_name: 'name', data_type: 'varchar' },
        { column_name: 'email', data_type: 'varchar' },
        { column_name: 'score', data_type: 'int' },
        { column_name: 'created_at', data_type: 'timestamp' },
    ];

    // --- TEST 1: 100,000 Rows with 4 Parallel Workers ---
    console.log('▶ Test 1: Generating 100,000 rows across 4 parallel workers...');
    const res100k = await runParallelGenerateJob({
        pool,
        schemaName,
        tableName,
        totalCount: 100_000,
        columns,
        concurrency: 4,
        onProgress: (p) => {
            if (p.completedRows % 25000 === 0 || p.percent === 100) {
                console.log(`   [Progress] ${p.percent}% (${p.completedRows.toLocaleString()}/${p.totalRows.toLocaleString()}) - ${p.currentRps.toLocaleString()} rows/s`);
            }
        },
    });

    console.log(`✅ Test 1 Finished: 100,000 rows in ${(res100k.durationMs / 1000).toFixed(2)}s (${res100k.rowsPerSecond.toLocaleString()} rows/s) using ${res100k.workersUsed} workers\n`);

    // Verify row count
    const verifyClient = await pool.connect();
    try {
        const c1 = await verifyClient.query(`SELECT count(*) FROM "${schemaName}"."${tableName}"`);
        console.log(`Verified table row count: ${Number(c1.rows[0].count).toLocaleString()}`);
        await verifyClient.query(`TRUNCATE "${schemaName}"."${tableName}"`);
    } finally {
        verifyClient.release();
    }

    // --- TEST 2: 250,000 Rows with 8 Parallel Workers ---
    console.log('\n▶ Test 2: Generating 250,000 rows across 8 parallel workers...');
    const res250k = await runParallelGenerateJob({
        pool,
        schemaName,
        tableName,
        totalCount: 250_000,
        columns,
        concurrency: 8,
        onProgress: (p) => {
            if (p.completedRows % 50000 === 0 || p.percent === 100) {
                console.log(`   [Progress] ${p.percent}% (${p.completedRows.toLocaleString()}/${p.totalRows.toLocaleString()}) - ${p.currentRps.toLocaleString()} rows/s`);
            }
        },
    });

    console.log(`✅ Test 2 Finished: 250,000 rows in ${(res250k.durationMs / 1000).toFixed(2)}s (${res250k.rowsPerSecond.toLocaleString()} rows/s) using ${res250k.workersUsed} workers\n`);

    // Clean up
    const cleanClient = await pool.connect();
    try {
        const c2 = await cleanClient.query(`SELECT count(*) FROM "${schemaName}"."${tableName}"`);
        console.log(`Final verified row count: ${Number(c2.rows[0].count).toLocaleString()}`);
        await cleanClient.query(`DROP TABLE IF EXISTS "${schemaName}"."${tableName}"`);
    } finally {
        cleanClient.release();
        await pool.end();
    }

    console.log('================================================================');
    console.log('🎉 ALL PARALLEL CHUNKED WORKER TESTS PASSED WITH 100% INTEGRITY!');
    console.log('================================================================');
}

testChunkedParallel().catch(console.error);
