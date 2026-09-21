import { describe, it, expect } from 'vitest';
import { ModelGateway, MODEL_CATALOG, ModelMessage } from '../gateway';

describe('ModelGateway - Multimodal Vision Support', () => {
  it('should have vision-capable models in catalog', () => {
    expect(MODEL_CATALOG['flux-omni']).toBeDefined();
    expect(MODEL_CATALOG['flux-omni'].provider).toBe('gemini');
    expect(MODEL_CATALOG['flux-omni'].upstreamModel).toBe('gemini-2.0-flash');

    expect(MODEL_CATALOG['flux-max']).toBeDefined();
    expect(MODEL_CATALOG['flux-max'].provider).toBe('openai');
    expect(MODEL_CATALOG['flux-max'].upstreamModel).toBe('gpt-4o-mini');
  });

  it('detects multimodal image_url content parts', () => {
    const messagesWithImages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this schema' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } }
        ]
      }
    ];

    const hasMulti = (ModelGateway as any).hasMultimodalContent(messagesWithImages);
    expect(hasMulti).toBe(true);

    const textOnlyMessages: ModelMessage[] = [
      { role: 'user', content: 'SELECT * FROM users;' }
    ];
    const hasTextOnlyMulti = (ModelGateway as any).hasMultimodalContent(textOnlyMessages);
    expect(hasTextOnlyMulti).toBe(false);
  });

  it('detects multimodal images array on message object', () => {
    const messagesWithArray: ModelMessage[] = [
      {
        role: 'user',
        content: 'Check this diagram',
        images: ['data:image/jpeg;base64,/9j/4AAQSkZJRg...']
      }
    ];

    const hasMulti = (ModelGateway as any).hasMultimodalContent(messagesWithArray);
    expect(hasMulti).toBe(true);
  });

  it('builds fallback chain prioritizing vision providers when multimodal content is detected', () => {
    const primary = { provider: 'glm', upstreamModel: 'glm-4-flash' };
    const visionChain = (ModelGateway as any).buildFallbackChain(primary, true);

    expect(visionChain.length).toBeGreaterThan(0);
    // When multimodal, vision providers (gemini / openai) are prioritized before text-only primary
    const providers = visionChain.map((s: any) => s.provider);
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      expect(providers[0]).toBe('gemini');
    }
  });
});
