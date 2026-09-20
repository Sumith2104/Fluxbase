'use server';

/**
 * @fileOverview Data insights generation agent backed by ModelGateway.
 */

import { z } from 'zod';
import { ModelGateway } from '@/lib/agent-core/gateway';

export const GenerateInsightsInputSchema = z.object({
  data: z.string().describe('The data to analyze, in JSON format.'),
  query: z.string().describe('The user query to answer based on the data.'),
});
export type GenerateInsightsInput = z.infer<typeof GenerateInsightsInputSchema>;

export const GenerateInsightsOutputSchema = z.object({
  insights: z.string().describe('The insights generated from the data.'),
});
export type GenerateInsightsOutput = z.infer<typeof GenerateInsightsOutputSchema>;

export async function generateInsights(input: GenerateInsightsInput): Promise<GenerateInsightsOutput> {
  const messages = [
    {
      role: 'system' as const,
      content: 'You are an expert database analyst. Generate concise, actionable data insights based on the provided dataset and answer the user question.'
    },
    {
      role: 'user' as const,
      content: `Data:\n${input.data}\n\nQuestion:\n${input.query}`
    }
  ];

  const result = await ModelGateway.generate({
    model: 'flux-fast',
    messages,
    temperature: 0.2
  });

  return {
    insights: result.text
  };
}
