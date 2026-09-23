import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type SystemContentBlock,
  type ContentBlock,
  type ConversationRole,
} from '@aws-sdk/client-bedrock-runtime';

let cachedClient: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    // Bedrock Anthropic Claude cross-region inference profiles use us-east-1
    const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
    const config: any = { region };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }

    cachedClient = new BedrockRuntimeClient(config);
  }
  return cachedClient;
}

export interface BedrockChatOptions {
  modelId: string;
  messages: any[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  outboundModelName?: string;
  enableThinking?: boolean;
  thinkingBudget?: number;
}

/**
 * Resolves requested model ID to active Bedrock cross-region inference profile
 */
export function resolveBedrockModelId(modelId: string): string {
  const envModel = process.env.AWS_BEDROCK_CLAUDE_MODEL;
  if (envModel) return envModel;
  if (modelId.includes('nova-pro') || modelId === 'amazon.nova-pro-v1:0') {
    return 'amazon.nova-pro-v1:0';
  }
  if (modelId.includes('nova-lite') || modelId === 'amazon.nova-lite-v1:0') {
    return 'amazon.nova-lite-v1:0';
  }
  if (modelId.includes('nova-micro') || modelId === 'amazon.nova-micro-v1:0') {
    return 'amazon.nova-micro-v1:0';
  }
  if (modelId.includes('sonnet-4-5') || modelId.includes('sonnet-4.5')) {
    return 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
  }
  if (!modelId || modelId.includes('3-7-sonnet') || modelId.includes('3.7')) {
    return 'us.anthropic.claude-3-7-sonnet-20250219-v1:0';
  }
  return modelId;
}

/**
 * Transforms standard OpenAI formatted messages to AWS Bedrock Converse API format
 */
export function formatOpenAiToBedrock(messages: any[]): {
  system: SystemContentBlock[];
  messages: BedrockMessage[];
} {
  const system: SystemContentBlock[] = [];
  const rawBedrockMessages: BedrockMessage[] = [];

  for (const m of messages) {
    if (!m) continue;
    const role = (m.role || '').toLowerCase();

    // 1. Extract System Messages
    if (role === 'system') {
      const textContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      if (textContent.trim()) {
        system.push({ text: textContent });
      }
      continue;
    }

    const convRole: ConversationRole = role === 'assistant' ? 'assistant' : 'user';
    const contentBlocks: ContentBlock[] = [];

    // 2. Parse Content (Strings or Multimodal Arrays)
    if (typeof m.content === 'string') {
      if (m.content.length > 0) {
        contentBlocks.push({ text: m.content });
      }
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (!part) continue;
        if (part.type === 'text' && typeof part.text === 'string') {
          contentBlocks.push({ text: part.text });
        } else if (part.type === 'image_url' && part.image_url?.url) {
          const url: string = part.image_url.url;
          if (url.startsWith('data:image/')) {
            const match = url.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
            if (match) {
              const format = match[1].toLowerCase() as any;
              const base64Data = match[2];
              const validFormats = ['png', 'jpeg', 'gif', 'webp'];
              if (validFormats.includes(format)) {
                contentBlocks.push({
                  image: {
                    format,
                    source: {
                      bytes: Buffer.from(base64Data, 'base64'),
                    },
                  },
                });
              }
            }
          }
        }
      }
    }

    // Default empty text block if no content extracted
    if (contentBlocks.length === 0) {
      contentBlocks.push({ text: '...' });
    }

    rawBedrockMessages.push({
      role: convRole,
      content: contentBlocks,
    });
  }

  // Ensure Bedrock requirement: message list cannot be empty and consecutive same roles are merged
  const mergedMessages: BedrockMessage[] = [];
  for (const msg of rawBedrockMessages) {
    const last = mergedMessages[mergedMessages.length - 1];
    if (last && last.role === msg.role) {
      last.content = [...(last.content || []), ...(msg.content || [])];
    } else {
      mergedMessages.push(msg);
    }
  }

  // Bedrock requires conversation to start with 'user'
  if (mergedMessages.length > 0 && mergedMessages[0].role === 'assistant') {
    mergedMessages.unshift({
      role: 'user',
      content: [{ text: 'Hello' }],
    });
  }

  if (mergedMessages.length === 0) {
    mergedMessages.push({
      role: 'user',
      content: [{ text: 'Hello' }],
    });
  }

  return { system, messages: mergedMessages };
}

/**
 * Executes a non-streaming chat completion with AWS Bedrock Converse API
 */
