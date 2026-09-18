import { describe, it, expect } from 'vitest';
import { CsvSqlEngine, normalizeSqlQuery } from '@/lib/csv-sql-engine';
import { SQL_CAPABILITIES, getSqlCapabilityPrompt } from '@/lib/sql-capabilities';

describe('Fluxbase SQL Engine & CTE / Window Function / Timestamp Arithmetic', () => {
  const samplePredictions = [
    { id: 1, timestamp: '2026-09-17T10:00:00', price: 60000, balance: 5000 },
    { id: 2, timestamp: '2026-09-17T10:05:00', price: 60100, balance: 5050 },
    { id: 3, timestamp: '2026-09-17T12:35:00', price: 60200, balance: 5100 }
  ];

  // 1. Basic SELECT
  it('1. executes basic SELECT queries', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const res = engine.execute('SELECT id, timestamp, price FROM predictions;');
    expect(res.rows.length).toBe(3);
    expect(res.columns).toEqual(['id', 'timestamp', 'price']);
    expect(res.rows[0].id).toBe(1);
  });

  // 2. MAX aggregate
  it('2. executes MAX aggregate function', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const res = engine.execute('SELECT MAX(price) AS max_price FROM predictions;');
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].max_price).toBe(60200);
  });

  // 3. Single CTE
  it('3. executes single Common Table Expression (CTE)', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      WITH cte AS (
        SELECT id, timestamp FROM predictions
      )
      SELECT * FROM cte;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(3);
    expect(res.rows[0].id).toBe(1);
  });

  // 4. Multiple CTEs referencing previous CTEs
  it('4. executes multiple chained CTEs', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      WITH step1 AS (
        SELECT id, price FROM predictions
      ),
      step2 AS (
        SELECT id, price FROM step1 WHERE price > 60050
      )
      SELECT * FROM step2;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(2);
    expect(res.rows[0].id).toBe(2);
    expect(res.rows[1].id).toBe(3);
  });

  // 5. LAG window function
  it('5. executes LAG window function over ORDER BY', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      SELECT id, timestamp,
             LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
      FROM predictions;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(3);
    expect(res.rows[0].prev_timestamp).toBeNull();
    expect(res.rows[1].prev_timestamp).toBe('2026-09-17T10:00:00');
    expect(res.rows[2].prev_timestamp).toBe('2026-09-17T10:05:00');
  });

  // 6. Timestamp subtraction
  it('6. executes timestamp subtraction between string timestamp values', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      WITH ordered AS (
        SELECT timestamp, LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
        FROM predictions
      )
      SELECT (timestamp - prev_timestamp) AS diff_seconds
      FROM ordered
      WHERE prev_timestamp IS NOT NULL;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(2);
    expect(res.rows[0].diff_seconds).toBe(300); // 5 minutes = 300s
    expect(res.rows[1].diff_seconds).toBe(9000); // 2 hours 30 min = 9000s
  });

  // 7. EXTRACT(EPOCH)
  it('7. executes EXTRACT(EPOCH FROM (...)) returning difference in seconds', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      WITH ordered AS (
        SELECT timestamp, LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
        FROM predictions
      )
      SELECT EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) AS time_diff_seconds
      FROM ordered
      WHERE prev_timestamp IS NOT NULL;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(2);
    expect(res.rows[0].time_diff_seconds).toBe(300);
    expect(res.rows[1].time_diff_seconds).toBe(9000);
  });

  // 8. Timestamp difference in hours
  it('8. executes timestamp difference in hours via / 3600.0', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      WITH ordered AS (
        SELECT timestamp, LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
        FROM predictions
      )
      SELECT EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) / 3600.0 AS time_diff_hours
      FROM ordered
      WHERE prev_timestamp IS NOT NULL;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(2);
    expect(res.rows[0].time_diff_hours).toBeCloseTo(300 / 3600, 4);
    expect(res.rows[1].time_diff_hours).toBe(2.5);
  });

  // 9. Longest prediction gap (Original use case query)
  it('9. computes longest prediction gap of 2.5 hours correctly', () => {
    const engine = new CsvSqlEngine({ predictions: samplePredictions });
    const query = `
      WITH ordered_predictions AS (
          SELECT *,
                 LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
          FROM predictions
      ),
      time_differences AS (
          SELECT timestamp,
                 prev_timestamp,
                 EXTRACT(EPOCH FROM (
                     timestamp - prev_timestamp
                 )) / 3600.0 AS time_diff_hours
          FROM ordered_predictions
          WHERE prev_timestamp IS NOT NULL
      )
      SELECT MAX(time_diff_hours) AS longest_shutdown_time_hours
      FROM time_differences;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].longest_shutdown_time_hours).toBe(2.5);
  });

  // 10. Empty predictions table
  it('10. handles empty predictions table gracefully without throwing', () => {
    const engine = new CsvSqlEngine({ predictions: [] });
    const query = `
      WITH ordered_predictions AS (
          SELECT *,
                 LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
          FROM predictions
      ),
      time_differences AS (
          SELECT timestamp,
                 prev_timestamp,
                 EXTRACT(EPOCH FROM (
                     timestamp - prev_timestamp
                 )) / 3600.0 AS time_diff_hours
          FROM ordered_predictions
          WHERE prev_timestamp IS NOT NULL
      )
      SELECT MAX(time_diff_hours) AS longest_shutdown_time_hours
      FROM time_differences;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].longest_shutdown_time_hours).toBeNull();
  });

  // 11. One prediction row
  it('11. handles single-row table gracefully (prev_timestamp is NULL, filtered out)', () => {
    const engine = new CsvSqlEngine({
      predictions: [{ id: 1, timestamp: '2026-09-17T10:00:00' }]
    });
    const query = `
      WITH ordered_predictions AS (
          SELECT *,
                 LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
          FROM predictions
      ),
      time_differences AS (
          SELECT timestamp,
                 prev_timestamp,
                 EXTRACT(EPOCH FROM (
                     timestamp - prev_timestamp
                 )) / 3600.0 AS time_diff_hours
          FROM ordered_predictions
          WHERE prev_timestamp IS NOT NULL
      )
      SELECT MAX(time_diff_hours) AS longest_shutdown_time_hours
      FROM time_differences;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].longest_shutdown_time_hours).toBeNull();
  });

  // 12. Duplicate timestamps
  it('12. handles duplicate timestamps producing 0 hours gap', () => {
    const engine = new CsvSqlEngine({
      predictions: [
        { id: 1, timestamp: '2026-09-17T10:00:00' },
        { id: 2, timestamp: '2026-09-17T10:00:00' }
      ]
    });
    const query = `
      WITH ordered_predictions AS (
          SELECT *,
                 LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
          FROM predictions
      ),
      time_differences AS (
          SELECT timestamp,
                 prev_timestamp,
                 EXTRACT(EPOCH FROM (
                     timestamp - prev_timestamp
                 )) / 3600.0 AS time_diff_hours
          FROM ordered_predictions
          WHERE prev_timestamp IS NOT NULL
      )
      SELECT MAX(time_diff_hours) AS longest_shutdown_time_hours
      FROM time_differences;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].longest_shutdown_time_hours).toBe(0);
  });

  // 13. Invalid timestamps
  it('13. handles invalid timestamps gracefully without crashing', () => {
    const engine = new CsvSqlEngine({
      predictions: [
        { id: 1, timestamp: 'not-a-timestamp' },
        { id: 2, timestamp: 'still-not-a-timestamp' }
      ]
    });
    const query = `
      WITH ordered_predictions AS (
          SELECT *,
                 LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
          FROM predictions
      ),
      time_differences AS (
          SELECT timestamp,
                 prev_timestamp,
                 EXTRACT(EPOCH FROM (
                     timestamp - prev_timestamp
                 )) / 3600.0 AS time_diff_hours
          FROM ordered_predictions
          WHERE prev_timestamp IS NOT NULL
      )
      SELECT MAX(time_diff_hours) AS longest_shutdown_time_hours
      FROM time_differences;
    `;
    const res = engine.execute(query);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].longest_shutdown_time_hours).toBeNull();
  });

  // 14. MySQL-compatible queries & normalization
  it('14. normalizes MySQL EXTRACT(EPOCH) and handles CTE trailing commas', () => {
    const queryWithTrailingComma = `
      WITH cte1 AS (SELECT 1 AS x),
      cte2 AS (SELECT 2 AS y),
      SELECT * FROM cte2;
    `;
    const normalized = normalizeSqlQuery(queryWithTrailingComma);
    expect(normalized).not.toMatch(/\)\s*,\s*SELECT/);
    expect(normalized).toMatch(/\)\s+SELECT/);

    const engine = new CsvSqlEngine({
      predictions: samplePredictions
    });
    // Query with trailing comma executes cleanly without parse error
    const res = engine.execute(`
      WITH p AS (SELECT * FROM predictions),
      SELECT COUNT(*) AS total FROM p;
    `);
    expect(res.rows[0].total).toBe(3);
  });

  // 15. Existing Fluxbase SQL queries & Capability Registry
  it('15. verifies SQL_CAPABILITIES registry and capability prompt generation', () => {
    expect(SQL_CAPABILITIES.ctes).toBe(true);
    expect(SQL_CAPABILITIES.windowFunctions).toBe(true);
    expect(SQL_CAPABILITIES.lag).toBe(true);
    expect(SQL_CAPABILITIES.extractEpoch).toBe(true);
    expect(SQL_CAPABILITIES.aggregates).toBe(true);

    const pgPrompt = getSqlCapabilityPrompt('postgresql');
    expect(pgPrompt).toContain('Common Table Expressions');
    expect(pgPrompt).toContain('LAG(col)');
    expect(pgPrompt).toContain('POSTGRESQL');

    const mysqlPrompt = getSqlCapabilityPrompt('mysql');
    expect(mysqlPrompt).toContain('MYSQL');
  });
});
