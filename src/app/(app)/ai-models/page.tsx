'use client';

import React, { useState, useEffect, useContext, useMemo } from 'react';
import { ProjectContext } from '@/contexts/project-context';
import { 
    Infinity as InfinityIcon, Key, Copy, Check, Search, Shield, Zap, 
    Bot, Cpu, Image as ImageIcon, Video, Mic, Volume2, 
    Database, ExternalLink, RefreshCw, Plus, Trash2, 
    Code2, Play, Terminal, ArrowUpRight, CheckCircle2,
    Layers, AlertCircle, Info, Sliders, ChevronDown, X
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

export type IllustrationType = 
    | 'brain-head' 
    | 'cursor-node' 
    | 'cluster-burst' 
    | 'soaring-bird' 
    | 'palette-canvas' 
    | 'film-motion' 
    | 'vector-cube' 
    | 'vision-eye' 
    | 'audio-wave';

export interface ModelCardData {
    id: string;
    realName: string;
    provider: string;
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
    // Two-tone card layout properties
    bannerColor: string;
    illustrationType: IllustrationType;
    badgeText?: string;
    workTags: string[];
}

// ─── Inline Vector Illustrations ───────────────────────────────────────────

function IllustrationBrainHead({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Profile head silhouette */}
            <path d="M 32 86 C 32 78 30 70 28 62 C 24 48 30 25 52 20 C 72 16 82 30 80 48 C 79 56 75 62 76 68 C 77 74 81 78 81 86" strokeWidth="2.6" />
            {/* Neural network nodes */}
            <circle cx="50" cy="36" r="3.5" fill="#141824" />
            <circle cx="64" cy="42" r="3.5" fill="#141824" />
            <circle cx="44" cy="50" r="3" fill="#141824" />
            <circle cx="58" cy="58" r="3" fill="#141824" />
            <circle cx="48" cy="68" r="2.5" fill="#141824" />
            {/* Interconnections */}
            <line x1="50" y1="36" x2="64" y2="42" />
            <line x1="50" y1="36" x2="44" y2="50" />
            <line x1="64" y1="42" x2="58" y2="58" />
            <line x1="44" y1="50" x2="58" y2="58" />
            <line x1="44" y1="50" x2="48" y2="68" />
            <line x1="58" y1="58" x2="48" y2="68" />
            {/* Radiance */}
            <path d="M 39 17 Q 45 11 53 13" strokeDasharray="2 3" />
            <path d="M 61 15 Q 67 11 74 16" strokeDasharray="2 3" />
        </svg>
    );
}

function IllustrationCursorNode({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Network branch lines */}
            <line x1="46" y1="46" x2="74" y2="28" />
            <line x1="46" y1="46" x2="79" y2="50" />
            <line x1="46" y1="46" x2="72" y2="74" />
            {/* Target nodes */}
            <circle cx="74" cy="28" r="4.5" fill="#141824" />
            <circle cx="79" cy="50" r="4" fill="#141824" />
            <circle cx="72" cy="74" r="4" fill="#141824" />
            {/* Active center node */}
            <circle cx="46" cy="46" r="7" strokeWidth="2" />
            <circle cx="46" cy="46" r="3.5" fill="#141824" />
            {/* Cursor arrow pointing at node */}
            <path d="M 22 70 L 22 28 L 38 44 L 50 44 Z" fill="#141824" stroke="#141824" strokeWidth="2" />
            <line x1="33" y1="40" x2="41" y2="54" stroke="#ffffff" strokeWidth="2.5" />
        </svg>
    );
}

function IllustrationClusterBurst({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Center nucleus */}
            <circle cx="50" cy="50" r="5" fill="#141824" />
            <circle cx="50" cy="50" r="11" strokeDasharray="3 3" />
            {/* Radial spokes */}
            <line x1="50" y1="50" x2="30" y2="30" />
            <line x1="50" y1="50" x2="70" y2="32" />
            <line x1="50" y1="50" x2="76" y2="60" />
            <line x1="50" y1="50" x2="52" y2="76" />
            <line x1="50" y1="50" x2="26" y2="64" />
            <line x1="50" y1="50" x2="48" y2="24" />
            {/* Orbital nodes */}
            <circle cx="30" cy="30" r="3.5" fill="#141824" />
            <circle cx="70" cy="32" r="4" fill="#141824" />
            <circle cx="76" cy="60" r="3.5" fill="#141824" />
            <circle cx="52" cy="76" r="4" fill="#141824" />
            <circle cx="26" cy="64" r="3" fill="#141824" />
            <circle cx="48" cy="24" r="3.5" fill="#141824" />
            {/* Cross links */}
            <line x1="30" y1="30" x2="48" y2="24" strokeDasharray="2 3" />
            <line x1="70" y1="32" x2="76" y2="60" strokeDasharray="2 3" />
            <line x1="76" y1="60" x2="52" y2="76" strokeDasharray="2 3" />
            <line x1="26" y1="64" x2="30" y2="30" strokeDasharray="2 3" />
        </svg>
    );
}

function IllustrationSoaringBird({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Geometric soaring bird */}
            <path d="M 22 55 L 45 42 L 78 24 L 60 52 L 80 62 L 50 60 L 38 74 L 38 60 Z" />
            <line x1="45" y1="42" x2="50" y2="60" />
            <line x1="45" y1="42" x2="60" y2="52" />
            {/* Node vertices */}
            <circle cx="22" cy="55" r="3" fill="#141824" />
            <circle cx="78" cy="24" r="3.5" fill="#141824" />
            <circle cx="80" cy="62" r="3" fill="#141824" />
            <circle cx="38" cy="74" r="2.5" fill="#141824" />
            {/* Speed trails */}
            <line x1="16" y1="64" x2="26" y2="64" strokeDasharray="3 3" />
            <line x1="12" y1="72" x2="28" y2="72" strokeDasharray="3 3" />
        </svg>
    );
}