export async function executeBedrockConverse(opts: BedrockChatOptions) {
  const client = getBedrockClient();
  const { system, messages } = formatOpenAiToBedrock(opts.messages);
  const outboundModel = opts.outboundModelName || 'flux-pro-max';

  const inferenceConfig: any = {
    maxTokens: opts.max_tokens || 4096,
  };
  if (typeof opts.temperature === 'number') {
    inferenceConfig.temperature = opts.temperature;
  }
  if (typeof opts.top_p === 'number') {
    inferenceConfig.topP = opts.top_p;
  }

  const targetModelId = resolveBedrockModelId(opts.modelId);
  const isClaudeThinking = Boolean(opts.enableThinking && (targetModelId.includes('3-7') || targetModelId.includes('claude-3.7')));
  const additionalModelRequestFields: Record<string, any> = {};
  if (isClaudeThinking) {
    additionalModelRequestFields.thinking = {
      type: 'enabled',
      budget_tokens: opts.thinkingBudget || 2048,
    };
    // Anthropic requires temperature/top_p to not conflict with thinking
    delete inferenceConfig.temperature;
    delete inferenceConfig.topP;
  }

  const command = new ConverseCommand({
    modelId: targetModelId,
    system: system.length > 0 ? system : undefined,
    messages,
    inferenceConfig,
    additionalModelRequestFields: Object.keys(additionalModelRequestFields).length > 0 ? additionalModelRequestFields : undefined,
  });

  const response = await client.send(command);

  let responseText = '';
  if (response.output?.message?.content) {
    for (const block of response.output.message.content) {
      if (block.text) responseText += block.text;
    }
  }

  const promptTokens = response.usage?.inputTokens || 0;
  const completionTokens = response.usage?.outputTokens || 0;

  return {
    id: `chatcmpl-bedrock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: outboundModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
        },
        finish_reason: response.stopReason === 'end_turn' ? 'stop' : (response.stopReason || 'stop'),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Executes a streaming chat completion with AWS Bedrock Converse API
 * Returning an OpenAI-compatible SSE ReadableStream
 */
export async function executeBedrockConverseStream(opts: BedrockChatOptions): Promise<{
  stream: ReadableStream;
  getUsage: () => { inputTokens: number; outputTokens: number };
}> {
  const client = getBedrockClient();
  const { system, messages } = formatOpenAiToBedrock(opts.messages);
  const outboundModel = opts.outboundModelName || 'flux-pro-max';

  const inferenceConfig: any = {
    maxTokens: opts.max_tokens || 4096,
  };
  if (typeof opts.temperature === 'number') {
    inferenceConfig.temperature = opts.temperature;
  }
  if (typeof opts.top_p === 'number') {
    inferenceConfig.topP = opts.top_p;
  }

  const targetModelId = resolveBedrockModelId(opts.modelId);
  const isClaudeThinking = Boolean(opts.enableThinking && (targetModelId.includes('3-7') || targetModelId.includes('claude-3.7')));
  const additionalModelRequestFields: Record<string, any> = {};
  if (isClaudeThinking) {
    additionalModelRequestFields.thinking = {
      type: 'enabled',
      budget_tokens: opts.thinkingBudget || 2048,
    };
    // Anthropic requires temperature/top_p to not conflict with thinking
    delete inferenceConfig.temperature;
    delete inferenceConfig.topP;
  }

  const command = new ConverseStreamCommand({
    modelId: targetModelId,
    system: system.length > 0 ? system : undefined,
    messages,
    inferenceConfig,
    additionalModelRequestFields: Object.keys(additionalModelRequestFields).length > 0 ? additionalModelRequestFields : undefined,
  });

  const response = await client.send(command);
  const streamId = `chatcmpl-bedrock-${Date.now()}`;
  const encoder = new TextEncoder();

  let inputTokens = 0;
  let outputTokens = 0;

  const readableStream = new ReadableStream({
    async start(controller) {
      if (!response.stream) {
        controller.close();
        return;
      }

      try {
        for await (const event of response.stream) {
          if (event.contentBlockDelta?.delta?.text) {
            const deltaText = event.contentBlockDelta.delta.text;
            const ssePayload = {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: outboundModel,
              choices: [
                {
                  index: 0,
                  delta: { content: deltaText },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
          }

          if (event.metadata?.usage) {
            inputTokens = event.metadata.usage.inputTokens || 0;
            outputTokens = event.metadata.usage.outputTokens || 0;
          }

          if (event.messageStop?.stopReason) {
            const finishReason = event.messageStop.stopReason === 'end_turn' ? 'stop' : event.messageStop.stopReason;
            const finalChunk = {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: outboundModel,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: finishReason,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (streamErr) {
        controller.error(streamErr);
      }
    },
  });

  return {
    stream: readableStream,
    getUsage: () => ({ inputTokens, outputTokens }),
  };
}
