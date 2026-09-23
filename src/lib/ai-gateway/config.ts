/**
 * Flux AI Multimodal Gateway - Configuration & Model Registry
 *
 * Single source of truth for all modalities:
 * - Text / Chat Completions
 * - Image Generation
 * - Speech-to-Text (Transcriptions)
 * - Text-to-Speech (Audio Speech)
 * - Video Generation
 * - Text Embeddings
 */

export type Modality = 'text' | 'image' | 'audio-stt' | 'audio-tts' | 'video' | 'embedding';
export type Provider = 'glm' | 'groq' | 'gemini' | 'openai' | 'bedrock';
export type PlanTier = 'free' | 'pro' | 'max' | 'employee' | 'org_owner' | 'pay_as_you_go';

export interface FluxModelSpec {
  id: string;
  modality: Modality;
  provider: Provider;
  upstreamModel: string;
  upstreamEndpoint: string;
  label: string;
  description: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportedFormats?: string[];
  supportedVoices?: string[];
  minTier: PlanTier;
  capabilities: string[];
}

export interface ProviderConfig {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  isAvailable: boolean;
}

export const PROVIDER_ENDPOINTS = {
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chat: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    images: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
    videos: 'https://open.bigmodel.cn/api/paas/v4/videos/generations',
    embeddings: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
    asyncResult: 'https://open.bigmodel.cn/api/paas/v4/async-result',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    chat: 'https://api.groq.com/openai/v1/chat/completions',
    transcriptions: 'https://api.groq.com/openai/v1/audio/transcriptions',
    translations: 'https://api.groq.com/openai/v1/audio/translations',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    openaiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    embeddings: 'https://generativelanguage.googleapis.com/v1beta/openai/embeddings',
    images: 'https://generativelanguage.googleapis.com/v1beta/images:generate',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    chat: 'https://api.openai.com/v1/chat/completions',
    images: 'https://api.openai.com/v1/images/generations',
    speech: 'https://api.openai.com/v1/audio/speech',
    transcriptions: 'https://api.openai.com/v1/audio/transcriptions',
    embeddings: 'https://api.openai.com/v1/embeddings',
  },
  bedrock: {
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    chat: 'bedrock://converse',
  }
} as const;

/**
 * Full Catalog of all official Flux Models across all 6 Modalities
 */
