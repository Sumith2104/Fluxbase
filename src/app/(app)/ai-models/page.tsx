'use client';

import React, { useState, useEffect, useContext, useMemo } from 'react';
import { ProjectContext } from '@/contexts/project-context';
import { 
    Sparkles, Key, Copy, Check, Search, Shield, Zap, 
    Bot, Cpu, Image as ImageIcon, Video, Mic, Volume2, 
    Database, ExternalLink, RefreshCw, Plus, Trash2, 
    Code2, Play, Terminal, ArrowUpRight, CheckCircle2,
    Layers, AlertCircle, Info, Sliders, ChevronDown
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from '@/hooks/use-toast';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getApiKeysAction, createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/settings/api-key-actions";
import { getUserPlanAction } from '@/app/(app)/settings/actions';
import { type ApiKey } from "@/lib/api-keys";
import Link from 'next/link';

export type ModalityType = 'text' | 'image' | 'video' | 'audio-stt' | 'audio-tts' | 'embedding';

export interface ModelCardData {
    id: string;
    realName: string;
    provider: 'AWS Bedrock' | 'OpenAI' | 'Google Gemini' | 'Groq / Meta' | 'Zhipu AI';
    modality: ModalityType;
    label: string;
    description: string;
    contextWindow: string;
    maxOutput: string;
    speedRating: string;
    minTier: 'free' | 'pro' | 'max' | 'pay_as_you_go';
    capabilities: string[];
    aliases?: string[];
    isDropinAlias?: boolean;
    samplePrompt?: string;
}

// Complete Catalog with Real Upstream Names & Specs
const MODEL_CATALOG: ModelCardData[] = [
    // --- TEXT & REASONING ---
    {
        id: 'flux-sonnet',
        realName: 'Anthropic Claude Sonnet 4.5',
        provider: 'AWS Bedrock',
        modality: 'text',
        label: 'Flux Sonnet 4.5',
        description: 'SOTA frontier reasoning, complex architecture synthesis, and autonomous agent workflows on AWS Bedrock.',
        contextWindow: '200,000 tokens',
        maxOutput: '64,000 tokens',
        speedRating: 'High Speed Reasoning',
        minTier: 'pro',
        capabilities: ['deep-reasoning', 'coding', 'vision', 'tool-calling', 'json-mode', 'extended-thinking'],
        aliases: ['flux-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4.5'],
        samplePrompt: 'Design a distributed fault-tolerant database shard allocation algorithm in TypeScript.'
    },
    {
        id: 'flux-pro-max',
        realName: 'Anthropic Claude 3.7 / 4.6 Sonnet',
        provider: 'AWS Bedrock',
        modality: 'text',
        label: 'Flux Pro Max',
        description: 'Frontier hybrid reasoning architecture with extended thinking benchmarks and rigorous SQL optimization.',
        contextWindow: '200,000 tokens',
        maxOutput: '64,000 tokens',
        speedRating: 'Deep Thinking',
        minTier: 'max',
        capabilities: ['extended-thinking', 'code-synthesis', 'system-design', 'multi-tool'],
        aliases: ['claude-3-7-sonnet', 'claude-sonnet-latest'],
        samplePrompt: 'Perform a full security and performance audit of a PostgreSQL foreign data wrapper implementation.'
    },
    {
        id: 'flux-turbo',
        realName: 'Meta LLaMA 3.3 70B Versatile',
        provider: 'Groq / Meta',
        modality: 'text',
        label: 'Flux Turbo',
        description: 'Hyper-speed 300+ tokens/second inference powered by Groq LPUs. Ideal for real-time agents and rapid interactive UX.',
        contextWindow: '128,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: '300+ tok/s (Hyper)',
        minTier: 'free',
        capabilities: ['hyper-fast', 'code', 'chat', 'tool-calling', 'json-mode'],
        aliases: ['llama-3.3-70b', 'groq-llama-70b'],
        samplePrompt: 'Write an optimized regex parser in Rust with benchmarks.'
    },
    {
        id: 'flux-omni',
        realName: 'Google Gemini 2.0 Flash',
        provider: 'Google Gemini',
        modality: 'text',
        label: 'Flux Omni',
        description: 'Massive 1M token context window, multimodal image understanding, and high-velocity reasoning.',
        contextWindow: '1,048,576 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Ultra-Fast Multimodal',
        minTier: 'free',
        capabilities: ['1m-context', 'vision', 'document-analysis', 'tool-calling'],
        aliases: ['gemini-2.0-flash', 'gemini-flash'],
        samplePrompt: 'Analyze this full application schema and generate an ER diagram in Mermaid format.'
    },
    {
        id: 'flux-max',
        realName: 'OpenAI GPT-4o Mini',
        provider: 'OpenAI',
        modality: 'text',
        label: 'Flux Max',
        description: 'Lightweight flagship intelligence with strong coding and instruction adherence at high velocity.',
        contextWindow: '128,000 tokens',
        maxOutput: '16,384 tokens',
        speedRating: 'Fast & Robust',
        minTier: 'free',
        capabilities: ['instruction-following', 'vision', 'chat', 'json-mode'],
        aliases: ['gpt-4o-mini'],
        samplePrompt: 'Summarize the differences between optimistic and pessimistic locking in SQL.'
    },
    {
        id: 'flux',
        realName: 'Zhipu AI GLM-4 Flash',
        provider: 'Zhipu AI',
        modality: 'text',
        label: 'Flux (Default)',
        description: 'High-accuracy general reasoning, precision SQL query generation, and conversational code intelligence.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Sub-150ms First Token',
        minTier: 'free',
        capabilities: ['general-reasoning', 'sql-synthesis', 'tool-calling', 'json-mode'],
        aliases: ['default', 'flux-v4'],
        samplePrompt: 'Write a SQL query using window functions to calculate 7-day rolling revenue per customer.'
    },
    {
        id: 'flux-flash',
        realName: 'Zhipu AI GLM-4 Flash (Turbo UX)',
        provider: 'Zhipu AI',
        modality: 'text',
        label: 'Flux Flash',
        description: 'Sub-100ms token throughput optimized for code autocomplete, real-time streaming, and interactive widgets.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Sub-100ms Low Latency',
        minTier: 'free',
        capabilities: ['real-time-ux', 'autocomplete', 'streaming', 'lightweight'],
        aliases: ['fast-chat'],
        samplePrompt: 'Autocomplete this JavaScript debounce utility function.'
    },
    {
        id: 'flux-5.2',
        realName: 'Zhipu AI GLM-4 Plus (Frontier Agent)',
        provider: 'Zhipu AI',
        modality: 'text',
        label: 'Flux 5.2',
        description: 'Specialized reasoning architecture engineered for multi-step agentic tool execution and recursive problem solving.',
        contextWindow: '128,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Balanced Cognitive',
        minTier: 'free',
        capabilities: ['agentic-execution', 'multi-step-tools', 'complex-reasoning'],
        aliases: ['agent-v5'],
        samplePrompt: 'Create a complete multi-step migration script that refactors table schema with rollback handling.'
    },
    {
        id: 'flux-pro',
        realName: 'Zhipu AI GLM-4 Air',
        provider: 'Zhipu AI',
        modality: 'text',
        label: 'Flux Pro',
        description: 'Enhanced instruction following, multi-table analytical queries, and strict JSON Schema output.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Reliable Enterprise',
        minTier: 'free',
        capabilities: ['strict-json', 'data-modeling', 'bi-analysis'],
        samplePrompt: 'Generate a JSON Schema conforming API response model for a payment transaction.'
    },
    {
        id: 'flux-ultra',
        realName: 'Zhipu AI GLM-4 Plus (Deep Reasoning)',
        provider: 'Zhipu AI',
        modality: 'text',
        label: 'Flux Ultra',
        description: 'Maximum cognitive depth for database architectural blueprints, complex migrations, and audit trails.',
        contextWindow: '128,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Deep Analysis',
        minTier: 'free',
        capabilities: ['architectural-design', 'deep-verification', 'long-chain-thought'],
        samplePrompt: 'Analyze this multi-tenant database schema for potential connection pool exhaustion vulnerabilities.'
    },
    {
        id: 'flux-vision',
        realName: 'Zhipu AI GLM-4V Multimodal',
        provider: 'Zhipu AI',
        modality: 'text',
        label: 'Flux Vision',
        description: 'High-speed visual comprehension, diagram recognition, screenshot-to-code, and receipt inspection.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Fast Multimodal',
        minTier: 'free',
        capabilities: ['vision-ocr', 'screenshot-to-code', 'diagram-analysis'],
        samplePrompt: 'Extract table columns and data types from this database diagram screenshot.'
    },
    {
        id: 'gpt-4o',
        realName: 'OpenAI GPT-4o (Drop-in Alias)',
        provider: 'OpenAI',
        modality: 'text',
        label: 'GPT-4o Alias',
        description: 'OpenAI compatibility alias. Transparently routed to flux-ultra with zero code modifications.',
        contextWindow: '128,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Flagship Alias',
        minTier: 'free',
        capabilities: ['openai-drop-in', 'chat', 'coding'],
        isDropinAlias: true,
        samplePrompt: 'Write a Next.js App Router API route with session verification.'
    },

    // --- IMAGE GENERATION ---
    {
        id: 'flux-image-ultra',
        realName: 'Stability AI Stable Image Ultra 1.0',
        provider: 'AWS Bedrock',
        modality: 'image',
        label: 'Flux Image Ultra',
        description: 'SOTA photorealism, exquisite typography rendering, complex composition, and automatic S3 cloud storage.',
        contextWindow: 'N/A (Image)',
        maxOutput: 'Up to 4K UHD',
        speedRating: 'Ultra High Fidelity',
        minTier: 'pro',
        capabilities: ['photorealism-sota', 'typography', 'cinematic-lighting', 's3-auto-storage'],
        aliases: ['stable-image-ultra', 'stable-diffusion-ultra'],
        samplePrompt: 'A futuristic cybernetic database server room with neon orange coolant tubes, cinematic 8k photorealistic.'
    },
    {
        id: 'flux-image-hd',
        realName: 'Google Imagen 3.0',
        provider: 'Google Gemini',
        modality: 'image',
        label: 'Flux Image HD',
        description: 'High-definition 4K image generation with superior detail, natural skin tones, and crisp English text rendering.',
        contextWindow: 'N/A (Image)',
        maxOutput: 'Up to 4K',
        speedRating: 'Fast High-Def',
        minTier: 'free',
        capabilities: ['4k-hd', 'typography', 'creative-scenes', 's3-auto-storage'],
        aliases: ['imagen-3'],
        samplePrompt: 'Vintage travel poster for Neo Tokyo with bold typography and retro color palette.'
    },
    {
        id: 'flux-image-pro',
        realName: 'OpenAI DALL·E 3',
        provider: 'OpenAI',
        modality: 'image',
        label: 'Flux Image Pro',
        description: 'Premium prompt adherence with imaginative visual styling and composition accuracy.',
        contextWindow: 'N/A (Image)',
        maxOutput: '1024x1024 / 1792x1024',
        speedRating: 'High Quality',
        minTier: 'pro',
        capabilities: ['prompt-adherence', 'creative', 's3-auto-storage'],
        aliases: ['dall-e-3'],
        samplePrompt: 'A minimal isometric 3D render of a cloud database architecture on a dark sleek background.'
    },
    {
        id: 'flux-image',
        realName: 'Zhipu AI CogView 4',
        provider: 'Zhipu AI',
        modality: 'image',
        label: 'Flux Image',
        description: 'High-quality photorealistic text-to-image synthesis with prompt refinement and direct S3 cloud asset delivery.',
        contextWindow: 'N/A (Image)',
        maxOutput: '1024x1024',
        speedRating: 'Balanced',
        minTier: 'free',
        capabilities: ['photorealistic', 's3-auto-storage'],
        aliases: ['cogview-4'],
        samplePrompt: 'Modern minimalist logo for a high-performance database startup, vector style.'
    },
    {
        id: 'flux-image-fast',
        realName: 'Zhipu AI CogView 3 Flash',
        provider: 'Zhipu AI',
        modality: 'image',
        label: 'Flux Image Fast',
        description: 'Ultra-fast low-latency image generation designed for user avatars, blog thumbnails, and rapid prototyping.',
        contextWindow: 'N/A (Image)',
        maxOutput: '1024x1024',
        speedRating: 'Sub-2s Fast Gen',
        minTier: 'free',
        capabilities: ['ultra-fast', 'thumbnails', 's3-auto-storage'],
        aliases: ['dall-e-2'],
        samplePrompt: 'Flat illustration of a cloud storage server icon, gradient colors.'
    },

    // --- VIDEO GENERATION ---
    {
        id: 'flux-video-ray',
        realName: 'Luma AI Ray v2',
        provider: 'AWS Bedrock',
        modality: 'video',
        label: 'Flux Video Ray',
        description: 'Cinema-grade dynamic video generation with temporal consistency, physics rendering, and camera motion on AWS Bedrock.',
        contextWindow: 'N/A (Video)',
        maxOutput: '720p / 1080p MP4',
        speedRating: 'Cinematic Engine',
        minTier: 'pro',
        capabilities: ['cinema-physics', 'camera-motion', 'async-polling', 's3-dest'],
        aliases: ['luma-ray-v2', 'ray-v2'],
        samplePrompt: 'Cinematic drone shot flying through a bioluminescent redwood forest at twilight, mist rolling in.'
    },
    {
        id: 'flux-video',
        realName: 'Zhipu AI CogVideoX Flash',
        provider: 'Zhipu AI',
        modality: 'video',
        label: 'Flux Video',
        description: 'Text-to-video generation with dynamic lighting and camera pans. Dispatched via asynchronous task IDs.',
        contextWindow: 'N/A (Video)',
        maxOutput: '720p MP4 (5-10s)',
        speedRating: 'Fast Async Video',
        minTier: 'pro',
        capabilities: ['text-to-video', 'async-polling', 's3-auto-storage'],
        aliases: ['cogvideox-flash'],
        samplePrompt: 'Time-lapse of clouds racing over a bustling modern skyscraper city at sunset.'
    },
    {
        id: 'flux-video-pro',
        realName: 'Zhipu AI CogVideoX HD',
        provider: 'Zhipu AI',
        modality: 'video',
        label: 'Flux Video Pro',
        description: 'Cinematic 1080p video generation with high fidelity, rich motion dynamics, and crisp textures.',
        contextWindow: 'N/A (Video)',
        maxOutput: '1080p HD MP4',
        speedRating: 'Studio Render',
        minTier: 'max',
        capabilities: ['1080p-hd', 'motion-stability', 'async-polling'],
        aliases: ['cogvideox-hd'],
        samplePrompt: 'Slow motion macro shot of water droplets splashing onto a shiny obsidian stone.'
    },

    // --- AUDIO: SPEECH-TO-TEXT (STT) ---
    {
        id: 'flux-listen',
        realName: 'OpenAI Whisper Large v3 Turbo',
        provider: 'Groq / Meta',
        modality: 'audio-stt',
        label: 'Flux Listen',
        description: 'Ultra-fast multilingual audio transcription with segment timestamps, powered by Groq LPUs at 10x real-time speed.',
        contextWindow: '25 MB Audio File',
        maxOutput: 'Full Transcript + Timestamps',
        speedRating: '10x Real-time (Groq)',
        minTier: 'free',
        capabilities: ['multilingual-stt', 'word-timestamps', 'groq-accelerated'],
        aliases: ['whisper-1', 'whisper-large-v3-turbo'],
        samplePrompt: 'Transcribe meeting audio recording with speaker timestamps.'
    },
    {
        id: 'flux-listen-pro',
        realName: 'OpenAI Whisper Large v3',
        provider: 'Groq / Meta',
        modality: 'audio-stt',
        label: 'Flux Listen Pro',
        description: 'Maximum precision transcription for noisy environments, technical terminology, accents, and multiple dialects.',
        contextWindow: '25 MB Audio File',
        maxOutput: 'Full Precision Transcript',
        speedRating: 'High Accuracy',
        minTier: 'free',
        capabilities: ['high-accuracy', 'noise-robust', 'multilingual'],
        samplePrompt: 'Transcribe medical conference audio with technical jargon.'
    },
    {
        id: 'flux-listen-en',
        realName: 'Distil-Whisper Large v3 English',
        provider: 'Groq / Meta',
        modality: 'audio-stt',
        label: 'Flux Listen English',
        description: 'Lightweight, hyper-fast English-only speech recognition with near-zero latency for live voice assistants.',
        contextWindow: '25 MB Audio File',
        maxOutput: 'English Transcript',
        speedRating: 'Hyper-Fast English',
        minTier: 'free',
        capabilities: ['english-optimized', 'sub-second', 'voice-agents'],
        samplePrompt: 'Instant transcription for live voice search command.'
    },

    // --- AUDIO: TEXT-TO-SPEECH (TTS) ---
    {
        id: 'flux-speak',
        realName: 'OpenAI TTS-1',
        provider: 'OpenAI',
        modality: 'audio-tts',
        label: 'Flux Speak',
        description: 'Natural, expressive text-to-speech voice synthesis across 6 voice personas (alloy, echo, fable, onyx, nova, shimmer).',
        contextWindow: '4,096 characters',
        maxOutput: 'MP3 / Opus Audio Stream',
        speedRating: 'Real-time Audio Stream',
        minTier: 'free',
        capabilities: ['voice-synthesis', '6-voices', 'streaming-audio'],
        aliases: ['tts-1'],
        samplePrompt: 'Synthesize audio narration: "Welcome to Fluxbase. Your serverless database is ready."'
    },
    {
        id: 'flux-speak-hd',
        realName: 'OpenAI TTS-1 HD',
        provider: 'OpenAI',
        modality: 'audio-tts',
        label: 'Flux Speak HD',
        description: 'Studio-grade high-definition audio synthesis for polished podcast intros, product walkthroughs, and audiobooks.',
        contextWindow: '4,096 characters',
        maxOutput: 'Lossless HD Audio',
        speedRating: 'Studio Quality',
        minTier: 'pro',
        capabilities: ['studio-master', 'hd-audio', '6-voices'],
        aliases: ['tts-1-hd'],
        samplePrompt: 'Synthesize studio HD audio for an enterprise customer onboarding guide.'
    },

    // --- TEXT EMBEDDINGS ---
    {
        id: 'flux-embed',
        realName: 'Google Text Embedding 004',
        provider: 'Google Gemini',
        modality: 'embedding',
        label: 'Flux Embed',
        description: 'High-density 768-dimensional vector embeddings for semantic similarity, RAG retrieval, and vector search.',
        contextWindow: '2,048 tokens',
        maxOutput: '768-dim Vector Float[]',
        speedRating: 'Sub-50ms Fast Vector',
        minTier: 'free',
        capabilities: ['semantic-search', 'rag-retrieval', 'vector-index', '768-dim'],
        aliases: ['text-embedding-3-small', 'text-embedding-004'],
        samplePrompt: 'Generate embedding vector for documentation semantic search index.'
    }
];

// Tier Token Quota Specifications
const TIER_TOKEN_QUOTAS: Record<string, {
    textTpm: string;
    textRpm: string;
    dailyReq: string;
    imageLimit: string;
    videoLimit: string;
    audioLimit: string;
    embeddingLimit: string;
    description: string;
    badgeColor: string;
}> = {
    free: {
        textTpm: '10,000 TPM',
        textRpm: '10 RPM',
        dailyReq: '500 Requests / Day',
        imageLimit: '5 Generations / Day (20k TPM)',
        videoLimit: 'Unavailable (Upgrade to Pro/Max)',
        audioLimit: '20 Requests / Day (30k TPM)',
        embeddingLimit: '500 Requests / Day (50k TPM)',
        description: 'Standard developer rate limits for exploration, prototyping, and testing.',
        badgeColor: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
    },
    pro: {
        textTpm: '100,000 TPM',
        textRpm: '60 RPM',
        dailyReq: '10,000 Requests / Day',
        imageLimit: '50 Generations / Day (100k TPM)',
        videoLimit: '5 Generations / Day (50k TPM)',
        audioLimit: '200 Requests / Day (150k TPM)',
        embeddingLimit: '5,000 Requests / Day (200k TPM)',
        description: 'High-throughput production quotas for apps, agents, and team workflows.',
        badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/30'
    },
    max: {
        textTpm: '500,000 TPM',
        textRpm: '300 RPM',
        dailyReq: '50,000 Requests / Day',
        imageLimit: '200 Generations / Day (300k TPM)',
        videoLimit: '20 Generations / Day (100k TPM)',
        audioLimit: '1,000 Requests / Day (500k TPM)',
        embeddingLimit: '25,000 Requests / Day (1M TPM)',
        description: 'Enterprise-grade cognitive compute for high-volume pipelines and mission-critical agents.',
        badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    },
    pay_as_you_go: {
        textTpm: 'Unlimited TPM (Uncapped)',
        textRpm: 'Unlimited RPM',
        dailyReq: 'Unlimited (Pay-As-You-Go)',
        imageLimit: 'Unlimited (Metered at standard rates)',
        videoLimit: 'Unlimited (Metered at standard rates)',
        audioLimit: 'Unlimited (Metered at standard rates)',
        embeddingLimit: 'Unlimited (Metered at standard rates)',
        description: 'Zero rate caps. Pure on-demand elasticity metered directly to your payment instrument.',
        badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    },
    employee: {
        textTpm: 'Unlimited TPM (Uncapped)',
        textRpm: 'Unlimited RPM',
        dailyReq: 'Unlimited Internal Access',
        imageLimit: 'Unlimited',
        videoLimit: 'Unlimited',
        audioLimit: 'Unlimited',
        embeddingLimit: 'Unlimited',
        description: 'Internal organization staff privileges with uncapped access across all modalities.',
        badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/30'
    },
    org_owner: {
        textTpm: 'Unlimited TPM (Uncapped)',
        textRpm: 'Unlimited RPM',
        dailyReq: 'Unlimited Organization Access',
        imageLimit: 'Unlimited',
        videoLimit: 'Unlimited',
        audioLimit: 'Unlimited',
        embeddingLimit: 'Unlimited',
        description: 'Organization administrator tier with unlimited throughput and dedicated headroom.',
        badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    }
};

export default function AiModelsPage() {
    const { project: selectedProject } = useContext(ProjectContext);
    const { toast } = useToast();

    // User & Plan State
    const [planType, setPlanType] = useState<string>('free');
    const [previewTier, setPreviewTier] = useState<string | null>(null);
    const [loadingPlan, setLoadingPlan] = useState(true);

    // API Keys State
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loadingKeys, setLoadingKeys] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [keyName, setKeyName] = useState('');
    const [keyScope, setKeyScope] = useState<'ai' | 'full'>('ai');
    const [newGeneratedKey, setNewGeneratedKey] = useState<string | null>(null);
    const [isCreatingKey, setIsCreatingKey] = useState(false);

    // Filter & Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedModality, setSelectedModality] = useState<string>('all');
    const [selectedProvider, setSelectedProvider] = useState<string>('all');

    // Code Snippet Modal
    const [snippetModalOpen, setSnippetModalOpen] = useState(false);
    const [selectedSnippetModel, setSelectedSnippetModel] = useState<ModelCardData | null>(null);
    const [snippetLang, setSnippetLang] = useState<'curl' | 'python' | 'node'>('curl');
    const [copiedSnippet, setCopiedSnippet] = useState(false);

    // Playground Modal
    const [playgroundModalOpen, setPlaygroundModalOpen] = useState(false);
    const [selectedPlaygroundModel, setSelectedPlaygroundModel] = useState<ModelCardData | null>(null);
    const [playgroundPrompt, setPlaygroundPrompt] = useState('');
    const [playgroundResponse, setPlaygroundResponse] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // 1. Fetch User Plan
    useEffect(() => {
        setLoadingPlan(true);
        getUserPlanAction().then(res => {
            if (res.success && res.plan) {
                const normPlan = res.plan.toLowerCase();
                setPlanType(normPlan);
            }
        }).finally(() => setLoadingPlan(false));
    }, []);

    // 2. Fetch API Keys
    const loadKeys = () => {
        setLoadingKeys(true);
        getApiKeysAction(selectedProject?.project_id).then(res => {
            if (res.success && res.data) {
                setKeys(res.data);
            }
        }).finally(() => setLoadingKeys(false));
    };

    useEffect(() => {
        loadKeys();
    }, [selectedProject]);

    // Active tier for quota calculations
    const activeTier = previewTier || planType || 'free';
    const quota = TIER_TOKEN_QUOTAS[activeTier] || TIER_TOKEN_QUOTAS.free;

    // Filtered Model Catalog
    const filteredModels = useMemo(() => {
        return MODEL_CATALOG.filter(m => {
            // Modality match
            if (selectedModality !== 'all' && m.modality !== selectedModality) return false;
            // Provider match
            if (selectedProvider !== 'all' && m.provider !== selectedProvider) return false;
            // Search match
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchId = m.id.toLowerCase().includes(q);
                const matchReal = m.realName.toLowerCase().includes(q);
                const matchDesc = m.description.toLowerCase().includes(q);
                const matchCap = m.capabilities.some(c => c.toLowerCase().includes(q));
                const matchAlias = m.aliases?.some(a => a.toLowerCase().includes(q));
                if (!matchId && !matchReal && !matchDesc && !matchCap && !matchAlias) return false;
            }
            return true;
        });
    }, [selectedModality, selectedProvider, searchQuery]);

    // Create Key Handler
    const handleCreateKey = async () => {
        if (!keyName.trim()) {
            toast({ variant: "destructive", title: "Error", description: "Please enter an API key label." });
            return;
        }
        setIsCreatingKey(true);
        const scopes = keyScope === 'ai' ? ['ai', 'read'] : ['ai', 'read', 'write', 'admin'];
        const res = await createApiKeyAction(keyName.trim(), selectedProject?.project_id, scopes);
        setIsCreatingKey(false);

        if (res.success && res.data) {
            setNewGeneratedKey(res.data.key);
            setKeys([res.data.apiKeyData, ...keys]);
            setKeyName('');
            toast({ title: "Success", description: "New AI Gateway API Key created!" });
        } else {
            toast({ variant: "destructive", title: "Creation Failed", description: res.error || "Could not generate key." });
        }
    };

    // Revoke Key Handler
    const handleRevokeKey = async (id: string) => {
        const res = await revokeApiKeyAction(id);
        if (res.success) {
            setKeys(prev => prev.filter(k => k.id !== id));
            toast({ title: "Revoked", description: "API Key revoked successfully." });
        } else {
            toast({ variant: "destructive", title: "Revocation Failed", description: res.error });
        }
    };

    // Copy Helper
    const copyText = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast({ title: "Copied!", description: `${label} copied to clipboard.` });
    };

    // Active key preview for snippets
    const activeKeyPreview = keys[0]?.preview || 'flx_live_your_fluxbase_key';

    // Generate Code Snippets
    const getSnippetCode = (model: ModelCardData, lang: 'curl' | 'python' | 'node') => {
        const key = activeKeyPreview;
        if (model.modality === 'image') {
            if (lang === 'curl') {
                return `curl -X POST https://fluxbasedb.me/api/v1/images/generations \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "prompt": "${model.samplePrompt || 'Futuristic cybernetic city at twilight, 8k resolution'}",
    "n": 1,
    "size": "1024x1024"
  }'`;
            }
            if (lang === 'python') {
                return `from openai import OpenAI

client = OpenAI(
    base_url="https://fluxbasedb.me/api/v1",
    api_key="${key}"
)

response = client.images.generate(
    model="${model.id}",
    prompt="${model.samplePrompt || 'Futuristic cybernetic city at twilight'}",
    size="1024x1024",
    n=1
)

print("Generated Image URL:", response.data[0].url)`;
            }
            return `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://fluxbasedb.me/api/v1',
  apiKey: process.env.FLUXBASE_API_KEY || '${key}',
});

async function main() {
  const image = await client.images.generate({
    model: '${model.id}',
    prompt: '${model.samplePrompt || 'Futuristic cybernetic city at twilight'}',
  });
  console.log(image.data[0].url);
}
main();`;
        }

        if (model.modality === 'video') {
            if (lang === 'curl') {
                return `# Step 1: Start Asynchronous Video Generation
curl -X POST https://fluxbasedb.me/api/v1/videos/generations \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "prompt": "${model.samplePrompt || 'Cinematic drone shot swooping over mist-covered mountains'}"
  }'

# Step 2: Poll Generation Status with task_id
curl https://fluxbasedb.me/api/v1/videos/generations/<TASK_ID> \\
  -H "Authorization: Bearer ${key}"`;
            }
            if (lang === 'python') {
                return `import requests, time

headers = {
    "Authorization": "Bearer ${key}",
    "Content-Type": "application/json"
}

# 1. Start generation
res = requests.post("https://fluxbasedb.me/api/v1/videos/generations", headers=headers, json={
    "model": "${model.id}",
    "prompt": "${model.samplePrompt || 'Cinematic drone shot swooping over mountains'}"
}).json()

task_id = res["id"]
print(f"Task dispatched: {task_id}")

# 2. Poll until complete
while True:
    time.sleep(4)
    status = requests.get(f"https://fluxbasedb.me/api/v1/videos/generations/{task_id}", headers=headers).json()
    print(f"Status: {status.get('task_status')}")
    if status.get("task_status") == "SUCCESS":
        print("Video URL:", status["video_result"][0]["url"])
        break`;
            }
            return `async function generateVideo() {
  const res = await fetch('https://fluxbasedb.me/api/v1/videos/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ${key}',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: '${model.id}',
      prompt: '${model.samplePrompt || 'Cinematic drone shot over mountains'}'
    })
  });
  const task = await res.json();
  console.log('Task started:', task.id);
}
generateVideo();`;
        }

        // Standard Text / Chat
        if (lang === 'curl') {
            return `curl -X POST https://fluxbasedb.me/api/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "messages": [
      {"role": "system", "content": "You are an expert AI engineer."},
      {"role": "user", "content": "${model.samplePrompt || 'Explain distributed database indexing.'}"}
    ],
    "temperature": 0.3
  }'`;
        }
        if (lang === 'python') {
            return `from openai import OpenAI

client = OpenAI(
    base_url="https://fluxbasedb.me/api/v1",
    api_key="${key}"
)

completion = client.chat.completions.create(
    model="${model.id}",
    messages=[
        {"role": "system", "content": "You are an expert database engineer."},
        {"role": "user", "content": "${model.samplePrompt || 'Explain distributed database indexing.'}"}
    ],
    stream=True
)

for chunk in completion:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;
        }
        return `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://fluxbasedb.me/api/v1',
  apiKey: process.env.FLUXBASE_API_KEY || '${key}',
});