function IllustrationPaletteCanvas({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Palette contour */}
            <path d="M 50 20 C 30 20 20 34 20 54 C 20 74 36 82 52 82 C 60 82 66 78 68 72 C 70 66 76 64 82 66 C 86 67 90 64 90 58 C 90 36 74 20 50 20 Z" />
            {/* Color swatches */}
            <circle cx="36" cy="38" r="4" fill="#141824" />
            <circle cx="52" cy="34" r="4" fill="#141824" />
            <circle cx="68" cy="42" r="4" fill="#141824" />
            <circle cx="36" cy="56" r="3.5" fill="#141824" />
            {/* Thumb aperture */}
            <circle cx="72" cy="56" r="5" />
            {/* Sparkle */}
            <path d="M 82 24 L 84 18 L 86 24 L 92 26 L 86 28 L 84 34 L 82 28 L 76 26 Z" fill="#141824" stroke="none" />
        </svg>
    );
}

function IllustrationFilmMotion({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Film slate frame */}
            <rect x="22" y="30" width="56" height="44" rx="6" />
            {/* Film sprockets */}
            <circle cx="30" cy="38" r="2.5" fill="#141824" />
            <circle cx="42" cy="38" r="2.5" fill="#141824" />
            <circle cx="30" cy="66" r="2.5" fill="#141824" />
            <circle cx="42" cy="66" r="2.5" fill="#141824" />
            {/* Play triangle */}
            <polygon points="50,44 64,52 50,60" fill="#141824" stroke="#141824" strokeWidth="2" strokeLinejoin="round" />
            {/* Camera motion waves */}
            <path d="M 84 38 Q 88 52 84 66" />
            <path d="M 89 34 Q 94 52 89 70" strokeDasharray="3 3" />
        </svg>
    );
}

function IllustrationVectorCube({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Isometric 3D cube */}
            <polygon points="50,22 80,38 50,54 20,38" />
            <polygon points="20,38 50,54 50,84 20,68" />
            <polygon points="80,38 50,54 50,84 80,68" />
            {/* Coordinate vertices */}
            <circle cx="50" cy="22" r="3.5" fill="#141824" />
            <circle cx="80" cy="38" r="3.5" fill="#141824" />
            <circle cx="20" cy="38" r="3.5" fill="#141824" />
            <circle cx="50" cy="54" r="4.5" fill="#141824" />
            <circle cx="50" cy="84" r="3.5" fill="#141824" />
            {/* Internal lattice points */}
            <circle cx="35" cy="46" r="2" fill="#141824" />
            <circle cx="65" cy="46" r="2" fill="#141824" />
            <circle cx="50" cy="38" r="2" fill="#141824" />
        </svg>
    );
}

function IllustrationVisionEye({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Focus reticle brackets */}
            <path d="M 22 36 L 22 26 L 32 26" />
            <path d="M 78 36 L 78 26 L 68 26" />
            <path d="M 22 64 L 22 74 L 32 74" />
            <path d="M 78 64 L 78 74 L 68 74" />
            {/* Eye contour */}
            <path d="M 24 50 C 34 36 66 36 76 50 C 66 64 34 64 24 50 Z" />
            {/* Iris & pupil */}
            <circle cx="50" cy="50" r="9" />
            <circle cx="50" cy="50" r="4" fill="#141824" />
            <circle cx="47" cy="47" r="1.5" fill="#ffffff" />
        </svg>
    );
}

function IllustrationAudioWave({ className = "w-24 h-24" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" stroke="#141824" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {/* Audio waveform vertical bars */}
            <line x1="22" y1="46" x2="22" y2="54" strokeWidth="3" />
            <line x1="30" y1="38" x2="30" y2="62" strokeWidth="3" />
            <line x1="38" y1="28" x2="38" y2="72" strokeWidth="3" />
            <line x1="46" y1="22" x2="46" y2="78" strokeWidth="3.5" />
            <line x1="54" y1="22" x2="54" y2="78" strokeWidth="3.5" />
            <line x1="62" y1="32" x2="62" y2="68" strokeWidth="3" />
            <line x1="70" y1="40" x2="70" y2="60" strokeWidth="3" />
            <line x1="78" y1="46" x2="78" y2="54" strokeWidth="3" />
            {/* Frequency guideline */}
            <line x1="16" y1="50" x2="84" y2="50" strokeDasharray="2 4" strokeWidth="1" />
        </svg>
    );
}

function ModelIllustration({ type, className }: { type: IllustrationType; className?: string }) {
    switch (type) {
        case 'brain-head': return <IllustrationBrainHead className={className} />;
        case 'cursor-node': return <IllustrationCursorNode className={className} />;
        case 'cluster-burst': return <IllustrationClusterBurst className={className} />;
        case 'soaring-bird': return <IllustrationSoaringBird className={className} />;
        case 'palette-canvas': return <IllustrationPaletteCanvas className={className} />;
        case 'film-motion': return <IllustrationFilmMotion className={className} />;
        case 'vector-cube': return <IllustrationVectorCube className={className} />;
        case 'vision-eye': return <IllustrationVisionEye className={className} />;
        case 'audio-wave': return <IllustrationAudioWave className={className} />;
        default: return <IllustrationBrainHead className={className} />;
    }
}

