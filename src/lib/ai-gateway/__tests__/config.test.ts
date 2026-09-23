import { describe, it, expect } from 'vitest';
import {
  resolveFluxModel,
  buildFallbackChain,
  FLUX_MODEL_REGISTRY,
  MODEL_ALIASES,
} from '../config';

describe('Flux AI Gateway - Model Registry & Resolution', () => {
  it('should resolve default flux model when called with empty input', () => {
    const model = resolveFluxModel('');
    expect(model.id).toBe('flux');
    expect(model.modality).toBe('text');
    expect(model.provider).toBe('glm');
  });

  it('should resolve official Flux models across all modalities', () => {
    const textModel = resolveFluxModel('flux-ultra', 'text');
    expect(textModel.id).toBe('flux-ultra');
    expect(textModel.modality).toBe('text');

    const imgModel = resolveFluxModel('flux-image', 'image');
    expect(imgModel.id).toBe('flux-image');
    expect(imgModel.modality).toBe('image');

    const sttModel = resolveFluxModel('flux-listen', 'audio-stt');
    expect(sttModel.id).toBe('flux-listen');
    expect(sttModel.modality).toBe('audio-stt');

    const ttsModel = resolveFluxModel('flux-speak', 'audio-tts');
    expect(ttsModel.id).toBe('flux-speak');
    expect(ttsModel.modality).toBe('audio-tts');

    const videoModel = resolveFluxModel('flux-video', 'video');
    expect(videoModel.id).toBe('flux-video');
    expect(videoModel.modality).toBe('video');

    const embedModel = resolveFluxModel('flux-embed', 'embedding');
    expect(embedModel.id).toBe('flux-embed');
    expect(embedModel.modality).toBe('embedding');
  });

  it('should resolve OpenAI compatibility aliases properly', () => {
    expect(resolveFluxModel('gpt-4o').id).toBe('flux-ultra');
    expect(resolveFluxModel('gpt-4o-mini').id).toBe('flux-max');
    expect(resolveFluxModel('gpt-3.5-turbo').id).toBe('flux-fast');
    expect(resolveFluxModel('dall-e-3', 'image').id).toBe('flux-image');
    expect(resolveFluxModel('whisper-1', 'audio-stt').id).toBe('flux-listen');
    expect(resolveFluxModel('tts-1', 'audio-tts').id).toBe('flux-speak');
    expect(resolveFluxModel('text-embedding-3-small', 'embedding').id).toBe('flux-embed');
  });

  it('should resolve frontier AWS Bedrock models (flux-sonnet, flux-image-ultra, flux-video-ray)', () => {
    // 1. Frontier Reasoning
    const sonnet = resolveFluxModel('flux-sonnet', 'text');
    expect(sonnet.id).toBe('flux-sonnet');
    expect(sonnet.provider).toBe('bedrock');
    expect(resolveFluxModel('claude-sonnet-4-5', 'text').id).toBe('flux-sonnet');

    // 2. State-of-the-Art Image
    const imgUltra = resolveFluxModel('flux-image-ultra', 'image');
    expect(imgUltra.id).toBe('flux-image-ultra');
    expect(imgUltra.provider).toBe('bedrock');
    expect(resolveFluxModel('stable-image-ultra', 'image').id).toBe('flux-image-ultra');

    // 3. Cinema-Grade Video
    const vidRay = resolveFluxModel('flux-video-ray', 'video');
    expect(vidRay.id).toBe('flux-video-ray');
    expect(vidRay.provider).toBe('bedrock');
    expect(resolveFluxModel('luma-ray-v2', 'video').id).toBe('flux-video-ray');
  });

  it('should build a fallback chain containing the primary model first', () => {
    const primary = FLUX_MODEL_REGISTRY['flux-fast'];
    const chain = buildFallbackChain(primary);
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[0].id).toBe('flux-fast');
  });
});
