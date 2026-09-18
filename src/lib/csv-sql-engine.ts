import pkg from 'node-sql-parser';
const { Parser } = pkg;

export interface CsvTableData {
  headers: string[];
  rows: Record<string, any>[];
}

export interface CsvQueryResult {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
}

/**
 * Safely parses an ISO date, SQL datetime ("YYYY-MM-DD HH:MM:SS"), or standard timestamp string 
 * into unix epoch milliseconds. Returns NaN if parsing fails.
 */
export function parseTimestampToMs(val: any): number {
  if (val === null || val === undefined) return NaN;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (!str) return NaN;

  // Handle standard SQL format "YYYY-MM-DD HH:MM:SS" by replacing space with T
  const normalized = str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str;
  const parsed = Date.parse(normalized);
  if (!isNaN(parsed)) return parsed;

  const d = new Date(str);
  return isNaN(d.getTime()) ? NaN : d.getTime();
}

/**
 * Normalizes SQL queries before parsing/executing:
 * - Strips single and multiline comments.
 * - Removes illegal trailing commas after CTE blocks before the main statement.
 */
export function normalizeSqlQuery(sql: string): string {
  let cleaned = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  // Fix trailing comma after CTE before main statement:
  // e.g. ") , SELECT ..." or "), \n SELECT ..."
  cleaned = cleaned.replace(/\)\s*,\s*(?=(?:SELECT|INSERT|UPDATE|DELETE|MERGE)\b)/gi, ') ');

  return cleaned;
}

/**
 * Splits comma-separated SQL clauses while respecting nested parentheses and quotes.
 */
