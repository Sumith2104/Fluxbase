process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';
import logger from '@/lib/logger';

const baseAi = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-2.5-flash',
});

const FALLBACK_MODELS = [
  'googleai/gemini-2.5-flash',
  'googleai/gemini-2.0-flash',
  'googleai/gemini-1.5-flash',
  'googleai/gemini-1.5-pro',
];


const THIRD_PARTY_PROVIDERS = ['groq', 'xai', 'openai', 'nvidia', 'glm'];

function describeZodSchema(schema: any): any {
  if (!schema) return 'any';
  if (schema._def) {
    const typeName = schema._def.typeName;
    if (typeName === 'ZodObject') {
      const shape = schema.shape;
      const res: any = {};
      for (const key of Object.keys(shape)) {
        res[key] = describeZodSchema(shape[key]);
      }
      return res;
    } else if (typeName === 'ZodArray') {
      return [describeZodSchema(schema._def.type)];
    } else if (typeName === 'ZodEffects') {
      return describeZodSchema(schema._def.schema);
    } else if (typeName === 'ZodOptional') {
      return describeZodSchema(schema._def.innerType);
    } else if (typeName === 'ZodNullable') {
      return describeZodSchema(schema._def.innerType);
    } else if (typeName === 'ZodString') {
      return 'string';
    } else if (typeName === 'ZodNumber') {
      return 'number';
    } else if (typeName === 'ZodBoolean') {
      return 'boolean';
    }
  }
  return 'any';
}