export const FLUX_MODEL_REGISTRY: Record<string, FluxModelSpec> = {
  // --- TEXT / CHAT COMPLETIONS ---
  'flux': {
    id: 'flux',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux',
    description: 'High-accuracy general reasoning, SQL synthesis, and conversational code intelligence',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-flash': {
    id: 'flux-flash',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux Flash',
    description: 'Ultra-fast token throughput. Ideal for autocompletion, real-time UX, and lightweight tasks',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-5.2': {
    id: 'flux-5.2',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4-plus',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux 5.2',
    description: 'Next-generation reasoning architecture specialized in multi-step agentic execution',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-fast': {
    id: 'flux-fast',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux Fast',
    description: 'Ultra-fast general reasoning and SQL generation',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-pro': {
    id: 'flux-pro',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4-air',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux Pro',
    description: 'High-precision schema architecture and BI analysis',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-ultra': {
    id: 'flux-ultra',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4-plus',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux Ultra',
    description: 'Maximum intelligence for deep reasoning and complex migrations',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-turbo': {
    id: 'flux-turbo',
    modality: 'text',
    provider: 'groq',
    upstreamModel: 'llama-3.3-70b-versatile',
    upstreamEndpoint: PROVIDER_ENDPOINTS.groq.chat,
    label: 'Flux Turbo',
    description: 'Hyper-speed 300+ tokens/second inference powered by LLaMA 3.3',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    minTier: 'free',
    capabilities: ['text-generation', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-vision': {
    id: 'flux-vision',
    modality: 'text',
    provider: 'glm',
    upstreamModel: 'glm-4v-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.chat,
    label: 'Flux Vision',
    description: 'High-speed multimodal vision and visual schema recognition',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    minTier: 'free',
    capabilities: ['text-generation', 'vision', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-omni': {
    id: 'flux-omni',
    modality: 'text',
    provider: 'gemini',
    upstreamModel: 'gemini-2.0-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.gemini.chat,
    label: 'Flux Omni',
    description: 'Multimodal vision, document comprehension, and fast reasoning',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    minTier: 'free',
    capabilities: ['text-generation', 'vision', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-max': {
    id: 'flux-max',
    modality: 'text',
    provider: 'openai',
    upstreamModel: 'gpt-4o-mini',
    upstreamEndpoint: PROVIDER_ENDPOINTS.openai.chat,
    label: 'Flux Max',
    description: 'Flagship compatibility and robust coding benchmarks',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    minTier: 'free',
    capabilities: ['text-generation', 'vision', 'chat', 'tool-calling', 'json-mode'],
  },
  'flux-pro-max': {
    id: 'flux-pro-max',
    modality: 'text',
    provider: 'bedrock',
    upstreamModel: process.env.AWS_BEDROCK_CLAUDE_MODEL || 'us.anthropic.claude-sonnet-4-6',
    upstreamEndpoint: 'bedrock://converse',
    label: 'Flux Pro Max',
    description: 'Frontier hybrid reasoning architecture powered by Anthropic Claude Sonnet on AWS Bedrock',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    minTier: 'max',
    capabilities: ['text-generation', 'chat', 'reasoning', 'extended-thinking', 'tool-calling', 'json-mode', 'vision'],
  },
  'flux-sonnet': {
    id: 'flux-sonnet',
    modality: 'text',
    provider: 'bedrock',
    upstreamModel: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    upstreamEndpoint: 'bedrock://converse',
    label: 'Flux Sonnet 4.5',
    description: 'Frontier reasoning, architectural database design, and coding powered by Anthropic Claude Sonnet 4.5 on AWS Bedrock',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    minTier: 'pro',
    capabilities: ['text-generation', 'chat', 'reasoning', 'extended-thinking', 'tool-calling', 'json-mode', 'vision'],
  },

  // --- IMAGE GENERATION ---
  'flux-image': {
    id: 'flux-image',
    modality: 'image',
    provider: 'glm',
    upstreamModel: 'cogview-4',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.images,
    label: 'Flux Image',
    description: 'High-quality photorealistic text-to-image synthesis',
    minTier: 'free',
    capabilities: ['text-to-image', 'high-resolution'],
    supportedFormats: ['url', 'b64_json'],
  },
  'flux-image-fast': {
    id: 'flux-image-fast',
    modality: 'image',
    provider: 'glm',
    upstreamModel: 'cogview-3-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.images,
    label: 'Flux Image Fast',
    description: 'Ultra-fast low-latency image generation for web assets',
    minTier: 'free',
    capabilities: ['text-to-image', 'fast'],
    supportedFormats: ['url', 'b64_json'],
  },
  'flux-image-hd': {
    id: 'flux-image-hd',
    modality: 'image',
    provider: 'gemini',
    upstreamModel: 'imagen-3.0-generate-002',
    upstreamEndpoint: PROVIDER_ENDPOINTS.gemini.images,
    label: 'Flux Image HD',
    description: 'High-definition 4K image generation powered by Google Imagen 3',
    minTier: 'free',
    capabilities: ['text-to-image', 'photorealistic', 'typography'],
    supportedFormats: ['url', 'b64_json'],
  },
  'flux-image-pro': {
    id: 'flux-image-pro',
    modality: 'image',
    provider: 'openai',
    upstreamModel: 'dall-e-3',
    upstreamEndpoint: PROVIDER_ENDPOINTS.openai.images,
    label: 'Flux Image Pro',
    description: 'Premium creative composition with prompt adherence',
    minTier: 'pro',
    capabilities: ['text-to-image', 'hd'],
    supportedFormats: ['url', 'b64_json'],
  },
  'flux-image-ultra': {
    id: 'flux-image-ultra',
    modality: 'image',
    provider: 'bedrock',
    upstreamModel: 'stability.stable-image-ultra-v1:1',
    upstreamEndpoint: 'bedrock://invoke-model',
    label: 'Flux Image Ultra',
    description: 'State-of-the-art photorealistic image generation powered by Stability AI Stable Image Ultra on AWS Bedrock',
    minTier: 'pro',
    capabilities: ['text-to-image', 'photorealistic', 'typography', 'high-resolution'],
    supportedFormats: ['url', 'b64_json'],
  },

  // --- AUDIO: SPEECH-TO-TEXT (STT) ---
  'flux-listen': {
    id: 'flux-listen',
    modality: 'audio-stt',
    provider: 'groq',
    upstreamModel: 'whisper-large-v3-turbo',
    upstreamEndpoint: PROVIDER_ENDPOINTS.groq.transcriptions,
    label: 'Flux Listen',
    description: 'Ultra-fast multi-lingual audio transcription and timestamps',
    minTier: 'free',
    capabilities: ['audio-transcription', 'timestamps', 'multilingual'],
    supportedFormats: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4'],
  },
  'flux-listen-pro': {
    id: 'flux-listen-pro',
    modality: 'audio-stt',
    provider: 'groq',
    upstreamModel: 'whisper-large-v3',
    upstreamEndpoint: PROVIDER_ENDPOINTS.groq.transcriptions,
    label: 'Flux Listen Pro',
    description: 'Maximum precision transcription for noisy and technical audio',
    minTier: 'free',
    capabilities: ['audio-transcription', 'timestamps', 'multilingual'],
    supportedFormats: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4'],
  },
  'flux-listen-en': {
    id: 'flux-listen-en',
    modality: 'audio-stt',
    provider: 'groq',
    upstreamModel: 'distil-whisper-large-v3-en',
    upstreamEndpoint: PROVIDER_ENDPOINTS.groq.transcriptions,
    label: 'Flux Listen English',
    description: 'Lightweight, hyper-fast English-only speech recognition',
    minTier: 'free',
    capabilities: ['audio-transcription', 'english'],
    supportedFormats: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4'],
  },

  // --- AUDIO: TEXT-TO-SPEECH (TTS) ---
  'flux-speak': {
    id: 'flux-speak',
    modality: 'audio-tts',
    provider: 'openai',
    upstreamModel: 'tts-1',
    upstreamEndpoint: PROVIDER_ENDPOINTS.openai.speech,
    label: 'Flux Speak',
    description: 'Natural, expressive text-to-speech voice synthesis',
    minTier: 'free',
    capabilities: ['text-to-speech', 'streaming-audio'],
    supportedFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
    supportedVoices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },
  'flux-speak-hd': {
    id: 'flux-speak-hd',
    modality: 'audio-tts',
    provider: 'openai',
    upstreamModel: 'tts-1-hd',
    upstreamEndpoint: PROVIDER_ENDPOINTS.openai.speech,
    label: 'Flux Speak HD',
    description: 'Studio-grade high-definition audio synthesis',
    minTier: 'pro',
    capabilities: ['text-to-speech', 'studio-quality'],
    supportedFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
    supportedVoices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },

  // --- VIDEO GENERATION ---
  'flux-video': {
    id: 'flux-video',
    modality: 'video',
    provider: 'glm',
    upstreamModel: 'cogvideox-flash',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.videos,
    label: 'Flux Video',
    description: 'Text-to-video generation with dynamic motion and lighting',
    minTier: 'pro', // Free tier users blocked with upgrade notice
    capabilities: ['text-to-video', 'image-to-video', 'async-polling'],
    supportedFormats: ['mp4'],
  },
  'flux-video-pro': {
    id: 'flux-video-pro',
    modality: 'video',
    provider: 'glm',
    upstreamModel: 'cogvideox',
    upstreamEndpoint: PROVIDER_ENDPOINTS.glm.videos,
    label: 'Flux Video Pro',
    description: 'Cinematic 1080p video generation with high fidelity',
    minTier: 'max',
    capabilities: ['text-to-video', 'image-to-video', 'hd', 'async-polling'],
    supportedFormats: ['mp4'],
  },
  'flux-video-ray': {
    id: 'flux-video-ray',
    modality: 'video',
    provider: 'bedrock',
    upstreamModel: 'luma.ray-v2:0',
    upstreamEndpoint: 'bedrock://start-async-invoke',
    label: 'Flux Video Ray',
    description: 'Cinema-grade dynamic video generation with realistic physics and camera motion powered by Luma AI Ray v2 on AWS Bedrock',
    minTier: 'pro',
    capabilities: ['text-to-video', 'cinematic', 'async-polling'],
    supportedFormats: ['mp4'],
  },

  // --- TEXT EMBEDDINGS ---
  'flux-embed': {
    id: 'flux-embed',
    modality: 'embedding',
    provider: 'gemini',
    upstreamModel: 'text-embedding-004',
    upstreamEndpoint: PROVIDER_ENDPOINTS.gemini.embeddings,
    label: 'Flux Embed',
    description: 'High-performance 768-dimensional text embeddings for RAG & search',
    contextWindow: 2048,
    minTier: 'free',
    capabilities: ['embeddings', 'similarity-search'],
  },
};

/**
 * Model Aliases mapping third-party and shorthand model names to Flux Models
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Default Shorthands
  'flux': 'flux',
  'flux-flash': 'flux-flash',
  'flux-5.2': 'flux-5.2',
  'flux-fast': 'flux',
  'flux-image': 'flux-image',
  'flux-video': 'flux-video',
  'flux-listen': 'flux-listen',
  'flux-speak': 'flux-speak',
  'flux-embed': 'flux-embed',

  // OpenAI Chat Aliases
  'gpt-4o': 'flux-ultra',
  'gpt-4o-mini': 'flux-max',
  'gpt-4-turbo': 'flux-ultra',
  'gpt-4': 'flux-ultra',
  'gpt-3.5-turbo': 'flux-fast',
  // Claude & Flagship Aliases
  'flux-pro-max': 'flux-pro-max',
  'pro-max': 'flux-pro-max',
  'flux-sonnet': 'flux-sonnet',
  'flux-sonnet-4-5': 'flux-sonnet',
  'claude-sonnet-4-5': 'flux-sonnet',
  'claude-sonnet-4.5': 'flux-sonnet',
  'claude-4-5': 'flux-sonnet',
  'claude-3-7-sonnet': 'flux-pro-max',
  'claude-3.7-sonnet': 'flux-pro-max',
  'claude-3-7': 'flux-pro-max',
  'claude-3.7': 'flux-pro-max',
  'claude-3-5-sonnet': 'flux-pro-max',
  'claude-3-haiku': 'flux-fast',

  // OpenAI Image Aliases
  'flux-image-ultra': 'flux-image-ultra',
  'stable-image-ultra': 'flux-image-ultra',
  'stable-diffusion-ultra': 'flux-image-ultra',
  'dall-e-3': 'flux-image',
  'dall-e-2': 'flux-image-fast',
  'dall-e': 'flux-image',

  // OpenAI Audio Aliases
  'whisper-1': 'flux-listen',
  'whisper': 'flux-listen',
  'tts-1': 'flux-speak',
  'tts-1-hd': 'flux-speak-hd',

  // Embedding Aliases
  'text-embedding-3-small': 'flux-embed',
  'text-embedding-3-large': 'flux-embed',
  'text-embedding-ada-002': 'flux-embed',

  // Upstream direct IDs
  'glm-4-flash': 'flux-fast',
  'glm-4-air': 'flux-pro',
  'glm-4-plus': 'flux-ultra',
  'glm-4v-flash': 'flux-vision',
  'glm-4v': 'flux-vision',
  'flux-vision': 'flux-vision',
  'llama-3.3-70b-versatile': 'flux-turbo',
  'gemini-2.0-flash': 'flux-omni',
  'cogview-4': 'flux-image',
  'cogview-3-flash': 'flux-image-fast',
  'cogvideox-flash': 'flux-video',
  'cogvideox': 'flux-video-pro',
  'flux-video-ray': 'flux-video-ray',
  'luma-ray-v2': 'flux-video-ray',
  'ray-v2': 'flux-video-ray',
};

/**
 * Whitelist reverse mapping: converts upstream provider names back to Flux names
 */
export const WHITELABEL_MAP: Record<string, string> = {
  'glm-4-flash': 'flux',
  'glm-4-air': 'flux-pro',
  'glm-4-plus': 'flux-ultra',
  'glm-4v-flash': 'flux-vision',
  'glm-4v': 'flux-vision',
  'llama-3.3-70b-versatile': 'flux-turbo',
  'gemini-2.0-flash': 'flux-omni',
  'gemini-1.5-flash': 'flux-omni',
  'gpt-4o-mini': 'flux-max',
  'gpt-4o': 'flux-max',
  'us.anthropic.claude-sonnet-4-6': 'flux-pro-max',
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': 'flux-pro-max',
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0': 'flux-pro-max',
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'flux-pro-max',
  'cogview-4': 'flux-image',
  'cogview-3-flash': 'flux-image-fast',
  'imagen-3.0-generate-002': 'flux-image-hd',
  'dall-e-3': 'flux-image-pro',
  'whisper-large-v3-turbo': 'flux-listen',
  'whisper-large-v3': 'flux-listen-pro',
  'distil-whisper-large-v3-en': 'flux-listen-en',
  'tts-1': 'flux-speak',
  'tts-1-hd': 'flux-speak-hd',
  'cogvideox-flash': 'flux-video',
  'cogvideox': 'flux-video-pro',
  'luma.ray-v2:0': 'flux-video-ray',
  'stability.stable-image-ultra-v1:1': 'flux-image-ultra',
  'text-embedding-004': 'flux-embed',
};

/**
 * Resolves any requested model name (canonical or alias) to a FluxModelSpec
 */
export function resolveFluxModel(modelName?: string, requiredModality?: Modality): FluxModelSpec {
  const normalized = (modelName || '').trim().toLowerCase();

  // 1. Direct registry hit
  if (normalized && FLUX_MODEL_REGISTRY[normalized]) {
    const spec = FLUX_MODEL_REGISTRY[normalized];
    if (!requiredModality || spec.modality === requiredModality) {
      return spec;
    }
  }

  // 2. Alias mapping hit
  if (normalized && MODEL_ALIASES[normalized]) {
    const resolvedId = MODEL_ALIASES[normalized];
    if (FLUX_MODEL_REGISTRY[resolvedId]) {
      return FLUX_MODEL_REGISTRY[resolvedId];
    }
  }

  // 3. Fallback defaults by modality
  if (requiredModality === 'image') return FLUX_MODEL_REGISTRY['flux-image'];
  if (requiredModality === 'audio-stt') return FLUX_MODEL_REGISTRY['flux-listen'];
  if (requiredModality === 'audio-tts') return FLUX_MODEL_REGISTRY['flux-speak'];
  if (requiredModality === 'video') return FLUX_MODEL_REGISTRY['flux-video'];
  if (requiredModality === 'embedding') return FLUX_MODEL_REGISTRY['flux-embed'];

  // Default to text flux
  return FLUX_MODEL_REGISTRY['flux'] || FLUX_MODEL_REGISTRY['flux-fast'];
}

/**
 * Retrieves the API key and active status for a given provider
 */
export function getProviderConfig(provider: Provider): ProviderConfig {
  let apiKey = '';
  let baseUrl = '';

  switch (provider) {
    case 'glm':
      apiKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || '';
      baseUrl = PROVIDER_ENDPOINTS.glm.baseUrl;
      break;
    case 'groq':
      apiKey = process.env.GROQ_API_KEY || '';
      baseUrl = PROVIDER_ENDPOINTS.groq.baseUrl;
      break;
    case 'gemini':
      apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
      baseUrl = PROVIDER_ENDPOINTS.gemini.baseUrl;
      break;
    case 'openai':
      apiKey = process.env.OPENAI_API_KEY || '';
      baseUrl = PROVIDER_ENDPOINTS.openai.baseUrl;
      break;
    case 'bedrock':
      apiKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || (process.env.AWS_REGION ? 'aws-iam' : '');
      baseUrl = `https://bedrock-runtime.${process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;
      break;
  }

  return {
    provider,
    apiKey,
    baseUrl,
    isAvailable: Boolean(apiKey && apiKey.trim().length > 0),
  };
}

/**
 * Builds a fallback chain of alternative models if primary fails
 */
export function buildFallbackChain(primarySpec: FluxModelSpec, hasMultimodal = false): FluxModelSpec[] {
  const chain: FluxModelSpec[] = [];

  if (hasMultimodal) {
    // When multimodal images are present, prioritize vision-capable models with available keys
    if (primarySpec.capabilities?.includes('vision')) {
      const config = getProviderConfig(primarySpec.provider);
      if (config.isAvailable) chain.push(primarySpec);
    }
    const visionPriority = ['flux-pro-max', 'flux-vision', 'flux-omni', 'flux-max'];
    for (const vId of visionPriority) {
      const spec = FLUX_MODEL_REGISTRY[vId];
      if (spec && !chain.some(s => s.id === spec.id)) {
        const config = getProviderConfig(spec.provider);
        if (config.isAvailable) chain.push(spec);
      }
    }
    if (!chain.some(s => s.id === primarySpec.id)) {
      const config = getProviderConfig(primarySpec.provider);
      if (config.isAvailable) chain.push(primarySpec);
    }
  } else {
    chain.push(primarySpec);
  }

  if (primarySpec.modality === 'text') {
    const fallbacks = hasMultimodal
      ? ['flux-sonnet', 'flux-pro-max', 'flux-vision', 'flux-omni', 'flux-max']
      : ['flux-sonnet', 'flux-pro-max', 'flux-ultra', 'flux-turbo', 'flux-omni', 'flux-fast', 'flux-max'];
    for (const fbId of fallbacks) {
      const fbSpec = FLUX_MODEL_REGISTRY[fbId];
      if (fbSpec && fbSpec.id !== primarySpec.id && !chain.some(s => s.id === fbSpec.id)) {
        const config = getProviderConfig(fbSpec.provider);
        if (config.isAvailable) chain.push(fbSpec);
      }
    }
  } else if (primarySpec.modality === 'image') {
    const fallbacks = ['flux-image-ultra', 'flux-image-fast', 'flux-image-hd', 'flux-image-pro'];
    for (const fbId of fallbacks) {
      const fbSpec = FLUX_MODEL_REGISTRY[fbId];
      if (fbSpec && fbSpec.id !== primarySpec.id && !chain.some(s => s.id === fbSpec.id)) {
        const config = getProviderConfig(fbSpec.provider);
        if (config.isAvailable) chain.push(fbSpec);
      }
    }
  } else if (primarySpec.modality === 'video') {
    const fallbacks = ['flux-video-ray', 'flux-video-pro', 'flux-video'];
    for (const fbId of fallbacks) {
      const fbSpec = FLUX_MODEL_REGISTRY[fbId];
      if (fbSpec && fbSpec.id !== primarySpec.id && !chain.some(s => s.id === fbSpec.id)) {
        const config = getProviderConfig(fbSpec.provider);
        if (config.isAvailable) chain.push(fbSpec);
      }
    }
  } else if (primarySpec.modality === 'audio-stt') {
    const fallbacks = ['flux-listen-pro', 'flux-listen'];
    for (const fbId of fallbacks) {
      const fbSpec = FLUX_MODEL_REGISTRY[fbId];
      if (fbSpec && fbSpec.id !== primarySpec.id && !chain.some(s => s.id === fbSpec.id)) {
        const config = getProviderConfig(fbSpec.provider);
        if (config.isAvailable) chain.push(fbSpec);
      }
    }
  } else if (primarySpec.modality === 'audio-tts') {
    const fallbacks = ['flux-speak-hd', 'flux-speak'];
    for (const fbId of fallbacks) {
      const fbSpec = FLUX_MODEL_REGISTRY[fbId];
      if (fbSpec && fbSpec.id !== primarySpec.id && !chain.some(s => s.id === fbSpec.id)) {
        const config = getProviderConfig(fbSpec.provider);
        if (config.isAvailable) chain.push(fbSpec);
      }
    }
  }

  return chain;
}