export function splitSqlList(clause: string): string[] {
  const items: string[] = [];
  let cur = '';
  let depth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < clause.length; i++) {
    const c = clause[i];
    if ((c === "'" || c === '"') && (i === 0 || clause[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = c;
      } else if (c === quoteChar) {
        inQuotes = false;
      }
    }

    if (!inQuotes) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c === ',' && depth === 0) {
        if (cur.trim()) items.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/**
 * In-memory SQL engine for executing SQL queries on CSV/tabular data.
 * Supports:
 * - CTEs (multiple CTEs, chained CTEs referencing earlier ones)
 * - Window Functions (LAG, LEAD, ROW_NUMBER over ORDER BY)
 * - Timestamp Arithmetic & EXTRACT(EPOCH FROM (...))
 * - Mathematical division & expressions (/ 3600.0)
 * - Aggregate Functions (MAX, MIN, AVG, SUM, COUNT)
 * - WHERE clause filtering (IS NOT NULL, IS NULL, comparisons)
 */
export class CsvSqlEngine {
  private tables: Map<string, Record<string, any>[]> = new Map();
  private parser: any;

  constructor(initialTables?: Record<string, any[] | string>) {
    this.parser = new Parser();
    if (initialTables) {
      for (const [name, data] of Object.entries(initialTables)) {
        if (typeof data === 'string') {
          this.loadCsv(name, data);
        } else if (Array.isArray(data)) {
          this.registerTable(name, data);
        }
      }
    }
  }

  public registerTable(name: string, rows: Record<string, any>[]) {
    this.tables.set(name.toLowerCase(), rows.map(r => ({ ...r })));
  }

  public getTable(name: string): Record<string, any>[] | undefined {
    return this.tables.get(name.toLowerCase());
  }

  public loadCsv(tableName: string, csvContent: string) {
    const lines = csvContent
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
      .split('\n')
      .filter(l => l.trim().length > 0);

    if (lines.length === 0) {
      this.registerTable(tableName, []);
      return;
    }

    const parseRow = (line: string): string[] => {
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const headers = parseRow(lines[0]);
    const rows: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseRow(lines[i]);
      const row: Record<string, any> = {};
      headers.forEach((h, idx) => {
        row[h] = vals[idx] !== undefined ? vals[idx] : null;
      });
      rows.push(row);
    }

    this.registerTable(tableName, rows);
  }

  /**
   * Executes a SQL query against loaded in-memory tables.
   */
  public execute(sql: string): CsvQueryResult {
    const cleanedSql = normalizeSqlQuery(sql);
    
    // Parse CTEs and main query
    const { ctes, mainSql } = this.parseCtesAndMain(cleanedSql);
    const localTables = new Map<string, Record<string, any>[]>(this.tables);

    // Sequentially execute each CTE and register its result as an in-memory table
    for (const cte of ctes) {
      const cteResult = this.executeSelect(cte.query, localTables);
      localTables.set(cte.name.toLowerCase(), cteResult.rows);
    }

    // Execute the main query (the statement following CTEs)
    return this.executeSelect(mainSql, localTables);
  }

  /**
   * Parses WITH ... AS (...) CTE definitions and extracts the main statement.
   */
  private parseCtesAndMain(sql: string): { ctes: { name: string; query: string }[]; mainSql: string } {
    const ctes: { name: string; query: string }[] = [];
    const withMatch = sql.match(/^\s*WITH\s+/i);
    if (!withMatch) {
      return { ctes, mainSql: sql };
    }

    let index = withMatch[0].length;
    while (index < sql.length) {
      const remaining = sql.slice(index);
      const nameMatch = remaining.match(/^\s*([a-zA-Z0-9_]+)\s+AS\s*\(/i);
      if (!nameMatch) break;

      const cteName = nameMatch[1];
      const parenStart = index + remaining.indexOf('(');
      
      let depth = 0;
      let parenEnd = -1;
      for (let i = parenStart; i < sql.length; i++) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') {
          depth--;
          if (depth === 0) {
            parenEnd = i;
            break;
          }
        }
      }

      if (parenEnd === -1) break;

      const cteQuery = sql.slice(parenStart + 1, parenEnd).trim();
      ctes.push({ name: cteName, query: cteQuery });
      index = parenEnd + 1;

      // Skip optional comma and whitespace
      const afterParen = sql.slice(index).match(/^\s*,?\s*/);
      if (afterParen) {
        index += afterParen[0].length;
      }

      // If next token starts the main query (e.g. SELECT, INSERT, etc.), finish CTE extraction
      if (/^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql.slice(index))) {
        break;
      }
    }

    let mainSql = sql.slice(index).trim();
    if (mainSql.startsWith(',')) {
      mainSql = mainSql.slice(1).trim();
    }

    return { ctes, mainSql };
  }

  /**
   * Safely splits SELECT and FROM clauses respecting parenthesis depth so that
   * clauses like EXTRACT(EPOCH FROM ...) do not prematurely match table FROM.
   */
  private extractSelectAndFrom(query: string): { selectClause: string; fromClause: string } {
    const selectMatch = query.match(/^\s*SELECT\s+/i);
    if (!selectMatch) return { selectClause: query, fromClause: '' };

    const start = selectMatch[0].length;
    let depth = 0;
    let inQuotes = false;
    let quoteChar = '';
    let fromIndex = -1;

    for (let i = start; i < query.length; i++) {
      const c = query[i];
      if ((c === "'" || c === '"') && (i === 0 || query[i - 1] !== '\\')) {
        if (!inQuotes) { inQuotes = true; quoteChar = c; }
        else if (c === quoteChar) { inQuotes = false; }
      }
      if (!inQuotes) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (depth === 0 && query.slice(i).match(/^\bFROM\b/i)) {
          fromIndex = i;
          break;
        }
      }
    }

    if (fromIndex === -1) {
      return { selectClause: query.slice(start).trim(), fromClause: '' };
    }

    return {
      selectClause: query.slice(start, fromIndex).trim(),
      fromClause: query.slice(fromIndex + 4).trim()
    };
  }

  /**
   * Executes a single SELECT query against the provided table catalog.
   */
  private executeSelect(query: string, catalog: Map<string, Record<string, any>[]>): CsvQueryResult {
    let clean = query.trim().replace(/;$/, '');

    const { selectClause, fromClause } = this.extractSelectAndFrom(clean);

    // Extract FROM table name
    const fromMatch = fromClause.match(/^\s*["`]?([a-zA-Z0-9_]+)["`]?/i);
    const tableName = fromMatch ? fromMatch[1].toLowerCase() : null;
    let sourceRows: Record<string, any>[] = [];

    if (tableName) {
      const tableData = catalog.get(tableName);
      if (!tableData) {
        throw new Error(`Table '${tableName}' not found in in-memory catalog.`);
      }
      sourceRows = tableData.map(r => ({ ...r }));
    } else {
      sourceRows = [{}];
    }

    // Extract window functions from SELECT clause
    const windowFuncs = this.extractWindowFunctions(clean);
    for (const wf of windowFuncs) {
      sourceRows = this.evaluateWindowFunction(sourceRows, wf);
    }

    // Process WHERE clause
    const whereMatch = clean.match(/\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i);
    if (whereMatch) {
      const whereClause = whereMatch[1].trim();
      sourceRows = sourceRows.filter(row => this.evaluateWhereCondition(row, whereClause));
    }

    // Check if query is an aggregate query
    const isAggregate = /\b(MAX|MIN|AVG|SUM|COUNT)\s*\(/i.test(selectClause);

    if (isAggregate) {
      return this.evaluateAggregates(sourceRows, selectClause);
    }

    // Regular column projection
    return this.evaluateProjection(sourceRows, selectClause);
  }

  /**
   * Finds window function declarations in the query text.
   */
  private extractWindowFunctions(query: string): {
    func: 'LAG' | 'LEAD' | 'ROW_NUMBER';
    argCol?: string;
    orderCol: string;
    alias: string;
  }[] {
    const results: any[] = [];
    const regex = /\b(LAG|LEAD|ROW_NUMBER)\s*\(\s*([a-zA-Z0-9_]*)\s*\)\s*OVER\s*\(\s*ORDER\s+BY\s+([a-zA-Z0-9_]+)\s*(?:ASC|DESC)?\s*\)\s+AS\s+([a-zA-Z0-9_]+)/gi;
    let match;
    while ((match = regex.exec(query)) !== null) {
      results.push({
        func: match[1].toUpperCase(),
        argCol: match[2] || undefined,
        orderCol: match[3],
        alias: match[4]
      });
    }
    return results;
  }

  /**
   * Evaluates LAG, LEAD, ROW_NUMBER over ordered rows.
   */
  private evaluateWindowFunction(rows: Record<string, any>[], wf: {
    func: 'LAG' | 'LEAD' | 'ROW_NUMBER';
    argCol?: string;
    orderCol: string;
    alias: string;
  }): Record<string, any>[] {
    // Sort rows based on orderCol
    const sorted = [...rows].sort((a, b) => {
      const valA = a[wf.orderCol];
      const valB = b[wf.orderCol];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      return valA < valB ? -1 : 1;
    });

    return sorted.map((row, idx) => {
      const newRow = { ...row };
      if (wf.func === 'LAG') {
        newRow[wf.alias] = idx > 0 ? sorted[idx - 1][wf.argCol!] : null;
      } else if (wf.func === 'LEAD') {
        newRow[wf.alias] = idx < sorted.length - 1 ? sorted[idx + 1][wf.argCol!] : null;
      } else if (wf.func === 'ROW_NUMBER') {
        newRow[wf.alias] = idx + 1;
      }
      return newRow;
    });
  }

  /**
   * Evaluates boolean WHERE conditions.
   */
  private evaluateWhereCondition(row: Record<string, any>, condition: string): boolean {
    const trimmed = condition.trim();
    if (!trimmed) return true;

    // Handle "col IS NOT NULL"
    const isNotNullMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+IS\s+NOT\s+NULL$/i);
    if (isNotNullMatch) {
      const col = isNotNullMatch[1];
      return row[col] !== null && row[col] !== undefined;
    }

    // Handle "col IS NULL"
    const isNullMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+IS\s+NULL$/i);
    if (isNullMatch) {
      const col = isNullMatch[1];
      return row[col] === null || row[col] === undefined;
    }

    // Handle "col op val"
    const cmpMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*(=|!=|<>|>|<|>=|<=)\s*(['"]?[^'"]*['"]?)$/i);
    if (cmpMatch) {
      const col = cmpMatch[1];
      const op = cmpMatch[2];
      let val: any = cmpMatch[3].replace(/^['"]|['"]$/g, '');
      const rowVal = row[col];

      if (!isNaN(Number(val))) val = Number(val);
      const numericRowVal = !isNaN(Number(rowVal)) ? Number(rowVal) : rowVal;

      switch (op) {
        case '=': return numericRowVal == val;
        case '!=':
        case '<>': return numericRowVal != val;
        case '>': return numericRowVal > val;
        case '<': return numericRowVal < val;
        case '>=': return numericRowVal >= val;
        case '<=': return numericRowVal <= val;
      }
    }

    return true;
  }

  /**
   * Evaluates aggregate expressions across matching rows.
   */
  private evaluateAggregates(rows: Record<string, any>[], selectClause: string): CsvQueryResult {
    const outRow: Record<string, any> = {};
    const columns: string[] = [];

    const items = splitSqlList(selectClause);

    for (const item of items) {
      const match = item.match(/\b(MAX|MIN|AVG|SUM|COUNT)\s*\(\s*([^)]+)\s*\)(?:\s+AS\s+([a-zA-Z0-9_]+))?/i);
      if (!match) continue;

      const aggFunc = match[1].toUpperCase();
      const expr = match[2].trim();
      const alias = match[3] || `${aggFunc.toLowerCase()}_${expr.replace(/[^a-zA-Z0-9_]/g, '_')}`;

      columns.push(alias);

      if (rows.length === 0) {
        outRow[alias] = aggFunc === 'COUNT' ? 0 : null;
        continue;
      }

      const values: number[] = [];
      for (const row of rows) {
        const v = this.evaluateExpression(row, expr);
        if (v !== null && v !== undefined && !isNaN(Number(v))) {
          values.push(Number(v));
        }
      }

      if (aggFunc === 'COUNT') {
        outRow[alias] = expr === '*' ? rows.length : values.length;
      } else if (values.length === 0) {
        outRow[alias] = null;
      } else {
        switch (aggFunc) {
          case 'MAX': outRow[alias] = Math.max(...values); break;
          case 'MIN': outRow[alias] = Math.min(...values); break;
          case 'SUM': outRow[alias] = values.reduce((a, b) => a + b, 0); break;
          case 'AVG': outRow[alias] = values.reduce((a, b) => a + b, 0) / values.length; break;
        }
      }
    }

    return {
      rows: [outRow],
      columns,
      rowCount: 1
    };
  }

  /**
   * Evaluates a computed scalar expression or column lookup for a row.
   */
  private evaluateExpression(row: Record<string, any>, expr: string): any {
    const trimmed = expr.trim();

    // 1. Direct column lookup
    if (trimmed in row) {
      return row[trimmed];
    }

    // 2. Division: "... / <number>"
    const divMatch = trimmed.match(/^([\s\S]+?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/i);
    if (divMatch) {
      const numerator = this.evaluateExpression(row, divMatch[1]);
      const divisor = parseFloat(divMatch[2]);
      if (numerator === null || isNaN(numerator) || divisor === 0) return null;
      return numerator / divisor;
    }

    // 3. EXTRACT(EPOCH FROM (...))
    const extractMatch = trimmed.match(/^EXTRACT\s*\(\s*EPOCH\s+FROM\s*\(\s*([\s\S]+?)\s*\)\s*\)$/i);
    if (extractMatch) {
      const innerExpr = extractMatch[1].trim();
      const subMatch = innerExpr.match(/^([a-zA-Z0-9_]+)\s*-\s*([a-zA-Z0-9_]+)$/);
      if (subMatch) {
        const col1 = subMatch[1];
        const col2 = subMatch[2];
        const val1 = row[col1];
        const val2 = row[col2];

        const ms1 = parseTimestampToMs(val1);
        const ms2 = parseTimestampToMs(val2);

        if (isNaN(ms1) || isNaN(ms2)) return null;
        return (ms1 - ms2) / 1000.0;
      }
    }

    // Strip optional enclosing parentheses
    let unparen = trimmed;
    if (unparen.startsWith('(') && unparen.endsWith(')')) {
      unparen = unparen.slice(1, -1).trim();
    }

    // 4. Raw timestamp subtraction "timestamp - prev_timestamp" or "(timestamp - prev_timestamp)"
    const subMatch = unparen.match(/^([a-zA-Z0-9_]+)\s*-\s*([a-zA-Z0-9_]+)$/);
    if (subMatch) {
      const ms1 = parseTimestampToMs(row[subMatch[1]]);
      const ms2 = parseTimestampToMs(row[subMatch[2]]);
      if (isNaN(ms1) || isNaN(ms2)) return null;
      return (ms1 - ms2) / 1000.0;
    }

    // 5. ABS(...)
    const absMatch = trimmed.match(/^ABS\s*\(\s*([\s\S]+?)\s*\)$/i);
    if (absMatch) {
      const inner = this.evaluateExpression(row, absMatch[1]);
      return inner !== null && !isNaN(Number(inner)) ? Math.abs(Number(inner)) : null;
    }

    return null;
  }

  /**
   * Evaluates SELECT projection list.
   */
  private evaluateProjection(rows: Record<string, any>[], selectClause: string): CsvQueryResult {
    if (rows.length === 0) {
      return { rows: [], columns: [], rowCount: 0 };
    }

    const items = splitSqlList(selectClause);
    const hasWildcard = items.some(i => i.trim() === '*');

    const projectHeaders: { expr: string; alias: string; isWildcard?: boolean }[] = [];

    for (const item of items) {
      if (item.trim() === '*') {
        projectHeaders.push({ expr: '*', alias: '*', isWildcard: true });
        continue;
      }

      const aliasMatch = item.match(/^([\s\S]+?)\s+AS\s+([a-zA-Z0-9_]+)$/i);
      if (aliasMatch) {
        projectHeaders.push({ expr: aliasMatch[1].trim(), alias: aliasMatch[2].trim() });
      } else {
        projectHeaders.push({ expr: item.trim(), alias: item.trim() });
      }
    }

    const baseCols = Object.keys(rows[0] || {});
    const finalColumns: string[] = [];

    for (const ph of projectHeaders) {
      if (ph.isWildcard) {
        for (const bc of baseCols) {
          if (!finalColumns.includes(bc)) finalColumns.push(bc);
        }
      } else {
        if (!finalColumns.includes(ph.alias)) finalColumns.push(ph.alias);
      }
    }

    const projectedRows = rows.map(row => {
      const newRow: Record<string, any> = {};

      if (hasWildcard) {
        for (const bc of baseCols) {
          newRow[bc] = row[bc];
        }
      }

      for (const ph of projectHeaders) {
        if (ph.isWildcard) continue;

        // If this field was already populated (e.g. from window function), preserve it
        if (ph.alias in row && !(ph.expr in row)) {
          newRow[ph.alias] = row[ph.alias];
        } else if (ph.expr in row) {
          newRow[ph.alias] = row[ph.expr];
        } else {
          newRow[ph.alias] = this.evaluateExpression(row, ph.expr);
        }
      }
      return newRow;
    });

    return {
      rows: projectedRows,
      columns: finalColumns,
      rowCount: projectedRows.length
    };
  }
}
