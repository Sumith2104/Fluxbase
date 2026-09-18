/**
 * Fluxbase SQL Engine Capability Registry
 * 
 * Defines the SQL dialect features supported by Fluxbase across native database 
 * backends (PostgreSQL, MySQL) and the built-in CSV/in-memory query engine.
 */
export interface SqlCapabilities {
  ctes: boolean;
  windowFunctions: boolean;
  lag: boolean;
  lead: boolean;
  rowNumber: boolean;
  timestampArithmetic: boolean;
  extractEpoch: boolean;
  aggregates: boolean;
  csvEngine: boolean;
  dialects: ('postgresql' | 'mysql' | 'csv')[];
}

export const SQL_CAPABILITIES: SqlCapabilities = {
  ctes: true,
  windowFunctions: true,
  lag: true,
  lead: true,
  rowNumber: true,
  timestampArithmetic: true,
  extractEpoch: true,
  aggregates: true,
  csvEngine: true,
  dialects: ['postgresql', 'mysql', 'csv']
};

/**
 * Returns dialect-specific capability descriptions for AI prompt augmentation.
 */
export function getSqlCapabilityPrompt(dialect: string = 'postgresql'): string {
  const isMysql = dialect.toLowerCase() === 'mysql';
  return `=== SQL ENGINE CAPABILITIES (${dialect.toUpperCase()}) ===
- Common Table Expressions (WITH cte AS (...) SELECT ...): FULLY SUPPORTED.
  * When chaining multiple CTEs, use: WITH cte1 AS (...), cte2 AS (...) SELECT ...
  * IMPORTANT: NEVER put a comma after the final CTE closing parenthesis before SELECT ("), SELECT" is a syntax error).
- Window Functions:
  * LAG(col) OVER (ORDER BY col) - supported.
  * LEAD(col) OVER (ORDER BY col) - supported.
  * ROW_NUMBER() OVER (ORDER BY col) - supported.
- Timestamp Arithmetic & Intervals:
  * Timestamps stored as VARCHAR or ISO strings (e.g. '2026-09-17T10:00:00') are supported.
  * For seconds diff: EXTRACT(EPOCH FROM (timestamp - prev_timestamp))
  * For hours diff: EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) / 3600.0
- Aggregate Functions:
  * MAX(), MIN(), AVG(), SUM(), COUNT() - supported on base columns, CTE outputs, and window results.
${isMysql ? '- Dialect is MySQL: Use standard MySQL 8.0+ window functions. TIMESTAMPDIFF and EXTRACT(EPOCH) are both accommodated.' : '- Dialect is PostgreSQL: Search path and type casting are fully configured for string timestamp calculations.'}`;
}
