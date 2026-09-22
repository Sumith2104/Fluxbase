import logger from '@/lib/logger';
import { executeBedrockConverse, executeBedrockConverseStream } from '@/lib/ai-gateway/bedrock-adapter';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | Record<string, any>;

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
  images?: string[];
}

export interface ModelGatewayOptions {
  model?: string;
  messages: ModelMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type: 'json_object' | 'text' };
  tools?: any[];
  tool_choice?: any;
}

export interface ModelGatewayResult {
  text: string;
  thought?: string;
  output?: any;
  tool_calls?: any[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  provider: string;
  model: string;
}

// Model alias mapper
export const MODEL_CATALOG: Record<string, { provider: 'glm' | 'groq' | 'gemini' | 'openai' | 'bedrock'; upstreamModel: string; label: string; description: string }> = {
  // Flux Pro Max Tier (Flagship Frontier Reasoning on AWS Bedrock)
  'flux-pro-max': { provider: 'bedrock', upstreamModel: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', label: 'Flux Pro Max', description: 'Frontier hybrid reasoning powered by Anthropic Claude 3.7 Sonnet on AWS Bedrock' },
  'pro-max': { provider: 'bedrock', upstreamModel: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', label: 'Flux Pro Max', description: 'Frontier hybrid reasoning powered by Anthropic Claude 3.7 Sonnet on AWS Bedrock' },
  'claude-3-7-sonnet': { provider: 'bedrock', upstreamModel: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', label: 'Flux Pro Max', description: 'Frontier hybrid reasoning powered by Anthropic Claude 3.7 Sonnet on AWS Bedrock' },
  'claude-3.7-sonnet': { provider: 'bedrock', upstreamModel: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', label: 'Flux Pro Max', description: 'Frontier hybrid reasoning powered by Anthropic Claude 3.7 Sonnet on AWS Bedrock' },
  'claude-3-7': { provider: 'bedrock', upstreamModel: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', label: 'Flux Pro Max', description: 'Frontier hybrid reasoning powered by Anthropic Claude 3.7 Sonnet on AWS Bedrock' },

  // Flux Fast Tier (Default - Ultra Fast & Cost-Free)
  'flux-fast': { provider: 'glm', upstreamModel: 'glm-4-flash', label: 'Flux Fast', description: 'Ultra-fast general reasoning & SQL' },
  'flux': { provider: 'glm', upstreamModel: 'glm-4-flash', label: 'Flux Fast', description: 'Ultra-fast general reasoning & SQL' },
  'glm': { provider: 'glm', upstreamModel: 'glm-4-flash', label: 'Flux Fast', description: 'Ultra-fast general reasoning & SQL' },
  'glm-4-flash': { provider: 'glm', upstreamModel: 'glm-4-flash', label: 'Flux Fast', description: 'Ultra-fast general reasoning & SQL' },

  // Flux Pro Tier (Balanced deep reasoning)
  'flux-pro': { provider: 'glm', upstreamModel: 'glm-4-air', label: 'Flux Pro', description: 'High precision schema & BI analysis' },
  'glm-4-air': { provider: 'glm', upstreamModel: 'glm-4-air', label: 'Flux Pro', description: 'High precision schema & BI analysis' },

  // Flux Ultra Tier (Deep reasoning & complex migrations)
  'flux-ultra': { provider: 'glm', upstreamModel: 'glm-4-plus', label: 'Flux Ultra', description: 'Maximum intelligence for complex databases' },
  'glm-4-plus': { provider: 'glm', upstreamModel: 'glm-4-plus', label: 'Flux Ultra', description: 'Maximum intelligence for complex databases' },
  'glm-5.2': { provider: 'glm', upstreamModel: 'glm-4-plus', label: 'Flux Ultra', description: 'Maximum intelligence for complex databases' },

  // Flux Turbo Tier (Hyper-speed 300+ tokens/sec)
  'flux-turbo': { provider: 'groq', upstreamModel: 'llama-3.3-70b-versatile', label: 'Flux Turbo', description: 'Hyper-speed 300 tps inference' },
  'groq': { provider: 'groq', upstreamModel: 'llama-3.3-70b-versatile', label: 'Flux Turbo', description: 'Hyper-speed 300 tps inference' },
  'groq-llama': { provider: 'groq', upstreamModel: 'llama-3.3-70b-versatile', label: 'Flux Turbo', description: 'Hyper-speed 300 tps inference' },

  // Flux Omni Tier (Multimodal Agentic AI)
  'flux-omni': { provider: 'gemini', upstreamModel: 'gemini-2.0-flash', label: 'Flux Omni', description: 'Multimodal Agentic AI' },
  'flux-vision': { provider: 'glm', upstreamModel: 'glm-4v-flash', label: 'Flux Vision', description: 'Multimodal Vision' },
  'gemini': { provider: 'gemini', upstreamModel: 'gemini-2.0-flash', label: 'Flux Omni', description: 'Multimodal Agentic AI' },
  'gemini-2.0-flash': { provider: 'gemini', upstreamModel: 'gemini-2.0-flash', label: 'Flux Omni', description: 'Multimodal Agentic AI' },
  'gemini-1.5-flash': { provider: 'gemini', upstreamModel: 'gemini-1.5-flash', label: 'Flux Omni', description: 'Multimodal Agentic AI' },
  'glm-4v-flash': { provider: 'glm', upstreamModel: 'glm-4v-flash', label: 'Flux Vision', description: 'Multimodal Vision' },
  'glm-4v': { provider: 'glm', upstreamModel: 'glm-4v', label: 'Flux Vision', description: 'Multimodal Vision' },

  // Flux Max Tier (Flagship Intelligence)
  'flux-max': { provider: 'openai', upstreamModel: 'gpt-4o-mini', label: 'Flux Max', description: 'Flagship Intelligence' },
  'openai': { provider: 'openai', upstreamModel: 'gpt-4o-mini', label: 'Flux Max', description: 'Flagship Intelligence' },
  'gpt-4o-mini': { provider: 'openai', upstreamModel: 'gpt-4o-mini', label: 'Flux Max', description: 'Flagship Intelligence' },
  'gpt-4o': { provider: 'openai', upstreamModel: 'gpt-4o', label: 'Flux Max', description: 'Flagship Intelligence' }
};

/**
 * Universal Resilient Multi-Provider Model Gateway
 */
export class ModelGateway {
  /**
   * Helper to determine if messages contain multimodal image content
   */
  private static hasMultimodalContent(messages: ModelMessage[]): boolean {
    return messages.some(m => {
      if (Array.isArray(m.content)) {
        return m.content.some((part: any) => part && typeof part === 'object' && (part.type === 'image_url' || part.image_url));
      }
      return Array.isArray(m.images) && m.images.length > 0;
    });
  }

  /**
   * Dispatches a non-streaming chat completion with automatic tiered fallback.
   */
  public static async generate(options: ModelGatewayOptions): Promise<ModelGatewayResult> {
    const requestedKey = (options.model || 'flux-fast').toLowerCase();
    const primarySpec = MODEL_CATALOG[requestedKey] || MODEL_CATALOG['flux-fast'];
    const hasMultimodal = this.hasMultimodalContent(options.messages);

    // Assemble prioritized execution chain
    const chain = this.buildFallbackChain(primarySpec, hasMultimodal);
    let lastError: any = null;

    for (const step of chain) {
      try {
        logger.info(`[ModelGateway] Attempting tier: ${step.provider} (${step.upstreamModel})${hasMultimodal ? ' [multimodal]' : ''}`);
        const result = await this.executeProvider(step.provider, step.upstreamModel, options);
        logger.info(`[ModelGateway] Succeeded with tier: ${step.provider} (${step.upstreamModel})`);
        return result;
      } catch (err: any) {
        logger.warn(`[ModelGateway] Tier ${step.provider} (${step.upstreamModel}) failed: ${err?.message || err}`);
        lastError = err;
      }
    }

    throw lastError || new Error('All model providers in the fallback cascade failed.');
  }

  /**
   * Dispatches a streaming chat completion with automatic tiered fallback.
   * Returns a standard Response with text/event-stream or a ReadableStream.
   */
  public static async stream(options: ModelGatewayOptions): Promise<{ stream: ReadableStream<Uint8Array>; provider: string; model: string }> {
    const requestedKey = (options.model || 'flux-fast').toLowerCase();
    const primarySpec = MODEL_CATALOG[requestedKey] || MODEL_CATALOG['flux-fast'];
    const hasMultimodal = this.hasMultimodalContent(options.messages);

    const chain = this.buildFallbackChain(primarySpec, hasMultimodal);
    let lastError: any = null;

    for (const step of chain) {
      try {
        logger.info(`[ModelGateway] Attempting streaming tier: ${step.provider} (${step.upstreamModel})${hasMultimodal ? ' [multimodal]' : ''}`);
        const stream = await this.executeProviderStream(step.provider, step.upstreamModel, options);
        return { stream, provider: step.provider, model: step.upstreamModel };
      } catch (err: any) {
        logger.warn(`[ModelGateway] Streaming tier ${step.provider} (${step.upstreamModel}) failed: ${err?.message || err}`);
        lastError = err;
      }
    }

    throw lastError || new Error('All streaming providers in the fallback cascade failed.');
  }

  /**
   * Constructs the ordered provider fallback chain based on active environment keys.
   * When hasMultimodal is true, prioritizes vision-capable providers (Gemini and OpenAI).
   */
  private static buildFallbackChain(
    primary: { provider: string; upstreamModel: string },
    hasMultimodal = false
  ): Array<{ provider: string; upstreamModel: string }> {
    const chain: Array<{ provider: string; upstreamModel: string }> = [];
    const seen = new Set<string>();

    const add = (provider: string, upstreamModel: string) => {
      const key = `${provider}:${upstreamModel}`;
      if (!seen.has(key)) {
        seen.add(key);
        chain.push({ provider, upstreamModel });
      }
    };

    if (hasMultimodal) {
      // 1. If primary requested model is already vision-capable and configured, use it first
      const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
      const hasGlmKey = Boolean(process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY);

      if (
        (primary.provider === 'gemini' && hasGeminiKey) ||
        (primary.provider === 'openai' && hasOpenAiKey) ||
        (primary.provider === 'glm' && primary.upstreamModel.includes('4v') && hasGlmKey)
      ) {
        add(primary.provider, primary.upstreamModel);
      }

      // 2. GLM Vision (Active GLM_API_KEY, high-speed, 100% free multimodal vision)
      if (hasGlmKey) {
        add('glm', 'glm-4v-flash');
        add('glm', 'glm-4v');
      }

      // 3. Gemini vision fallback
      if (hasGeminiKey) {
        add('gemini', 'gemini-2.0-flash');
        add('gemini', 'gemini-1.5-flash');
      }

      // 4. OpenAI vision fallback
      if (hasOpenAiKey) {
        add('openai', 'gpt-4o-mini');
        add('openai', 'gpt-4o');
      }

      // 5. Final safety fallback: ensure at least one vision model is present
      if (hasGlmKey) {
        add('glm', 'glm-4v-flash');
      } else if (hasGeminiKey) {
        add('gemini', 'gemini-2.0-flash');
      } else if (hasOpenAiKey) {
        add('openai', 'gpt-4o-mini');
      } else {
        add(primary.provider, primary.upstreamModel);
      }
    } else {
      // 1. Primary requested provider
      add(primary.provider, primary.upstreamModel);

      // 2. GLM flash fallback if primary is not GLM-flash
      if (process.env.GLM_API_KEY) {
        add('glm', 'glm-4-flash');
        add('glm', 'glm-4v-flash');
        add('glm', 'glm-4-air');
        add('glm', 'glm-4-plus');
      }

      // 3. Groq fallback
      if (process.env.GROQ_API_KEY) {
        add('groq', 'llama-3.3-70b-versatile');
      }

      // 4. Gemini fallback
      if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
        add('gemini', 'gemini-2.0-flash');
        add('gemini', 'gemini-1.5-flash');
      }

      // 5. OpenAI fallback
      if (process.env.OPENAI_API_KEY) {
        add('openai', 'gpt-4o-mini');
      }
    }

    return chain;
  }

  /**
   * Dispatches request to the specific provider using OpenAI-compatible payload schema.
   */
  private static async executeProvider(
    provider: string,
    model: string,
    options: ModelGatewayOptions
  ): Promise<ModelGatewayResult> {
    if (provider === 'bedrock') {
      const result = await executeBedrockConverse({
        modelId: model,
        messages: options.messages,
        temperature: options.temperature,
        top_p: options.top_p,
        max_tokens: options.max_tokens,
        outboundModelName: 'flux-pro-max',
        enableThinking: true,
        thinkingBudget: 2048,
      });
      const choice = result.choices?.[0];
      const rawContent = choice?.message?.content || '';
      return {
        text: rawContent,
        output: null,
        tool_calls: [],
        usage: result.usage,
        provider: 'bedrock',
        model,
      };
    }

    const config = this.getProviderEndpointAndKey(provider);
    if (!config.apiKey) {
      throw new Error(`API key for provider '${provider}' is not configured`);
    }

    const payload: Record<string, any> = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      stream: false
    };

    if (options.top_p !== undefined) payload.top_p = options.top_p;
    if (options.max_tokens !== undefined) payload.max_tokens = options.max_tokens;
    if (options.response_format) payload.response_format = options.response_format;
    if (options.tools && options.tools.length > 0) payload.tools = options.tools;
    if (options.tool_choice) payload.tool_choice = options.tool_choice;

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`${provider} returned HTTP ${response.status}: ${errBody}`);
    }

    const json = await response.json();
    const choice = json.choices?.[0];
    const rawContent = choice?.message?.content || '';
    const toolCalls = choice?.message?.tool_calls || [];

    // Parse <think>...</think> if present in the model's raw text
    let thought: string | undefined = undefined;
    let cleanText = rawContent;
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i) || rawContent.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (thinkMatch) {
      thought = thinkMatch[1].trim();
      cleanText = rawContent.replace(thinkMatch[0], '').trim();
    }

    // Parse JSON output if structured response was requested
    let output: any = null;
    if (options.response_format?.type === 'json_object' || cleanText.trim().startsWith('{') || cleanText.trim().startsWith('[')) {
      try {
        const cleaned = cleanText.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        output = JSON.parse(cleaned);
      } catch {
        output = null;
      }
    }

    return {
      text: cleanText,
      thought,
      output,
      tool_calls: toolCalls,
      usage: json.usage,
      provider,
      model
    };
  }

  /**
   * Dispatches a streaming request to upstream provider returning a live ReadableStream.
   */
  private static async executeProviderStream(
    provider: string,
    model: string,
    options: ModelGatewayOptions
  ): Promise<ReadableStream<Uint8Array>> {
    if (provider === 'bedrock') {
      const { stream } = await executeBedrockConverseStream({
        modelId: model,
        messages: options.messages,
        temperature: options.temperature,
        top_p: options.top_p,
        max_tokens: options.max_tokens,
        outboundModelName: 'flux-pro-max',
        enableThinking: true,
        thinkingBudget: 2048,
      });
      return stream as any;
    }

    const config = this.getProviderEndpointAndKey(provider);
    if (!config.apiKey) {
      throw new Error(`API key for provider '${provider}' is not configured`);
    }

    const payload: Record<string, any> = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      stream: true
    };

    if (options.top_p !== undefined) payload.top_p = options.top_p;
    if (options.max_tokens !== undefined) payload.max_tokens = options.max_tokens;
    if (options.tools && options.tools.length > 0) payload.tools = options.tools;
    if (options.tool_choice) payload.tool_choice = options.tool_choice;

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`${provider} streaming returned HTTP ${response.status}: ${errBody}`);
    }

    if (!response.body) {
      throw new Error(`No response body received from ${provider} streaming endpoint`);
    }

    return response.body;
  }

  /**
   * Resolves endpoint URL and API key by provider.
   */
  private static getProviderEndpointAndKey(provider: string): { url: string; apiKey: string } {
    switch (provider) {
      case 'glm':
        return {
          url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
          apiKey: process.env.GLM_API_KEY || ''
        };
      case 'groq':
        return {
          url: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: process.env.GROQ_API_KEY || ''
        };
      case 'gemini':
        // Google Generative Language OpenAI compatibility endpoint
        return {
          url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
        };
      case 'openai':
        return {
          url: 'https://api.openai.com/v1/chat/completions',
          apiKey: process.env.OPENAI_API_KEY || ''
        };
      case 'bedrock':
        return {
          url: `https://bedrock-runtime.${process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
          apiKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || (process.env.AWS_REGION ? 'aws-iam' : '')
        };
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
