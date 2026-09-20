'use server';

/**
 * @fileOverview Flow for converting user input into SQL queries.
 * Backed by the production-grade Flux Agent Core (SqlAgent).
 */

import { z } from 'zod';
import { SqlAgent } from '@/lib/agent-core/sql-agent';

export const GenerateSQLInputSchema = z.object({
  userInput: z.string().describe('The user question in plain English.'),
  tableSchema: z.string().describe('The schema of the SQL table.'),
  dialect: z.string().default('PostgreSQL').describe('The SQL dialect to format the query in (e.g., PostgreSQL, MySQL).'),
});
export type GenerateSQLInput = z.infer<typeof GenerateSQLInputSchema>;

export const GenerateSQLOutputSchema = z.object({
  isDangerous: z.boolean().describe('Set to true ONLY if the user prompt implies a destructive or modifying command (e.g., DELETE, DROP, TRUNCATE, ALTER).'),
  userMessage: z.string().describe('If you block the query because it is dangerous, kindly explain to the user why you cannot process their request. Otherwise, leave empty.'),
  sqlQuery: z.string().describe('The generated SQL query.'),
});
export type GenerateSQLOutput = z.infer<typeof GenerateSQLOutputSchema>;

export async function generateSQL(input: GenerateSQLInput): Promise<GenerateSQLOutput> {
  const result = await SqlAgent.generateAndValidateSQL({
    projectId: '',
    userId: 'system',
    userInput: input.userInput,
    tableSchema: input.tableSchema,
    dialect: input.dialect,
    allowDestructive: true
  });

  return {
    isDangerous: result.isDangerous,
    userMessage: result.warning || '',
    sqlQuery: result.query || ''
  };
}