async function tryThirdPartyProvider(provider: string, prompt: string, schema: any) {
  let url = '';
  let apiKey = '';
  let model = '';

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    apiKey = process.env.GROQ_API_KEY || '';
    model = 'llama-3.3-70b-versatile';
  } else if (provider === 'xai') {
    url = 'https://api.x.ai/v1/chat/completions';
    apiKey = process.env.XAI_API_KEY || '';
    model = 'grok-2-latest';
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    apiKey = process.env.OPENAI_API_KEY || '';
    model = 'gpt-4o-mini';
  } else if (provider === 'nvidia') {
    url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    apiKey = process.env.NVIDIA_API_KEY || '';
    model = 'nvidia/llama-3.1-nemotron-70b-instruct';
  } else if (provider === 'glm') {
    url = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    apiKey = process.env.GLM_API_KEY || '';
    model = process.env.GLM_MODEL || 'glm-4-flash';
  }


  if (!apiKey) {
    throw new Error(`API key for ${provider} is not set.`);
  }

  let finalPrompt = prompt;
  if (schema) {
    finalPrompt += `\n\nCRITICAL REQUIREMENT: You MUST respond with a valid JSON object conforming exactly to this JSON schema shape:\n${JSON.stringify(describeZodSchema(schema))}\nDo not wrap the JSON in markdown code blocks like \`\`\`json. Return raw JSON.`;
  }

  if (provider === 'glm') {
    const glmModels = [process.env.GLM_MODEL || 'glm-4-flash', 'glm-4-flash', 'glm-4v-flash'];
    const uniqueModels = Array.from(new Set(glmModels));
    let lastGlmErr: any = null;

    for (const glmModel of uniqueModels) {
      try {
        logger.info(`[AI] Dispatching fetch to GLM (${glmModel})...`);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            model: glmModel,
            messages: [{ role: 'user', content: finalPrompt }],
            response_format: schema ? { type: 'json_object' } : undefined,
            temperature: 0.2
          })
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`GLM (${glmModel}) request failed with status ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content || '';

        let output = null;
        if (schema) {
          try {
            output = JSON.parse(rawText.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim());
          } catch (e: any) {
            logger.error(`[AI] Failed to parse JSON response from GLM (${glmModel}):`, e);
            throw new Error(`Invalid JSON format returned by GLM (${glmModel})`);
          }
        }

        return {
          text: rawText,
          output,
          message: { content: [{ text: rawText }] }
        };
      } catch (e: any) {
        lastGlmErr = e;
        logger.warn(`[AI] GLM model ${glmModel} failed, trying next tier:`, e.message || e);
      }
    }
    throw lastGlmErr;
  }

  logger.info(`[AI] Dispatching fetch to third-party provider ${provider} (${model})...`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: finalPrompt }],
      response_format: schema ? { type: 'json_object' } : undefined,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${provider} request failed with status ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';

  let output = null;
  if (schema) {
    try {
      output = JSON.parse(rawText.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim());
    } catch (e: any) {
      logger.error(`[AI] Failed to parse JSON response from ${provider}:`, e);
      throw new Error(`Invalid JSON format returned by ${provider}`);
    }
  }

  return {
    text: rawText,
    output,
    message: { content: [{ text: rawText }] }
  };
}

export const ai = new Proxy(baseAi, {
  get(target, prop, receiver) {
    if (prop === 'generate') {
      return async (options: any) => {
        let lastError: any = null;
        const requestedModel = options.model || 'glm';

        logger.info(`[AI] Requested model/provider: ${requestedModel}`);

        // We will build a prioritized chain of actions to try:
        const chain: Array<{ name: string; run: () => Promise<any> }> = [];

        // 0. Prioritize GLM if GLM_API_KEY is configured
        if (process.env.GLM_API_KEY) {
          chain.push({
            name: `GLM (Zhipu AI / glm-4-flash)`,
            run: () => tryThirdPartyProvider('glm', options.prompt, options.output?.schema),
          });
        }

        // 1. If it's a third-party provider, put it next in the chain
        if (THIRD_PARTY_PROVIDERS.includes(requestedModel)) {
          chain.push({
            name: `Third-Party: ${requestedModel}`,
            run: () => tryThirdPartyProvider(requestedModel, options.prompt, options.output?.schema),
          });
        } 
        // 2. Else if it's a known Gemini model, put it first in the chain
        else if (requestedModel.startsWith('googleai/')) {
          chain.push({
            name: `Gemini: ${requestedModel}`,
            run: () => target.generate({ ...options, model: requestedModel }),
          });
        }
        // If it's some other custom string, try it as a Gemini model first
        else {
          chain.push({
            name: `Custom Gemini: ${requestedModel}`,
            run: () => target.generate({ ...options, model: requestedModel }),
          });
        }

        // 3. Add Gemini fallback models
        const remainingGemini = FALLBACK_MODELS.filter(m => m !== requestedModel);
        for (const model of remainingGemini) {
          chain.push({
            name: `Gemini Fallback: ${model}`,
            run: () => target.generate({ ...options, model }),
          });
        }

        // 4. Add remaining third-party providers
        const remainingProviders = THIRD_PARTY_PROVIDERS.filter(p => p !== requestedModel);
        for (const provider of remainingProviders) {
          const keys: Record<string, string | undefined> = {
            groq: process.env.GROQ_API_KEY,
            xai: process.env.XAI_API_KEY,
            openai: process.env.OPENAI_API_KEY,
            nvidia: process.env.NVIDIA_API_KEY
          };
          if (keys[provider]) {
            chain.push({
              name: `Third-Party Fallback: ${provider}`,
              run: () => tryThirdPartyProvider(provider, options.prompt, options.output?.schema),
            });
          }
        }

        // Execute the chain in order
        for (const step of chain) {
          try {
            logger.info(`[AI] Attempting ${step.name}`);
            const res = await step.run();
            logger.info(`[AI] Success with ${step.name}`);
            return res;
          } catch (err: any) {
            logger.error(`[AI] ${step.name} failed:`, err.message || err);
            lastError = err;
          }
        }

        throw lastError || new Error("All fallback models and providers failed.");
      };
    }
    return Reflect.get(target, prop, receiver);
  }
}) as typeof baseAi;


