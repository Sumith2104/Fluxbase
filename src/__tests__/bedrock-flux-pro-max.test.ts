import { describe, it, expect } from 'vitest';
import { resolveFluxModel, FLUX_MODEL_REGISTRY, MODEL_ALIASES, WHITELABEL_MAP } from '@/lib/ai-gateway/config';
import { formatOpenAiToBedrock } from '@/lib/ai-gateway/bedrock-adapter';
import { MODEL_CATALOG } from '@/lib/agent-core/gateway';

describe('Flux Pro Max & AWS Bedrock Integration', () => {
  it('registers flux-pro-max in FLUX_MODEL_REGISTRY with Anthropic Claude Sonnet on Bedrock', () => {
    const spec = FLUX_MODEL_REGISTRY['flux-pro-max'];
    expect(spec).toBeDefined();
    expect(spec.id).toBe('flux-pro-max');
    expect(spec.provider).toBe('bedrock');
    expect(spec.upstreamModel).toContain('anthropic.claude');
    expect(spec.minTier).toBe('max');
    expect(spec.capabilities).toContain('reasoning');
    expect(spec.capabilities).toContain('extended-thinking');
  });

  it('resolves canonical and alias names to flux-pro-max', () => {
    expect(resolveFluxModel('flux-pro-max').id).toBe('flux-pro-max');
    expect(resolveFluxModel('pro-max').id).toBe('flux-pro-max');
    expect(resolveFluxModel('claude-3-7-sonnet').id).toBe('flux-pro-max');
    expect(resolveFluxModel('claude-3.7-sonnet').id).toBe('flux-pro-max');
    expect(resolveFluxModel('claude-3-7').id).toBe('flux-pro-max');
  });

  it('maps upstream Bedrock model IDs in WHITELABEL_MAP', () => {
    expect(WHITELABEL_MAP['us.anthropic.claude-sonnet-4-6']).toBe('flux-pro-max');
    expect(WHITELABEL_MAP['us.anthropic.claude-3-7-sonnet-20250219-v1:0']).toBe('flux-pro-max');
  });

  it('registers flux-pro-max in agent core MODEL_CATALOG', () => {
    const catalogEntry = MODEL_CATALOG['flux-pro-max'];
    expect(catalogEntry).toBeDefined();
    expect(catalogEntry.provider).toBe('bedrock');
    expect(catalogEntry.upstreamModel).toContain('anthropic.claude');
  });

  it('correctly converts OpenAI messages to Bedrock Converse format', () => {
    const openAiMessages = [
      { role: 'system', content: 'You are an advanced AI database architect.' },
      { role: 'user', content: 'Design a schema for a payment gateway.' },
      { role: 'assistant', content: 'Here is the recommended schema.' },
      { role: 'user', content: 'Add idempotency key column.' },
    ];

    const { system, messages } = formatOpenAiToBedrock(openAiMessages);

    // System prompt separated into Bedrock system block
    expect(system).toHaveLength(1);
    expect(system[0].text).toBe('You are an advanced AI database architect.');

    // Remaining conversation alternate user & assistant
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content?.[0].text).toBe('Design a schema for a payment gateway.');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content?.[0].text).toBe('Here is the recommended schema.');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content?.[0].text).toBe('Add idempotency key column.');
  });

  it('correctly handles base64 image conversion for Bedrock multimodal messages', () => {
    const multimodalMessage = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this chart:' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            }
          }
        ]
      }
    ];

    const { messages } = formatOpenAiToBedrock(multimodalMessage);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toHaveLength(2);
    expect(messages[0].content?.[0].text).toBe('Analyze this chart:');
    expect(messages[0].content?.[1].image?.format).toBe('png');
    expect(messages[0].content?.[1].image?.source?.bytes).toBeInstanceOf(Uint8Array);
  });
});