// ─── COMPLETE CATALOG: FREE & TOP MODELS FIRST (NO CLAUDE) ─────────────────

const MODEL_CATALOG: ModelCardData[] = [
    // 1. Flux Pro (Frontier High-Precision Intelligence)
    {
        id: 'flux-pro',
        realName: 'Flux Pro Neural Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Pro',
        description: 'Frontier intelligence for schema architecture, data modeling, multi-table analysis, and strict JSON output.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Frontier Reasoning',
        minTier: 'free',
        capabilities: ['multimodal', 'vision', 'tool-calling', 'json-mode', 'coding'],
        aliases: ['flux-pro', 'pro'],
        samplePrompt: 'Analyze this distributed system architecture and suggest failure recovery mechanisms.',
        bannerColor: '#7aa7e8', // Soft Sky Blue
        illustrationType: 'brain-head',
        badgeText: 'Flagship',
        workTags: ['Most capable', 'Research', 'Multi-day tasks', 'Coding']
    },
    // 2. Flux Lite (High Velocity Intelligence)
    {
        id: 'flux-lite',
        realName: 'Flux Lite High-Velocity Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Lite',
        description: 'Ultra-fast multimodal reasoning, high-throughput interactive processing, and real-time generation.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Sub-200ms First Token',
        minTier: 'free',
        capabilities: ['hyper-fast', 'multimodal', 'chat', 'tool-calling'],
        aliases: ['flux-lite', 'lite'],
        samplePrompt: 'Summarize the core benefits of edge caching over origin database read replicas.',
        bannerColor: '#f08c73', // Warm Coral / Peach
        illustrationType: 'cursor-node',
        badgeText: 'Fastest',
        workTags: ['Complex projects', 'Agents', 'Interactive UX']
    },
    // 3. Flux Standard (Default Workhorse)
    {
        id: 'flux',
        realName: 'Flux Standard Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Standard',
        description: 'High-accuracy general reasoning, precision SQL query generation, and conversational code intelligence.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Sub-150ms First Token',
        minTier: 'free',
        capabilities: ['general-reasoning', 'sql-synthesis', 'tool-calling', 'json-mode'],
        aliases: ['default', 'flux-v4'],
        samplePrompt: 'Write a SQL query using window functions to calculate 7-day rolling revenue per customer.',
        bannerColor: '#ebe4d3', // Warm Ivory / Sand Cream
        illustrationType: 'cluster-burst',
        badgeText: 'Top Free',
        workTags: ['Everyday tasks', 'Writing', 'Cost-efficient', 'SQL']
    },
    // 4. Flux Micro (Ultra-Low Latency)
    {
        id: 'flux-micro',
        realName: 'Flux Micro Ultra-Low Latency',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Micro',
        description: 'Lowest latency text intelligence engineered for extreme throughput and real-time agents.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Lowest Latency',
        minTier: 'free',
        capabilities: ['lowest-latency', 'high-throughput', 'agents', 'real-time'],
        aliases: ['flux-micro', 'micro'],
        samplePrompt: 'Validate and normalize this international telephone number string format.',
        bannerColor: '#96c8b0', // Mint / Soft Sage
        illustrationType: 'soaring-bird',
        badgeText: 'Lowest Cost',
        workTags: ['Fastest', 'Lowest cost', 'High volume']
    },
    // 5. Flux Image Fast (Fast AI Image Generation)
    {
        id: 'flux-image-fast',
        realName: 'Flux Image Fast Engine',
        provider: 'Flux AI',
        modality: 'image',
        label: 'Flux Image Fast',
        description: 'Ultra-fast low-latency image generation designed for user avatars, blog thumbnails, and rapid prototyping.',
        contextWindow: 'N/A (Image)',
        maxOutput: '1024x1024',
        speedRating: 'Sub-2s Fast Gen',
        minTier: 'free',
        capabilities: ['ultra-fast', 'thumbnails', 's3-auto-storage'],
        aliases: ['dall-e-2'],
        samplePrompt: 'Modern minimalist logo for a high-performance database startup, vector style.',
        bannerColor: '#b8a4f0', // Soft Lavender Lilac
        illustrationType: 'palette-canvas',
        badgeText: 'Instant Gen',
        workTags: ['Image synthesis', 'Avatars', 'Rapid prototyping']
    },
    // 6. Flux Image (High Definition Image Generation)
    {
        id: 'flux-image',
        realName: 'Flux Image HD Engine',
        provider: 'Flux AI',
        modality: 'image',
        label: 'Flux Image',
        description: 'High-quality photorealistic text-to-image synthesis with fast rendering and direct cloud asset delivery.',
        contextWindow: 'N/A (Image)',
        maxOutput: '1024x1024',
        speedRating: 'Fast 1024x1024',
        minTier: 'free',
        capabilities: ['photorealistic', 's3-auto-storage', 'fast'],
        aliases: ['cogview-4', 'cogview-3-flash'],
        samplePrompt: 'Futuristic cybernetic database server room with glowing orange neon conduits, cinematic 8k photorealistic.',
        bannerColor: '#ebd475',
        illustrationType: 'palette-canvas',
        badgeText: 'HD Image',
        workTags: ['General illustration', 'Logos', 'S3 cloud storage']
    },
    // 7. Flux Video (Fast AI Motion Video)
    {
        id: 'flux-video',
        realName: 'Flux Video Motion Engine',
        provider: 'Flux AI',
        modality: 'video',
        label: 'Flux Video',
        description: 'Text-to-video generation with dynamic lighting and camera pans. Dispatched via asynchronous task IDs.',
        contextWindow: 'N/A (Video)',
        maxOutput: '720p MP4 (5-10s)',
        speedRating: 'Fast Async Video',
        minTier: 'free',
        capabilities: ['text-to-video', 'async-polling', 's3-auto-storage'],
        aliases: ['cogvideox-flash'],
        samplePrompt: 'Time-lapse of clouds racing over a bustling modern skyscraper city at sunset.',
        bannerColor: '#f2b372', // Warm Apricot / Amber
        illustrationType: 'film-motion',
        badgeText: 'AI Video',
        workTags: ['Video generation', 'Dynamic motion', 'Camera pans']
    },
    // 8. Flux Embed (Vector Embeddings)
    {
        id: 'flux-embed',
        realName: 'Flux Dense Vector Embeddings',
        provider: 'Flux AI',
        modality: 'embedding',
        label: 'Flux Embed',
        description: '1024-dimensional dense vector embeddings with flexible output dimensions for semantic search and RAG retrieval.',
        contextWindow: '8,192 tokens',
        maxOutput: '1024-dim Vector Float[]',
        speedRating: 'Sub-50ms Fast Vector',
        minTier: 'free',
        capabilities: ['semantic-search', 'rag-retrieval', 'vector-index', '1024-dim'],
        aliases: ['text-embedding-3-small', 'text-embedding-004', 'amazon.titan-embed-text-v2:0'],
        samplePrompt: 'Generate embedding vector for documentation semantic search index.',
        bannerColor: '#7ec9dc', // Azure Cyan
        illustrationType: 'vector-cube',
        badgeText: 'Vector RAG',
        workTags: ['Semantic search', 'RAG retrieval', 'Vector index']
    },
    // 9. Flux Vision (Vision & OCR)
    {
        id: 'flux-vision',
        realName: 'Flux Vision OCR Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Vision',
        description: 'High-speed visual comprehension, diagram recognition, screenshot-to-code, and receipt inspection.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Fast Multimodal',
        minTier: 'free',
        capabilities: ['vision-ocr', 'screenshot-to-code', 'diagram-analysis'],
        samplePrompt: 'Extract table columns and data types from this database diagram screenshot.',
        bannerColor: '#ebd06a', // Golden Honey
        illustrationType: 'vision-eye',
        badgeText: 'Vision OCR',
        workTags: ['Visual inspection', 'Diagram analysis', 'OCR']
    },
    // 10. Flux Flash (Turbo UX)
    {
        id: 'flux-flash',
        realName: 'Flux Flash Turbo UX',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Flash',
        description: 'Sub-100ms token throughput optimized for code autocomplete, real-time streaming, and interactive widgets.',
        contextWindow: '128,000 tokens',
        maxOutput: '4,096 tokens',
        speedRating: 'Sub-100ms Low Latency',
        minTier: 'free',
        capabilities: ['real-time-ux', 'autocomplete', 'streaming', 'lightweight'],
        aliases: ['fast-chat'],
        samplePrompt: 'Autocomplete this JavaScript debounce utility function.',
        bannerColor: '#e6dec8',
        illustrationType: 'cursor-node',
        badgeText: 'Sub-100ms',
        workTags: ['Autocomplete', 'Real-time UX', 'Streaming']
    },
    // 11. Flux 5.2 (Frontier Agent)
    {
        id: 'flux-5.2',
        realName: 'Flux 5.2 Agentic Reasoning Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux 5.2',
        description: 'Specialized reasoning architecture engineered for multi-step agentic tool execution and recursive problem solving.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Fast Agentic',
        minTier: 'free',
        capabilities: ['agentic-execution', 'multi-step-tools', 'complex-reasoning', 'coding'],
        aliases: ['agent-v5', 'flux-5.2'],
        samplePrompt: 'Create a complete multi-step migration script that refactors table schema with rollback handling.',
        bannerColor: '#a7b8e8',
        illustrationType: 'cursor-node',
        badgeText: 'Agentic',
        workTags: ['Recursive reasoning', 'Multi-tool', 'Workflows', 'Autonomous']
    },
    // 12. Flux Ultra (Deep Reasoning)
    {
        id: 'flux-ultra',
        realName: 'Flux Ultra Deep Cognitive Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Ultra',
        description: 'Maximum cognitive depth for database architectural blueprints, complex migrations, and audit trails.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Deep Analysis',
        minTier: 'free',
        capabilities: ['architectural-design', 'deep-verification', 'long-chain-thought', 'coding'],
        aliases: ['flux-ultra'],
        samplePrompt: 'Analyze this multi-tenant database schema for potential connection pool exhaustion vulnerabilities.',
        bannerColor: '#d1b0ea',
        illustrationType: 'brain-head',
        badgeText: 'Deep Thought',
        workTags: ['Architecture blueprints', 'Security audits', 'Migrations', 'Deep analysis']
    },
    // 13. Flux Video Pro (Motion Video)
    {
        id: 'flux-video-pro',
        realName: 'Flux Video Motion Pro Engine',
        provider: 'Flux AI',
        modality: 'video',
        label: 'Flux Video Pro',
        description: 'Cinematic dynamic video generation with high fidelity, rich motion dynamics, and crisp textures.',
        contextWindow: 'N/A (Video)',
        maxOutput: '720p HD MP4',
        speedRating: 'Fast Async Video',
        minTier: 'free',
        capabilities: ['dynamic-motion', 'motion-stability', 'async-polling'],
        aliases: ['cogvideox-flash', 'flux-video-pro'],
        samplePrompt: 'Slow motion macro shot of water droplets splashing onto a shiny obsidian stone.',
        bannerColor: '#83cbe3',
        illustrationType: 'film-motion',
        badgeText: 'Motion Pro',
        workTags: ['Dynamic motion', 'Macro motion', 'Free Tier']
    },
    // 14. Flux Turbo (Hyper-Speed)
    {
        id: 'flux-turbo',
        realName: 'Flux Turbo Hyper-Speed Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Turbo',
        description: 'Hyper-speed 300+ tokens/second inference engine for high-velocity streaming and low-latency interaction.',
        contextWindow: '128,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: '300+ TPS',
        minTier: 'free',
        capabilities: ['hyper-speed', 'low-latency', 'chat', 'fast'],
        aliases: ['flux-turbo'],
        samplePrompt: 'Write a fast debounce implementation in TypeScript.',
        bannerColor: '#f7c28b',
        illustrationType: 'cursor-node',
        badgeText: '300+ TPS',
        workTags: ['Hyper-speed', '300+ TPS', 'Low latency']
    },
    // 15. Flux Omni (Multimodal Intelligence)
    {
        id: 'flux-omni',
        realName: 'Flux Omni Multimodal Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Omni',
        description: 'Massive context window, multimodal vision understanding, and high-velocity document comprehension.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Multimodal',
        minTier: 'free',
        capabilities: ['multimodal', 'vision', 'documents', 'chat'],
        aliases: ['flux-omni'],
        samplePrompt: 'Analyze this architecture diagram and explain the data flow.',
        bannerColor: '#8ecae6',
        illustrationType: 'vision-eye',
        badgeText: 'Multimodal',
        workTags: ['Multimodal', 'Vision', 'Documents', 'Fast']
    },
    // 16. Flux Max (Flagship Intelligence)
    {
        id: 'flux-max',
        realName: 'Flux Max Flagship Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'Flux Max',
        description: 'Flagship reasoning, robust coding benchmarks, and advanced instruction following.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Flagship',
        minTier: 'free',
        capabilities: ['flagship', 'coding', 'reasoning', 'instruction-following'],
        aliases: ['flux-max'],
        samplePrompt: 'Refactor this database connection pool for optimal concurrency and zero leaks.',
        bannerColor: '#ffb703',
        illustrationType: 'brain-head',
        badgeText: 'Flagship',
        workTags: ['Flagship reasoning', 'Coding benchmarks', 'Instruction following']
    },
    // 17. OpenAI GPT-4o Drop-in Alias
    {
        id: 'gpt-4o',
        realName: 'Flux Drop-in Compatibility Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'GPT-4o Drop-in',
        description: 'OpenAI compatibility alias. Transparently served by the Flux Neural Engine with zero code modifications.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Flagship Drop-in',
        minTier: 'free',
        capabilities: ['openai-drop-in', 'chat', 'coding', 'vision'],
        isDropinAlias: true,
        samplePrompt: 'Write a Next.js App Router API route with session verification.',
        bannerColor: '#98d9ba',
        illustrationType: 'brain-head',
        badgeText: 'Drop-In',
        workTags: ['Drop-in OpenAI', 'Zero config', 'Compatibility']
    },
    // 18. OpenAI GPT-4o Mini Drop-in Alias
    {
        id: 'gpt-4o-mini',
        realName: 'Flux Mini Compatibility Engine',
        provider: 'Flux AI',
        modality: 'text',
        label: 'GPT-4o Mini Drop-in',
        description: 'OpenAI compatibility alias. Transparently served by Flux Lite at sub-200ms velocity.',
        contextWindow: '300,000 tokens',
        maxOutput: '8,192 tokens',
        speedRating: 'Sub-200ms Drop-in',
        minTier: 'free',
        capabilities: ['openai-drop-in', 'chat', 'fast', 'json-mode'],
        isDropinAlias: true,
        samplePrompt: 'Summarize the differences between optimistic and pessimistic locking in SQL.',
        bannerColor: '#7ed4ad',
        illustrationType: 'cursor-node',
        badgeText: 'Drop-In',
        workTags: ['Drop-in OpenAI', 'Sub-200ms', 'JSON Mode']
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

    // Playground Modal
    const [playgroundModalOpen, setPlaygroundModalOpen] = useState(false);
    const [selectedPlaygroundModel, setSelectedPlaygroundModel] = useState<ModelCardData | null>(null);
    const [playgroundPrompt, setPlaygroundPrompt] = useState('');
    const [playgroundResponse, setPlaygroundResponse] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    // Compare Models Modal
    const [compareModalOpen, setCompareModalOpen] = useState(false);

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
                const matchLabel = m.label.toLowerCase().includes(q);
                const matchDesc = m.description.toLowerCase().includes(q);
                const matchCap = m.capabilities.some(c => c.toLowerCase().includes(q));
                const matchTags = m.workTags.some(t => t.toLowerCase().includes(q));
                const matchAlias = m.aliases?.some(a => a.toLowerCase().includes(q));
                if (!matchId && !matchReal && !matchLabel && !matchDesc && !matchCap && !matchTags && !matchAlias) return false;
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

        if (model.modality === 'embedding') {
            if (lang === 'curl') {
                return `curl -X POST https://fluxbasedb.me/api/v1/embeddings \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "input": "${model.samplePrompt || 'Generate embedding vector for semantic search'}"
  }'`;
            }
            if (lang === 'python') {
                return `from openai import OpenAI

client = OpenAI(
    base_url="https://fluxbasedb.me/api/v1",
    api_key="${key}"
)

response = client.embeddings.create(
    model="${model.id}",
    input="${model.samplePrompt || 'Generate embedding vector for semantic search'}"
)

print("Flux Embedding Vector (1024-dim):", response.data[0].embedding[:5], "... len:", len(response.data[0].embedding))`;
            }
            return `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://fluxbasedb.me/api/v1',
  apiKey: process.env.FLUXBASE_API_KEY || '${key}',
});

async function main() {
  const res = await client.embeddings.create({
    model: '${model.id}',
    input: '${model.samplePrompt || 'Generate embedding vector for semantic search'}',
  });
  console.log('Embedding dimensions:', res.data[0].embedding.length);
}
main();`;
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
            if (selectedPlaygroundModel.modality === 'image') {
                const res = await fetch('/api/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(selectedProject ? { 'X-Project-Id': selectedProject.project_id } : {})
                    },
                    body: JSON.stringify({
                        model: selectedPlaygroundModel.id,
                        prompt: playgroundPrompt
                    })
                });
                const data = await res.json();
                if (data.data?.[0]?.url) {
                    setPlaygroundResponse(`IMAGE_GENERATED: ${data.data[0].url}`);
                } else if (data.error) {
                    setPlaygroundResponse(`Error: ${data.error.message || JSON.stringify(data.error)}`);
                } else {
                    setPlaygroundResponse(JSON.stringify(data, null, 2));
                }
            } else if (selectedPlaygroundModel.modality === 'embedding') {
                const res = await fetch('/api/v1/embeddings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(selectedProject ? { 'X-Project-Id': selectedProject.project_id } : {})
                    },
                    body: JSON.stringify({
                        model: selectedPlaygroundModel.id,
                        input: playgroundPrompt
                    })
                });
                const data = await res.json();
                if (data.data?.[0]?.embedding) {
                    const emb = data.data[0].embedding;
                    const preview = emb.slice(0, 8).map((n: number) => n.toFixed(5)).join(', ');
                    setPlaygroundResponse(`✓ Vector Embedding Generated Successfully!\n• Dimensions: ${emb.length} floats\n• Model: ${data.model || selectedPlaygroundModel.id}\n• Prompt Tokens: ${data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 'N/A'}\n\nVector Preview:\n[${preview}, ... +${emb.length - 8} more floats]`);
                } else if (data.error) {
                    setPlaygroundResponse(`Error: ${data.error.message || JSON.stringify(data.error)}`);
                } else {
                    setPlaygroundResponse(JSON.stringify(data, null, 2));
                }
            } else if (selectedPlaygroundModel.modality === 'video') {
                const res = await fetch('/api/v1/videos/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(selectedProject ? { 'X-Project-Id': selectedProject.project_id } : {})
                    },
                    body: JSON.stringify({
                        model: selectedPlaygroundModel.id,
                        prompt: playgroundPrompt
                    })
                });
                const data = await res.json();
                if (data.id && (data.status === 'processing' || data.poll_url)) {
                    const taskId = data.id;
                    const pollUrl = data.poll_url || `/api/v1/videos/generations/${taskId}`;
                    setPlaygroundResponse(`✓ Video Task Dispatched (${taskId})\n⏳ Rendering motion video with ${selectedPlaygroundModel.realName}...\nPlease wait while video frames are synthesized.`);

                    // Live Polling Loop
                    let attempts = 0;
                    const maxAttempts = 60; // Up to ~4 mins
                    let videoUrl: string | null = null;
                    let pollError: string | null = null;

                    while (attempts < maxAttempts) {
                        await new Promise(r => setTimeout(r, 4000));
                        attempts++;

                        try {
                            const pollRes = await fetch(pollUrl, {
                                headers: {
                                    ...(selectedProject ? { 'X-Project-Id': selectedProject.project_id } : {})
                                }
                            });
                            const pollData = await pollRes.json();

                            if (pollData.status === 'completed' && pollData.data?.[0]?.url) {
                                videoUrl = pollData.data[0].url;
                                break;
                            } else if (pollData.status === 'failed') {
                                pollError = pollData.error || 'Video generation failed upstream.';
                                break;
                            } else {
                                setPlaygroundResponse(`⏳ Rendering motion video with ${selectedPlaygroundModel.realName}...\n• Elapsed: ${attempts * 4}s\n• Task ID: ${taskId}\n• Status: ${pollData.status || 'processing'}\n\nFrames are synthesizing in the GPU cluster. Your video will appear here automatically.`);
                            }
                        } catch (err: any) {
                            console.warn('[Playground] Video poll tick failed:', err);
                        }
                    }

                    if (videoUrl) {
                        setPlaygroundResponse(`VIDEO_GENERATED: ${videoUrl}`);
                    } else if (pollError) {
                        setPlaygroundResponse(`Video Generation Error: ${pollError}`);
                    } else {
                        setPlaygroundResponse(`Video is still rendering in the background (Task ID: ${taskId}). You can check back shortly or poll ${pollUrl}.`);
                    }
                } else if (data.error) {
                    setPlaygroundResponse(`Error: ${data.error.message || JSON.stringify(data.error)}`);
                } else {
                    setPlaygroundResponse(JSON.stringify(data, null, 2));
                }
            } else {
                // Text / Chat
                const res = await fetch('/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(selectedProject ? { 'X-Project-Id': selectedProject.project_id } : {})
                    },
                    body: JSON.stringify({
                        model: selectedPlaygroundModel.id,
                        messages: [{ role: 'user', content: playgroundPrompt }]
                    })
                });
                const data = await res.json();
                if (data.choices?.[0]?.message?.content) {
                    setPlaygroundResponse(data.choices[0].message.content);
                } else if (data.error) {
                    setPlaygroundResponse(`Error: ${data.error.message || JSON.stringify(data.error)}`);
                } else {
                    setPlaygroundResponse(JSON.stringify(data, null, 2));
                }
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
                            <InfinityIcon className="h-3.5 w-3.5" />
                            Universal Multimodal Gateway • OpenAI-Compatible
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
                            <span className="flex items-center justify-center h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-500 shadow-md shadow-orange-500/10 shrink-0">
                                <InfinityIcon className="h-6 w-6" />
                            </span>
                            <span>AI Models & Gateway Registry</span>
                        </h1>
                        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base leading-relaxed">
                            Access top-tier frontier intelligence across 6 modalities with unified OpenAI SDK compatibility. 
                            Direct high-performance neural engine routing with zero middleware latency.
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
                        <div className="text-xl font-bold text-foreground mt-0.5">{MODEL_CATALOG.length} Registered</div>
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

            {/* ─── YOUR TIER & TOKEN QUOTAS BANNER ─────────────────────────────── */}
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
                        <div className="text-[11px] text-muted-foreground mt-0.5">Flux Listen STT + Neural TTS</div>
                    </div>
                </div>

                {activeTier === 'free' && (
                    <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-xs">
                        <div className="flex items-center gap-2 text-orange-300">
                            <Info className="h-4 w-4 shrink-0 text-orange-400" />
                            <span>Want uncapped tokens and high-resolution video models? Switch to <strong>Pay-As-You-Go</strong> or <strong>Pro</strong> to unlock 100k+ TPM and cinematic video.</span>
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
                            Browse all models with their official upstream architectures and real names. Free & top working models listed first.
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
                    <span className="text-muted-foreground font-medium text-xs">Engine:</span>
                    {['all', 'Flux AI'].map(p => (
                        <button
                            key={p}
                            onClick={() => setSelectedProvider(p)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                                selectedProvider === p
                                    ? 'bg-secondary text-primary border-primary/40 font-semibold'
                                    : 'bg-transparent text-muted-foreground hover:text-foreground border-border/50'
                            }`}
                        >
                            {p === 'all' ? 'All Models' : 'Flux Proprietary'}
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── TWO-TONE ILLUSTRATED MODELS CARD GRID ───────────────────── */}
            <div className="space-y-4">
                <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2.5">
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">Models</h2>
                        <span className="text-xs font-semibold text-muted-foreground bg-secondary px-2.5 py-0.5 rounded-full border border-border">
                            {filteredModels.length} models
                        </span>
                    </div>
                    <button 
                        onClick={() => setCompareModalOpen(true)}
                        className="text-xs sm:text-sm font-semibold text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1 group"
                    >
                        <span>Compare models</span>
                        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                    {filteredModels.map(model => {
                        const isFree = model.minTier === 'free';
                        const isPro = model.minTier === 'pro';
                        const isMax = model.minTier === 'max';

                        return (
                            <div 
                                key={model.id}
                                className="group rounded-2xl border border-zinc-800/90 bg-[#0d0f15] overflow-hidden shadow-md hover:shadow-2xl hover:border-zinc-700 transition-all duration-300 flex flex-col justify-between"
                            >
                                {/* 1. UPPER SECTION: COLORED BANNER WITH VECTOR ILLUSTRATION */}
                                <div 
                                    className="h-44 sm:h-48 w-full flex items-center justify-center relative overflow-hidden transition-transform duration-300 group-hover:brightness-[1.02]"
                                    style={{ backgroundColor: model.bannerColor }}
                                >
                                    {/* Subtle gradient overlay */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/15 pointer-events-none" />

                                    {/* Centered Vector Illustration */}
                                    <div className="transform transition-transform duration-300 group-hover:scale-105 drop-shadow-sm select-none">
                                        <ModelIllustration type={model.illustrationType} className="w-24 h-24 sm:w-28 sm:h-28" />
                                    </div>

                                    {/* Floating Badges */}
                                    <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                                        <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-md text-white border border-white/20">
                                            {model.provider}
                                        </span>
                                        {model.badgeText && (
                                            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-black/45 backdrop-blur-md text-white border border-white/20">
                                                {model.badgeText}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 2. LOWER SECTION: DARK SURFACE WITH TITLE & CAPABILITY PILLS */}
                                <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-4 bg-[#0d0f15]">
                                    <div className="space-y-3">
                                        {/* Title & Real Upstream Name */}
                                        <div>
                                            <div className="flex items-center justify-between gap-1.5">
                                                <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight group-hover:text-orange-400 transition-colors">
                                                    {model.label}
                                                </h3>
                                                {isFree ? (
                                                    <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                                        FREE TIER
                                                    </span>
                                                ) : isMax ? (
                                                    <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                                        MAX TIER
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
                                                        PRO TIER
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-zinc-400 font-medium truncate mt-0.5">
                                                {model.realName} • {model.contextWindow}
                                            </div>
                                        </div>

                                        {/* Dark Pill Tags (Requested Feature) */}
                                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                                            {model.workTags.map((tag, idx) => (
                                                <span 
                                                    key={idx}
                                                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#1a1d27] text-zinc-300 border border-white/[0.08]"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Quick Actions Footer */}
                                    <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                                        <button
                                            onClick={() => copyText(model.id, 'Gateway ID')}
                                            className="text-[11px] font-mono text-zinc-400 hover:text-white flex items-center gap-1 px-1.5 py-1 rounded hover:bg-zinc-800/60 transition-colors"
                                            title="Copy Gateway ID"
                                        >
                                            <code className="text-orange-400 font-semibold text-xs">{model.id}</code>
                                            <Copy className="h-3 w-3 ml-0.5 text-zinc-400" />
                                        </button>
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => {
                                                    setSelectedSnippetModel(model);
                                                    setSnippetModalOpen(true);
                                                }}
                                                className="h-7 text-xs px-2 text-zinc-300 hover:text-white hover:bg-zinc-800"
                                                title="View Code Snippet"
                                            >
                                                <Terminal className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedPlaygroundModel(model);
                                                    setPlaygroundPrompt(model.samplePrompt || '');
                                                    setPlaygroundResponse(null);
                                                    setPlaygroundModalOpen(true);
                                                }}
                                                className="h-7 text-xs px-2.5 bg-orange-500/20 hover:bg-orange-500 text-orange-300 hover:text-white border border-orange-500/30 transition-all font-semibold"
                                            >
                                                <Play className="h-3 w-3 mr-1" />
                                                Try Live
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ─── COMPARE MODELS MODAL ────────────────────────────────────── */}
            <Dialog open={compareModalOpen} onOpenChange={setCompareModalOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center justify-between text-xl font-bold">
                            <div className="flex items-center gap-2">
                                <Sliders className="h-5 w-5 text-orange-400" />
                                <span>Compare AI Models & Specifications</span>
                            </div>
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Side-by-side technical benchmarks, context windows, and minimum tier access across all models.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="rounded-lg border border-border overflow-hidden text-xs mt-3">
                        <table className="w-full text-left bg-card">
                            <thead>
                                <tr className="bg-secondary border-b border-border uppercase tracking-wide text-muted-foreground text-[11px]">
                                    <th className="px-3.5 py-2.5">Model</th>
                                    <th className="px-3.5 py-2.5">Real Architecture</th>
                                    <th className="px-3.5 py-2.5">Modality</th>
                                    <th className="px-3.5 py-2.5">Context Window</th>
                                    <th className="px-3.5 py-2.5">Speed / Latency</th>
                                    <th className="px-3.5 py-2.5">Plan Tier</th>
                                    <th className="px-3.5 py-2.5 text-right">Gateway ID</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {MODEL_CATALOG.map(m => (
                                    <tr key={m.id} className="hover:bg-secondary/60 transition-colors">
                                        <td className="px-3.5 py-2.5 font-bold text-foreground whitespace-nowrap">{m.label}</td>
                                        <td className="px-3.5 py-2.5 text-muted-foreground whitespace-nowrap">{m.realName}</td>
                                        <td className="px-3.5 py-2.5 font-mono text-cyan-400 capitalize whitespace-nowrap">{m.modality}</td>
                                        <td className="px-3.5 py-2.5 font-mono font-semibold text-foreground whitespace-nowrap">{m.contextWindow}</td>
                                        <td className="px-3.5 py-2.5 text-muted-foreground whitespace-nowrap">{m.speedRating}</td>
                                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                m.minTier === 'free' 
                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                                                    : m.minTier === 'pro'
                                                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                                                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                            }`}>
                                                {m.minTier.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-3.5 py-2.5 text-right font-mono text-orange-400 font-semibold whitespace-nowrap">
                                            <button 
                                                onClick={() => copyText(m.id, 'Gateway ID')}
                                                className="hover:underline flex items-center gap-1 justify-end ml-auto"
                                            >
                                                <span>{m.id}</span>
                                                <Copy className="h-3 w-3" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </DialogContent>
            </Dialog>

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
                                    placeholder="e.g. Cursor Assistant, Production App, Autonomous Agent"
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
                        <DialogTitle className="flex flex-wrap items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2">
                                <Code2 className="h-5 w-5 text-primary" />
                                <span>Integration Code: {selectedSnippetModel?.label}</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground font-normal bg-secondary/60 px-2 py-0.5 rounded border border-border/60">
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
                        <DialogTitle className="flex flex-wrap items-center justify-between gap-2.5">
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
                                                <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    <span>Image Generated Successfully!</span>
                                                </div>
                                                <img 
                                                    src={playgroundResponse.replace('IMAGE_GENERATED: ', '')} 
                                                    alt="Generated Output" 
                                                    className="rounded-lg max-h-64 object-cover border border-zinc-700 shadow-md" 
                                                />
                                                <div className="pt-1">
                                                    <a 
                                                        href={playgroundResponse.replace('IMAGE_GENERATED: ', '')} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer" 
                                                        className="text-[11px] text-orange-400 hover:underline flex items-center gap-1 font-sans"
                                                    >
                                                        <span>Open full-resolution image</span>
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                </div>
                                            </div>
                                        ) : playgroundResponse.startsWith('VIDEO_GENERATED: ') ? (
                                            <div className="space-y-3">
                                                <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    <span>Video Rendered Successfully!</span>
                                                </div>
                                                <div className="rounded-lg overflow-hidden border border-zinc-700 bg-black/80 max-w-lg shadow-xl">
                                                    <video 
                                                        src={playgroundResponse.replace('VIDEO_GENERATED: ', '')} 
                                                        controls 
                                                        autoPlay 
                                                        loop 
                                                        playsInline 
                                                        className="w-full max-h-72 object-contain"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-3 pt-1">
                                                    <a 
                                                        href={playgroundResponse.replace('VIDEO_GENERATED: ', '')} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer" 
                                                        className="text-[11px] text-orange-400 hover:underline flex items-center gap-1 font-sans font-medium"
                                                    >
                                                        <span>Download / Open MP4 Video</span>
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                </div>
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