async function main() {
  const stream = await client.chat.completions.create({
    model: '${model.id}',
    messages: [{ role: 'user', content: '${model.samplePrompt || 'Explain distributed database indexing.'}' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}
main();`;
    };

    // Run Playground Test
    const handleRunPlayground = async () => {
        if (!selectedPlaygroundModel || !playgroundPrompt.trim()) return;
        setIsPlaying(true);
        setPlaygroundResponse(null);

        try {
            const endpoint = selectedPlaygroundModel.modality === 'image' 
                ? '/api/v1/images/generations' 
                : '/api/v1/chat/completions';
            
            const body = selectedPlaygroundModel.modality === 'image'
                ? { model: selectedPlaygroundModel.id, prompt: playgroundPrompt }
                : {
                    model: selectedPlaygroundModel.id,
                    messages: [{ role: 'user', content: playgroundPrompt }]
                };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Use project header if in browser context
                    ...(selectedProject ? { 'X-Project-Id': selectedProject.project_id } : {})
                },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.choices?.[0]?.message?.content) {
                setPlaygroundResponse(data.choices[0].message.content);
            } else if (data.data?.[0]?.url) {
                setPlaygroundResponse(`IMAGE_GENERATED: ${data.data[0].url}`);
            } else if (data.error) {
                setPlaygroundResponse(`Error: ${data.error.message || JSON.stringify(data.error)}`);
            } else {
                setPlaygroundResponse(JSON.stringify(data, null, 2));
            }
        } catch (err: any) {
            setPlaygroundResponse(`Execution error: ${err.message}`);
        } finally {
            setIsPlaying(false);
        }
    };

    return (
        <div className="space-y-8 w-full max-w-7xl mx-auto pb-16">
            
            {/* ─── Top Header & Hero ────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card/90 to-background p-6 sm:p-8 shadow-xl">
                <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />
                <div className="absolute right-32 -bottom-20 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                            <Sparkles className="h-3.5 w-3.5" />
                            Universal Multimodal Gateway • OpenAI-Compatible
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                            AI Models & Gateway Registry
                        </h1>
                        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base leading-relaxed">
                            Access top-tier frontier intelligence across 6 modalities with unified OpenAI SDK compatibility. 
                            Direct Bedrock, Groq, Gemini, and OpenAI routing with zero middleware latency.
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3">
                        <Button 
                            onClick={() => {
                                setNewGeneratedKey(null);
                                setCreateDialogOpen(true);
                            }}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-orange-500/20"
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Create AI API Key
                        </Button>
                        <Button variant="outline" asChild className="border-border/80">
                            <Link href="/docs#flux-ai-gateway">
                                <Code2 className="h-4 w-4 mr-2 text-primary" />
                                Docs & SDKs
                            </Link>
                        </Button>
                        <Button variant="ghost" asChild className="text-muted-foreground hover:text-foreground">
                            <Link href="/api/docs/download-pdf" target="_blank">
                                <ExternalLink className="h-4 w-4 mr-1.5" />
                                PDF Manual
                            </Link>
                        </Button>
                    </div>
                </div>

                {/* ─── Live Metrics Ribbon ─────────────────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-border/60">
                    <div className="rounded-lg bg-secondary/50 p-3 border border-border/40">
                        <div className="text-xs text-muted-foreground font-medium">Models Available</div>
                        <div className="text-xl font-bold text-foreground mt-0.5">33 Registered</div>
                    </div>
                    <div className="rounded-lg bg-secondary/50 p-3 border border-border/40">
                        <div className="text-xs text-muted-foreground font-medium">Supported Modalities</div>
                        <div className="text-xl font-bold text-cyan-400 mt-0.5">6 Modalities</div>
                    </div>
                    <div className="rounded-lg bg-secondary/50 p-3 border border-border/40">
                        <div className="text-xs text-muted-foreground font-medium">Gateway Protocol</div>
                        <div className="text-xl font-bold text-emerald-400 mt-0.5">OpenAI Drop-In</div>
                    </div>
                    <div className="rounded-lg bg-secondary/50 p-3 border border-border/40">
                        <div className="text-xs text-muted-foreground font-medium">Active Keys</div>
                        <div className="text-xl font-bold text-orange-400 mt-0.5">{keys.length} Active</div>
                    </div>
                </div>
            </div>

            {/* ─── YOUR TIER & TOKEN QUOTAS BANNER (USER SPECIFIED REQUIREMENT) ─── */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-md relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/60">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
                            <Shield className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-foreground">Your Plan Quota & Token Allocations</h2>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${quota.badgeColor}`}>
                                    {activeTier.toUpperCase().replace(/_/g, ' ')} PLAN
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Token throughput, rate limits, and daily ceilings allocated to your authenticated user account.
                            </p>
                        </div>
                    </div>

                    {/* Preview Switcher */}
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground font-medium">Compare Tier Limits:</span>
                        <div className="flex bg-secondary p-1 rounded-lg border border-border text-xs">
                            {(['free', 'pro', 'max', 'pay_as_you_go'] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => setPreviewTier(t)}
                                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                                        activeTier === t 
                                            ? 'bg-primary text-primary-foreground shadow' 
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {t === 'pay_as_you_go' ? 'PayG' : t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Quota Specs Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div className="rounded-lg border border-border/60 bg-secondary/30 p-3.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">Text & Reasoning TPM</span>
                            <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                        </div>
                        <div className="text-lg font-bold text-foreground mt-1">{quota.textTpm}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{quota.textRpm} • {quota.dailyReq}</div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-secondary/30 p-3.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">Image Generation</span>
                            <ImageIcon className="h-3.5 w-3.5 text-purple-400" />
                        </div>
                        <div className="text-lg font-bold text-foreground mt-1">{quota.imageLimit.split('(')[0]}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">S3 Auto Storage Enabled</div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-secondary/30 p-3.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">Video Synthesis</span>
                            <Video className="h-3.5 w-3.5 text-pink-400" />
                        </div>
                        <div className="text-lg font-bold text-foreground mt-1">{quota.videoLimit.split('(')[0]}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">Async Polling Protocol</div>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-secondary/30 p-3.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">Speech & Audio STT/TTS</span>
                            <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                        </div>
                        <div className="text-lg font-bold text-foreground mt-1">{quota.audioLimit.split('(')[0]}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">Whisper + Studio TTS</div>
                    </div>
                </div>

                {activeTier === 'free' && (
                    <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-xs">
                        <div className="flex items-center gap-2 text-orange-300">
                            <Info className="h-4 w-4 shrink-0 text-orange-400" />
                            <span>Want uncapped tokens and video models? Switch to <strong>Pay-As-You-Go</strong> or <strong>Pro</strong> to unlock 100k+ TPM and cinematic video.</span>
                        </div>
                        <Button size="sm" asChild className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                            <Link href="/pricing">Upgrade Plan</Link>
                        </Button>
                    </div>
                )}
            </div>

            {/* ─── API KEY MANAGEMENT BOX ─────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-md">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
                            <Key className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-foreground">AI Gateway API Keys</h2>
                            <p className="text-xs text-muted-foreground">
                                Use these Bearer tokens in Cursor, Windsurf, LangChain, or your custom services.
                            </p>
                        </div>
                    </div>

                    <Button 
                        size="sm"
                        onClick={() => {
                            setNewGeneratedKey(null);
                            setCreateDialogOpen(true);
                        }}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        New Key
                    </Button>
                </div>

                {/* Keys Table / List */}
                <div className="mt-4">
                    {loadingKeys ? (
                        <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
                            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                            Loading API keys...
                        </div>
                    ) : keys.length === 0 ? (
                        <div className="text-center p-8 border border-dashed border-border/80 rounded-lg">
                            <Key className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                            <div className="text-sm font-semibold text-foreground">No API Keys Generated</div>
                            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                                Generate an AI Gateway key to connect Cursor, python scripts, or backend services to Fluxbase models.
                            </p>
                            <Button 
                                size="sm" 
                                className="mt-4" 
                                onClick={() => setCreateDialogOpen(true)}
                            >
                                <Plus className="h-3.5 w-3.5 mr-1" /> Create Your First Key
                            </Button>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/60">
                            {keys.map(k => (
                                <div key={k.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-foreground">{k.name}</span>
                                            <code className="text-xs font-mono px-2 py-0.5 rounded bg-secondary text-muted-foreground border border-border/50">
                                                {k.preview}
                                            </code>
                                            {k.projectName && (
                                                <Badge variant="outline" className="text-[10px] font-mono">
                                                    {k.projectName}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {k.scopes?.map(s => (
                                                <span key={s} className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                                    {s}
                                                </span>
                                            ))}
                                            <span className="text-[11px] text-muted-foreground ml-2">
                                                Created {new Date(k.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => copyText(k.preview, 'API Key preview')}
                                            className="h-8 text-xs"
                                        >
                                            <Copy className="h-3.5 w-3.5 mr-1" />
                                            Copy
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleRevokeKey(k.id)}
                                            className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ─── MODEL FILTERS & SEARCH BAR ─────────────────────────────── */}
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-foreground">Explore Frontier Models</h2>
                        <p className="text-xs text-muted-foreground">
                            Browse all models with their official upstream architectures and real names.
                        </p>
                    </div>

                    {/* Search Input */}
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by real name, model ID, or capability..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 text-xs bg-card"
                        />
                    </div>
                </div>

                {/* Modality Filter Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                    {[
                        { id: 'all', label: 'All Modalities', count: MODEL_CATALOG.length, icon: Layers },
                        { id: 'text', label: 'Text & Reasoning', count: MODEL_CATALOG.filter(m => m.modality === 'text').length, icon: Cpu },
                        { id: 'image', label: 'Image Generation', count: MODEL_CATALOG.filter(m => m.modality === 'image').length, icon: ImageIcon },
                        { id: 'video', label: 'Video Generation', count: MODEL_CATALOG.filter(m => m.modality === 'video').length, icon: Video },
                        { id: 'audio-stt', label: 'Speech-to-Text', count: MODEL_CATALOG.filter(m => m.modality === 'audio-stt').length, icon: Mic },
                        { id: 'audio-tts', label: 'Text-to-Speech', count: MODEL_CATALOG.filter(m => m.modality === 'audio-tts').length, icon: Volume2 },
                        { id: 'embedding', label: 'Embeddings', count: MODEL_CATALOG.filter(m => m.modality === 'embedding').length, icon: Database },
                    ].map(item => {
                        const Icon = item.icon;
                        const isSelected = selectedModality === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setSelectedModality(item.id)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                                    isSelected
                                        ? 'bg-primary text-primary-foreground border-primary shadow'
                                        : 'bg-card hover:bg-secondary text-muted-foreground hover:text-foreground border-border'
                                }`}
                            >
                                <Icon className="h-3.5 w-3.5" />
                                {item.label}
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-black/20 text-white' : 'bg-secondary text-muted-foreground'}`}>
                                    {item.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Provider Filter Row */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-muted-foreground font-medium text-xs">Provider:</span>
                    {['all', 'AWS Bedrock', 'Anthropic', 'Stability AI', 'Luma AI', 'OpenAI', 'Google Gemini', 'Groq / Meta', 'Zhipu AI'].map(p => (
                        <button
                            key={p}
                            onClick={() => setSelectedProvider(p)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                                selectedProvider === p
                                    ? 'bg-secondary text-primary border-primary/40 font-semibold'
                                    : 'bg-transparent text-muted-foreground hover:text-foreground border-border/50'
                            }`}
                        >
                            {p === 'all' ? 'All Providers' : p}
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── BOXED MODELS UI (USER SPECIFIED: "ui use boxed with real names") ─── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredModels.map(model => {
                    const isBedrock = model.provider === 'AWS Bedrock';
                    const isPro = model.minTier === 'pro';
                    const isMax = model.minTier === 'max';

                    // Compute token capability text based on active user plan
                    const userTokenAllocation = model.modality === 'text'
                        ? `${quota.textTpm} on your ${activeTier.toUpperCase()} Plan`
                        : model.modality === 'image'
                            ? `${quota.imageLimit.split('(')[0].trim()} on ${activeTier.toUpperCase()}`
                            : model.modality === 'video'
                                ? (activeTier === 'free' ? 'Requires Pro / Max tier' : `${quota.videoLimit.split('(')[0].trim()} on ${activeTier.toUpperCase()}`)
                                : `${quota.dailyReq.split('/')[0].trim()} daily quota`;

                    return (
                        <div 
                            key={model.id}
                            className={`group rounded-xl border border-border/70 bg-card p-5 shadow-sm hover:shadow-xl hover:border-primary/50 transition-all duration-200 flex flex-col justify-between relative overflow-hidden ${
                                isBedrock ? 'ring-1 ring-orange-500/20' : ''
                            }`}
                        >
                            {/* Accent Glow */}
                            <div className="absolute top-0 right-0 h-24 w-24 bg-gradient-to-br from-primary/10 to-transparent rounded-bl-full pointer-events-none transition-all group-hover:scale-125" />

                            <div className="space-y-3.5 relative z-10">
                                
                                {/* Top Badges Row */}
                                <div className="flex items-center justify-between gap-2">
                                    <Badge variant="outline" className="text-[10px] font-mono tracking-wide uppercase px-2 py-0.5 border-border">
                                        {model.provider}
                                    </Badge>
                                    <div className="flex items-center gap-1.5">
                                        {isMax ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                                MAX TIER
                                            </span>
                                        ) : isPro ? (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                                                PRO TIER
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                                FREE TIER
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* REAL NAME BOXED (PROMINENT REAL NAME AS REQUESTED) */}
                                <div className="p-3 rounded-lg bg-secondary/80 border border-border/80 group-hover:border-primary/40 transition-colors">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                                        Real Upstream Model
                                    </div>
                                    <div className="text-base font-extrabold text-foreground tracking-tight mt-0.5 flex items-center justify-between">
                                        <span>{model.realName}</span>
                                    </div>
                                </div>

                                {/* Gateway Identifier Box */}
                                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background border border-border/60">
                                    <div>
                                        <div className="text-[10px] uppercase font-semibold text-muted-foreground">Gateway ID</div>
                                        <code className="text-xs font-mono font-bold text-orange-400">{model.id}</code>
                                    </div>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => copyText(model.id, 'Model ID')}
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        title="Copy Model ID"
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                </div>

                                {/* Description */}
                                <p className="text-xs text-muted-foreground leading-relaxed min-h-[36px]">
                                    {model.description}
                                </p>

                                {/* Technical Specs Grid (Boxed) */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="p-2 rounded bg-secondary/40 border border-border/40">
                                        <span className="text-[10px] text-muted-foreground font-medium block">Context Window</span>
                                        <span className="font-mono font-semibold text-foreground text-xs">{model.contextWindow}</span>
                                    </div>
                                    <div className="p-2 rounded bg-secondary/40 border border-border/40">
                                        <span className="text-[10px] text-muted-foreground font-medium block">Max Output</span>
                                        <span className="font-mono font-semibold text-foreground text-xs">{model.maxOutput}</span>
                                    </div>
                                </div>

                                {/* User Token Allocation Box */}
                                <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                                    <div className="text-[10px] font-semibold text-primary uppercase">Your Active Tier Quota</div>
                                    <div className="font-mono font-bold text-foreground text-[11px] mt-0.5">
                                        {userTokenAllocation}
                                    </div>
                                </div>

                                {/* Capabilities Tags */}
                                <div className="flex flex-wrap gap-1 pt-1">
                                    {model.capabilities.slice(0, 4).map(cap => (
                                        <span key={cap} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary text-muted-foreground">
                                            #{cap}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Bottom Card Actions */}
                            <div className="pt-4 mt-4 border-t border-border/60 flex items-center justify-between gap-2 relative z-10">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setSelectedSnippetModel(model);
                                        setSnippetModalOpen(true);
                                    }}
                                    className="w-1/2 text-xs h-8 border-border hover:bg-secondary font-medium"
                                >
                                    <Terminal className="h-3.5 w-3.5 mr-1 text-primary" />
                                    cURL / SDK
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        setSelectedPlaygroundModel(model);
                                        setPlaygroundPrompt(model.samplePrompt || '');
                                        setPlaygroundResponse(null);
                                        setPlaygroundModalOpen(true);
                                    }}
                                    className="w-1/2 text-xs h-8 bg-secondary hover:bg-primary hover:text-primary-foreground text-foreground border border-border/80 font-medium transition-colors"
                                >
                                    <Play className="h-3 w-3 mr-1" />
                                    Test Live
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ─── CREATE API KEY MODAL ─────────────────────────────────────── */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Key className="h-5 w-5 text-primary" />
                            Create AI Gateway API Key
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Generate a scoped Bearer token for accessing any Fluxbase AI Model via standard OpenAI SDKs or HTTP REST.
                        </DialogDescription>
                    </DialogHeader>

                    {!newGeneratedKey ? (
                        <div className="space-y-4 pt-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">Key Label / Name</label>
                                <Input
                                    placeholder="e.g. Cursor Assistant, Production App, Web Scraper"
                                    value={keyName}
                                    onChange={e => setKeyName(e.target.value)}
                                    className="text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">Project Scope</label>
                                <div className="p-2.5 rounded-lg border border-border bg-secondary text-xs">
                                    <div className="font-semibold text-foreground">{selectedProject?.display_name || 'Global Access'}</div>
                                    <div className="text-[11px] text-muted-foreground mt-0.5">
                                        Project ID: {selectedProject?.project_id || 'All accessible projects'}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">Permission Scopes</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setKeyScope('ai')}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            keyScope === 'ai'
                                                ? 'bg-primary/10 border-primary text-primary'
                                                : 'bg-secondary border-border text-muted-foreground'
                                        }`}
                                    >
                                        <div className="font-bold text-xs">AI Gateway Only</div>
                                        <div className="text-[10px] mt-0.5">Scopes: ai, read. Safest for frontend & IDEs.</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setKeyScope('full')}
                                        className={`p-3 rounded-lg border text-left transition-all ${
                                            keyScope === 'full'
                                                ? 'bg-primary/10 border-primary text-primary'
                                                : 'bg-secondary border-border text-muted-foreground'
                                        }`}
                                    >
                                        <div className="font-bold text-xs">Full Access</div>
                                        <div className="text-[10px] mt-0.5">Scopes: ai, read, write, admin. For backend services.</div>
                                    </button>
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end gap-2">
                                <Button variant="ghost" onClick={() => setCreateDialogOpen(false)} className="text-xs">
                                    Cancel
                                </Button>
                                <Button 
                                    onClick={handleCreateKey} 
                                    disabled={isCreatingKey}
                                    className="text-xs bg-primary hover:bg-primary/90"
                                >
                                    {isCreatingKey ? 'Generating...' : 'Generate API Key'}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4 pt-2">
                            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
                                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
                                <div>
                                    <div className="font-bold">Your API Key is Ready</div>
                                    <div className="text-[11px] mt-0.5">Copy this key now. For your security, it will not be displayed again.</div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground">Secret Key Token</label>
                                <div className="flex items-center gap-2">
                                    <code className="text-xs font-mono font-bold p-3 rounded-lg bg-secondary border border-border w-full break-all text-orange-400 select-all">
                                        {newGeneratedKey}
                                    </code>
                                    <Button
                                        size="icon"
                                        onClick={() => copyText(newGeneratedKey, 'Secret API Key')}
                                        className="h-10 w-10 shrink-0"
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end">
                                <Button 
                                    onClick={() => {
                                        setNewGeneratedKey(null);
                                        setCreateDialogOpen(false);
                                    }} 
                                    className="text-xs"
                                >
                                    Done
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ─── CODE SNIPPET DRAWER / MODAL ─────────────────────────────── */}
            <Dialog open={snippetModalOpen} onOpenChange={setSnippetModalOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Code2 className="h-5 w-5 text-primary" />
                                <span>Integration Code: {selectedSnippetModel?.label}</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground font-normal">
                                Real: {selectedSnippetModel?.realName}
                            </span>
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Drop-in OpenAI SDK integration. Set baseURL to <code className="font-mono text-primary">https://fluxbasedb.me/api/v1</code>.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedSnippetModel && (
                        <div className="space-y-4 pt-2">
                            {/* Language Switcher */}
                            <div className="flex items-center justify-between border-b border-border pb-2">
                                <div className="flex bg-secondary p-1 rounded-lg border border-border text-xs">
                                    <button
                                        onClick={() => setSnippetLang('curl')}
                                        className={`px-3 py-1 rounded text-xs font-semibold transition-all ${snippetLang === 'curl' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                                    >
                                        cURL (REST)
                                    </button>
                                    <button
                                        onClick={() => setSnippetLang('python')}
                                        className={`px-3 py-1 rounded text-xs font-semibold transition-all ${snippetLang === 'python' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                                    >
                                        Python (OpenAI SDK)
                                    </button>
                                    <button
                                        onClick={() => setSnippetLang('node')}
                                        className={`px-3 py-1 rounded text-xs font-semibold transition-all ${snippetLang === 'node' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                                    >
                                        TypeScript / Node.js
                                    </button>
                                </div>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copyText(getSnippetCode(selectedSnippetModel, snippetLang), 'Code Snippet')}
                                    className="text-xs h-7"
                                >
                                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                                    Copy Snippet
                                </Button>
                            </div>

                            {/* Snippet Display */}
                            <div className="relative rounded-lg bg-zinc-950 p-4 border border-zinc-800 text-xs font-mono overflow-x-auto max-h-96">
                                <pre className="text-zinc-200 leading-relaxed">
                                    {getSnippetCode(selectedSnippetModel, snippetLang)}
                                </pre>
                            </div>

                            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                                <span>Upstream Provider: <strong>{selectedSnippetModel.provider}</strong></span>
                                <span>Context Window: <strong>{selectedSnippetModel.contextWindow}</strong></span>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ─── LIVE PLAYGROUND MODAL ─────────────────────────────────────── */}
            <Dialog open={playgroundModalOpen} onOpenChange={setPlaygroundModalOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Play className="h-5 w-5 text-orange-400" />
                                <span>Test Model: {selectedPlaygroundModel?.label}</span>
                            </div>
                            <Badge variant="outline" className="text-xs font-mono">
                                {selectedPlaygroundModel?.realName}
                            </Badge>
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Send an interactive prompt directly through the AI Gateway.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedPlaygroundModel && (
                        <div className="space-y-4 pt-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">Prompt</label>
                                <textarea
                                    rows={3}
                                    value={playgroundPrompt}
                                    onChange={e => setPlaygroundPrompt(e.target.value)}
                                    placeholder="Enter your prompt here..."
                                    className="w-full text-xs font-mono p-3 rounded-lg border border-border bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>

                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    onClick={handleRunPlayground}
                                    disabled={isPlaying || !playgroundPrompt.trim()}
                                    className="bg-primary hover:bg-primary/90 text-xs"
                                >
                                    {isPlaying ? (
                                        <>
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                            Executing...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="h-3.5 w-3.5 mr-1.5" />
                                            Run Prompt
                                        </>
                                    )}
                                </Button>
                            </div>

                            {/* Response Box */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-muted-foreground">Response Output</label>
                                <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-4 min-h-[140px] max-h-80 overflow-y-auto text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                                    {isPlaying ? (
                                        <div className="flex items-center text-muted-foreground gap-2">
                                            <RefreshCw className="h-4 w-4 animate-spin text-orange-400" />
                                            Streaming response from {selectedPlaygroundModel.realName}...
                                        </div>
                                    ) : playgroundResponse ? (
                                        playgroundResponse.startsWith('IMAGE_GENERATED: ') ? (
                                            <div className="space-y-2">
                                                <div className="text-emerald-400 font-bold">Image Generated Successfully!</div>
                                                <img 
                                                    src={playgroundResponse.replace('IMAGE_GENERATED: ', '')} 
                                                    alt="Generated Output" 
                                                    className="rounded-lg max-h-64 object-cover border border-zinc-700" 
                                                />
                                            </div>
                                        ) : (
                                            playgroundResponse
                                        )
                                    ) : (
                                        <span className="text-zinc-600">Click &quot;Run Prompt&quot; to test this model.</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

        </div>
    );
}
