'use client';

import * as React from 'react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
    Download, Book, Code2, Webhook, Database, ShieldCheck, Shield,
    Zap, Copy, Check, ArrowRight, HardDrive, AlertCircle,
    Info, Lock, Users, Eye, KeyRound, Globe, Cpu, ChevronRight, Bot, Sparkles, Printer
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

// ─── Code Block ─────────────────────────────────────────────────────────────

function CodeBlock({ code, title }: { code: string; language?: string; title?: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="group relative my-4 w-full max-w-full overflow-hidden rounded-lg border border-border bg-card">
            {title && (
                <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary px-3 py-2.5 sm:px-4">
                    <span className="truncate font-mono text-xs font-medium text-muted-foreground">{title}</span>
                    <button onClick={copy} className="text-muted-foreground/75 hover:text-white transition-colors p-1 rounded">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                </div>
            )}
            <pre className="mobile-scroll p-3 text-[12px] leading-relaxed font-mono sm:p-4 sm:text-[13px]">
                <code className="text-foreground/85">{code}</code>
            </pre>
            {!title && (
                <button onClick={copy} className="absolute top-3 right-3 text-muted-foreground/75 hover:text-white bg-secondary/85 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-all">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
            )}
        </div>
    );
}

// ─── Section Wrapper ─────────────────────────────────────────────────────────

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: any; children: React.ReactNode }) {
    return (
        <section id={id} className="max-w-full scroll-mt-24 space-y-5 sm:scroll-mt-28 sm:space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-border">
                <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400 shrink-0">
                    <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h2>
            </div>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
                {children}
            </div>
        </section>
    );
}

// ─── Callout ─────────────────────────────────────────────────────────────────

function Callout({ type = 'info', children }: { type?: 'info' | 'warning' | 'success'; children: React.ReactNode }) {
    const styles = {
        info: 'bg-blue-500/5 border-blue-500/20 text-blue-300',
        warning: 'bg-amber-500/5 border-amber-500/20 text-amber-300',
        success: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300',
    }[type];
    const icons = { info: Info, warning: AlertCircle, success: ShieldCheck }[type];
    const Icon = icons;
    return (
        <div className={cn('flex max-w-full gap-3 rounded-lg border p-4 text-sm leading-relaxed', styles)}>
            <Icon className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
            <div>{children}</div>
        </div>
    );
}

// ─── Endpoint Badge ───────────────────────────────────────────────────────────

function Endpoint({ method, path }: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; path: string }) {
    const colors = { GET: 'text-emerald-400 bg-emerald-500/10', POST: 'text-orange-400 bg-orange-500/10', DELETE: 'text-red-400 bg-red-500/10', PATCH: 'text-blue-400 bg-blue-500/10' }[method];
    return (
        <div className="my-3 flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary p-3 font-mono text-sm sm:gap-3">
            <span className={cn('px-2 py-0.5 rounded font-bold text-xs', colors)}>{method}</span>
            <span className="break-anywhere text-foreground/85">{path}</span>
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
    { id: 'getting-started', label: 'Getting Started', icon: Zap },
    { id: 'authentication', label: 'Authentication', icon: KeyRound },
    { id: 'flux-ai-gateway', label: 'Flux', icon: Bot },
    { id: 'mcp-gateway', label: 'MCP AI Gateway', icon: Cpu },
    { id: 'core-api', label: 'Core SQL API', icon: Database },
    { id: 'sdks', label: 'Language SDKs', icon: Code2 },
    { id: 'realtime', label: 'Real-time (WebSocket)', icon: Globe },
    { id: 'storage', label: 'Storage v2', icon: HardDrive },
    { id: 'team-api', label: 'Team & Invitations', icon: Users },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'error-codes', label: 'Error Codes', icon: AlertCircle },
    { id: 'rls-tutorial', label: 'Row Level Security', icon: Shield },
];

export default function DocsPage() {
    const [activeSection, setActiveSection] = useState('getting-started');

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) setActiveSection(entry.target.id);
                });
            },
            { rootMargin: '-10% 0% -80% 0%', threshold: 0 }
        );
        NAV_SECTIONS.forEach((s) => {
            const el = document.getElementById(s.id);
            if (el) observer.observe(el);
        });

        // If URL has ?download=true or ?pdf=true, automatically trigger the PDF manual download
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('download') === 'true' || params.get('pdf') === 'true') {
                const link = document.createElement('a');
                link.href = '/api/docs/download-pdf';
                link.download = 'Fluxbase-Integration-Guide.pdf';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }

        return () => observer.disconnect();
    }, []);

    const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

    return (
        <div className="docs-mobile-safe flex min-h-screen max-w-full bg-background text-foreground/85">
            {/* ── Sidebar ── */}
            <aside className="fixed top-0 left-0 bottom-0 w-64 hidden lg:flex flex-col border-r border-border/70 bg-card/80 backdrop-blur-lg pt-20 pb-8 px-4 z-40 shrink-0">
                <div className="flex items-center gap-2 mb-8 px-2">
                    <div className="p-1.5 rounded-lg bg-orange-500/10">
                        <Book className="h-4 w-4 text-orange-400" />
                    </div>
                    <span className="font-bold text-white text-sm tracking-tight">Documentation</span>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-mono font-bold">v4.2</span>
                </div>

                <nav className="flex-1 overflow-y-auto space-y-0.5 pr-1">
                    {NAV_SECTIONS.map((s) => (
                        <button
                            key={s.id}
                            onClick={() => scrollTo(s.id)}
                            className={cn(
                                'w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-200',
                                activeSection === s.id
                                    ? 'bg-orange-500/10 text-orange-400 font-semibold'
                                    : 'text-muted-foreground/75 hover:text-foreground/90 hover:bg-muted/60'
                            )}
                        >
                            <s.icon className={cn('h-3.5 w-3.5 shrink-0', activeSection === s.id ? 'text-orange-400' : 'text-muted-foreground/55')} />
                            {s.label}
                        </button>
                    ))}
                </nav>

                <div className="mt-6 pt-6 border-t border-border space-y-2">
                    <Button variant="outline" size="sm" className="w-full justify-start gap-2 border-border bg-secondary/70 text-foreground/85 hover:bg-muted text-xs" asChild>
                        <a href="/api/docs/download-pdf" download="Fluxbase-Integration-Guide.pdf">
                            <Download className="h-3.5 w-3.5 text-orange-400" /> Download PDF Guide
                        </a>
                    </Button>
                    <Link href="/contact" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground/55 hover:text-foreground/85 transition-colors">
                        <Zap className="h-3.5 w-3.5" /> Contact Support
                    </Link>
                </div>
            </aside>

            {/* ── Main ── */}
            <div className="min-w-0 flex-1 lg:pl-64">
                <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20 lg:px-12 lg:py-28">

                    {/* Mobile Quick Action Banner */}
                    <div className="lg:hidden flex items-center justify-between gap-3 p-3.5 mb-8 rounded-xl border border-border bg-card/85 shadow-sm">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="p-1.5 rounded-lg bg-orange-500/10 shrink-0">
                                <Book className="h-4 w-4 text-orange-400" />
                            </div>
                            <span className="font-bold text-white text-xs truncate">Documentation Manual (v4.2)</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs h-8 gap-1.5 px-3" asChild>
                                <a href="/api/docs/download-pdf" download="Fluxbase-Integration-Guide.pdf">
                                    <Download className="h-3.5 w-3.5" /> PDF
                                </a>
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 px-2.5 text-xs text-muted-foreground hover:text-white" title="Print or save as PDF">
                                <Printer className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>

                    {/* Hero */}
                    <header className="mb-12 max-w-full space-y-4 sm:mb-20 sm:max-w-3xl">
                        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/75 hover:text-orange-400 transition-colors font-medium mb-2">
                            <ArrowRight className="h-3 w-3 rotate-180" /> Back to Fluxbase
                        </Link>
                        <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                            Integration <span className="text-orange-400">Guide</span>
                        </h1>
                        <p className="text-base text-muted-foreground/75 leading-relaxed">
                            The complete technical reference for connecting your apps to Fluxbase. Covers authentication, the SQL API, OpenAI-compatible AI gateway, MCP autonomous coding agent tooling, real-time WebSockets, file storage, team management, and row-level security.
                        </p>
                        <div className="flex max-w-full flex-wrap items-center gap-2 pt-2 sm:gap-3">
                            {[
                                { label: 'v4.2 Production', color: 'bg-orange-500/10 text-orange-400' },
                                { label: 'PostgreSQL', color: 'bg-blue-500/10 text-blue-400' },
                                { label: 'MySQL', color: 'bg-emerald-500/10 text-emerald-400' },
                                { label: 'OpenAI AI Gateway', color: 'bg-amber-500/10 text-amber-400' },
                                { label: 'MCP JSON-RPC', color: 'bg-cyan-500/10 text-cyan-400' },
                                { label: 'REST + WebSocket', color: 'bg-purple-500/10 text-purple-400' },
                            ].map(b => (
                                <span key={b.label} className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider', b.color)}>{b.label}</span>
                            ))}
                        </div>

                        {/* Prominent PDF Download & Export Action Bar */}
                        <div className="flex flex-wrap items-center gap-3 pt-4">
                            <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white font-semibold gap-2 shadow-lg shadow-orange-500/20" asChild>
                                <a href="/api/docs/download-pdf" download="Fluxbase-Integration-Guide.pdf">
                                    <Download className="h-4 w-4" /> Download PDF Manual
                                </a>
                            </Button>
                            <Button size="lg" variant="outline" onClick={() => window.print()} className="border-border bg-secondary/80 hover:bg-secondary text-foreground/90 font-medium gap-2">
                                <Printer className="h-4 w-4 text-orange-400" /> Print / Save as PDF
                            </Button>
                            <a 
                                href="/api/docs" 
                                target="_blank" 
                                rel="noreferrer" 
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono text-muted-foreground hover:text-orange-400 transition-colors border border-border/70 rounded-md bg-secondary/40"
                            >
                                <Code2 className="h-3.5 w-3.5 text-blue-400" /> OpenAPI JSON
                            </a>
                        </div>
                    </header>

                    <div className="max-w-full space-y-16 sm:space-y-24">

                        {/* ── 1. Getting Started ── */}
                        <Section id="getting-started" title="Getting Started" icon={Zap}>
                            <p>Every Fluxbase integration requires three values, found in your <strong className="text-foreground/90">Project Settings</strong>:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                {[
                                    { label: 'API Key', desc: 'Bearer token from Settings → API Keys. Scoped per project.', color: 'text-orange-400 bg-orange-500/10' },
                                    { label: 'Project ID', desc: 'Unique project identifier visible in the URL and Settings.', color: 'text-blue-400 bg-blue-500/10' },
                                    { label: 'Base URL', desc: 'https://www.fluxbasedb.me — all REST endpoints live here.', color: 'text-emerald-400 bg-emerald-500/10' },
                                    { label: 'WebSocket URL', desc: 'wss://fluxbase-realtime.onrender.com — for real-time events.', color: 'text-purple-400 bg-purple-500/10' },
                                ].map((item) => (
                                    <div key={item.label} className="p-4 rounded-lg border border-border bg-secondary/60 space-y-1.5">
                                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest', item.color)}>{item.label}</span>
                                        <p className="text-sm text-foreground/85">{item.desc}</p>
                                    </div>
                                ))}
                            </div>

                            <h3 className="text-base font-bold text-white mt-6">Environment Setup</h3>
                            <CodeBlock title=".env.local" language="bash" code={`FLUXBASE_API_KEY=flx_live_xxxxxxxxxxxxxxxxxxxx
FLUXBASE_PROJECT_ID=51c04beb753a42f3
NEXT_PUBLIC_WS_URL=wss://fluxbase-realtime.onrender.com`} />

                            <Callout type="warning">
                                <strong>Never expose your API key on the client side.</strong> Always call Fluxbase from your server (Next.js API routes, Express, etc.) and keep your key in server-only environment variables.
                            </Callout>
                        </Section>

                        {/* ── 2. Authentication ── */}
                        <Section id="authentication" title="Authentication" icon={KeyRound}>
                            <p>All REST API requests must include an <code className="text-orange-300 bg-muted px-1.5 py-0.5 rounded text-xs">Authorization</code> header with a valid Bearer token. Requests missing this header return <code className="text-foreground/85 bg-muted px-1.5 py-0.5 rounded text-xs">401 Unauthorized</code>.</p>

                            <CodeBlock title="Request Header" language="http" code={`Authorization: Bearer flx_live_xxxxxxxxxxxxxxxxxxxx
Content-Type: application/json`} />

                            <h3 className="text-base font-bold text-white mt-6">API Key Scopes</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Scope</th>
                                            <th className="px-4 py-3">Access</th>
                                            <th className="px-4 py-3">Recommended For</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { scope: 'read', access: 'SELECT only', rec: 'Dashboards, public APIs' },
                                            { scope: 'write', access: 'INSERT, UPDATE, DELETE', rec: 'Backend services & mutations' },
                                            { scope: 'ai', access: 'Flux AI Gateway models', rec: 'LLM completions, agent workflows' },
                                            { scope: 'admin', access: 'Full DDL + DML access', rec: 'Migration scripts, init scripts' },
                                        ].map(r => (
                                            <tr key={r.scope} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono text-orange-400 text-xs">{r.scope}</td>
                                                <td className="px-4 py-3 text-foreground/85 text-xs">{r.access}</td>
                                                <td className="px-4 py-3 text-muted-foreground/75 text-xs">{r.rec}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <Callout type="info">
                                Rotate API keys any time from <strong>Settings → API Keys</strong>. Old keys are invalidated immediately.
                            </Callout>
                        </Section>

                        {/* ── 3. Flux (AI Gateway) ── */}
                        <Section id="flux-ai-gateway" title="Flux" icon={Bot}>
                            <p>
                                Fluxbase includes an enterprise-grade, <strong className="text-white">OpenAI-compatible AI Gateway named Flux</strong>. It enables your applications, developers, and autonomous agents to interact with our proprietary <strong className="text-white">Flux AI reasoning model family</strong> across <strong className="text-white">6 distinct modalities</strong>: Text Reasoning & Chat, Image Generation, Speech-to-Text (STT), Text-to-Speech (TTS), Video Generation, and Vector Embeddings using standard OpenAI SDKs, LangChain, Cursor, Windsurf, or direct HTTP requests.
                            </p>

                            <div className="flex flex-wrap gap-2 pt-1">
                                <Endpoint method="GET" path="/api/v1/models" />
                                <Endpoint method="POST" path="/api/v1/chat/completions" />
                                <Endpoint method="POST" path="/api/v1/images/generations" />
                                <Endpoint method="POST" path="/api/v1/audio/transcriptions" />
                                <Endpoint method="POST" path="/api/v1/audio/speech" />
                                <Endpoint method="POST" path="/api/v1/videos/generations" />
                                <Endpoint method="GET" path="/api/v1/videos/generations/:taskId" />
                                <Endpoint method="POST" path="/api/v1/embeddings" />
                                <Endpoint method="GET" path="/api/v1/media/:mediaId" />
                            </div>

                            <Callout type="success">
                                <strong>Unlimited Everything Policy:</strong> Accounts on <strong className="text-emerald-300">Employee</strong>, <strong className="text-emerald-300">Org Owner</strong>, and <strong className="text-emerald-300">Pay-As-You-Go (PAYG)</strong> plans enjoy <strong>unlimited access across all modalities</strong>. Rate limits (RPM/TPM), daily quotas, and tier-lock restrictions are completely waived.
                            </Callout>

                            {/* Hub Banner */}
                            <div className="my-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-200">
                                <div className="space-y-1">
                                    <div className="font-bold text-sm text-white flex items-center gap-1.5">
                                        <Sparkles className="h-4 w-4 text-orange-400" />
                                        Interactive AI Models Hub & Key Creation
                                    </div>
                                    <p className="text-xs text-orange-200/80">
                                        Browse all 33 models with real upstream architectures, inspect your tier&apos;s token quotas, test live in browser playground, and create scoped API keys.
                                    </p>
                                </div>
                                <Button size="sm" asChild className="bg-orange-500 hover:bg-orange-600 text-white font-semibold shrink-0">
                                    <Link href="/ai-models">Open AI Models Hub →</Link>
                                </Button>
                            </div>

                            <h3 className="text-base font-bold text-white mt-8 flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-orange-400" />
                                Available Flux AI Models & Real Upstream Architectures
                            </h3>
                            <p className="text-sm">
                                All requests to <code className="text-xs font-mono text-foreground/80 bg-muted px-1.5 py-0.5 rounded">/api/v1/chat/completions</code> use these model identifiers. If omitted, the default model is <code className="text-xs font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">flux</code>.
                            </p>

                            {/* Modality Catalog Table */}
                            <div className="rounded-lg border border-border overflow-hidden text-sm mt-3">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Modality</th>
                                            <th className="px-4 py-3">Flux Gateway ID</th>
                                            <th className="px-4 py-3">Real Upstream Model</th>
                                            <th className="px-4 py-3">Provider</th>
                                            <th className="px-4 py-3">Min Tier</th>
                                            <th className="px-4 py-3">Capabilities & Specs</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { mod: 'Text / Chat', id: 'flux-sonnet', real: 'Claude Sonnet 4.5', prov: 'AWS Bedrock', tier: 'Pro', desc: 'SOTA frontier reasoning, architectural design, coding. 200k context, 64k max output.' },
                                            { mod: 'Text / Chat', id: 'flux-pro-max', real: 'Claude 3.7 / 4.6 Sonnet', prov: 'AWS Bedrock', tier: 'Max', desc: 'Frontier hybrid reasoning with extended thinking and rigorous SQL optimization. 200k context.' },
                                            { mod: 'Text / Chat', id: 'flux-turbo', real: 'LLaMA 3.3 70B Versatile', prov: 'Groq / Meta', tier: 'Free', desc: 'Hyper-speed 300+ tokens/second inference. Ideal for real-time agents. 128k context.' },
                                            { mod: 'Text / Chat', id: 'flux-omni', real: 'Gemini 2.0 Flash', prov: 'Google Gemini', tier: 'Free', desc: 'Massive 1M token context window, multimodal vision understanding, high velocity.' },
                                            { mod: 'Text / Chat', id: 'flux-max', real: 'GPT-4o Mini', prov: 'OpenAI', tier: 'Free', desc: 'Flagship coding, instruction following, and vision benchmarks. 128k context.' },
                                            { mod: 'Text / Chat', id: 'flux', real: 'GLM-4 Flash', prov: 'Zhipu AI', tier: 'Free', desc: 'Flagship default. High-accuracy general reasoning, precision SQL synthesis. 128k context.' },
                                            { mod: 'Text / Chat', id: 'flux-flash', real: 'GLM-4 Flash (Turbo UX)', prov: 'Zhipu AI', tier: 'Free', desc: 'Sub-100ms token throughput. Ideal for autocompletion, real-time UX, streaming.' },
                                            { mod: 'Text / Chat', id: 'flux-5.2', real: 'GLM-4 Plus (Agentic)', prov: 'Zhipu AI', tier: 'Free', desc: 'Frontier reasoning architecture engineered for multi-step agentic execution.' },
                                            { mod: 'Text / Chat', id: 'flux-pro', real: 'GLM-4 Air', prov: 'Zhipu AI', tier: 'Free', desc: 'Enhanced instruction following, multi-table analysis, strict JSON Schema formatting.' },
                                            { mod: 'Text / Chat', id: 'flux-ultra', real: 'GLM-4 Plus (Deep Reasoning)', prov: 'Zhipu AI', tier: 'Free', desc: 'Maximum cognitive depth for database architectural blueprints and complex migrations.' },
                                            { mod: 'Text / Chat', id: 'flux-vision', real: 'GLM-4V Multimodal', prov: 'Zhipu AI', tier: 'Free', desc: 'Visual schema comprehension, diagram recognition, screenshot-to-code.' },
                                            { mod: 'Text / Chat', id: 'gpt-4o', real: 'GPT-4o Alias', prov: 'OpenAI', tier: 'Free', desc: 'OpenAI compatibility alias automatically mapped to flux-ultra.' },
                                            { mod: 'Text / Chat', id: 'gpt-3.5-turbo', real: 'GPT-3.5 Turbo Alias', prov: 'OpenAI', tier: 'Free', desc: 'OpenAI compatibility alias automatically mapped to flux-flash.' },
                                            { mod: 'Image Generation', id: 'flux-image-ultra', real: 'Stable Image Ultra 1.0', prov: 'AWS Bedrock', tier: 'Pro', desc: 'SOTA photorealism, typography rendering, and cinematic lighting with automatic S3 storage.' },
                                            { mod: 'Image Generation', id: 'flux-image-hd', real: 'Imagen 3.0', prov: 'Google Gemini', tier: 'Free', desc: 'High-definition 4K image generation with superior detail and typography.' },
                                            { mod: 'Image Generation', id: 'flux-image-pro', real: 'DALL·E 3', prov: 'OpenAI', tier: 'Pro', desc: 'Premium creative composition with prompt adherence and S3 storage.' },
                                            { mod: 'Image Generation', id: 'flux-image', real: 'CogView 4', prov: 'Zhipu AI', tier: 'Free', desc: 'High-quality photorealistic text-to-image synthesis with automatic S3 cloud hosting.' },
                                            { mod: 'Image Generation', id: 'flux-image-fast', real: 'CogView 3 Flash', prov: 'Zhipu AI', tier: 'Free', desc: 'Ultra-fast low-latency image generation for avatars and thumbnails.' },
                                            { mod: 'Video Generation', id: 'flux-video-ray', real: 'Luma Ray v2', prov: 'AWS Bedrock', tier: 'Pro', desc: 'Cinema-grade video generation with realistic physics and camera motion on AWS Bedrock.' },
                                            { mod: 'Video Generation', id: 'flux-video', real: 'CogVideoX Flash', prov: 'Zhipu AI', tier: 'Pro', desc: 'Text-to-video synthesis with dynamic motion and lighting (HTTP 202 async polling).' },
                                            { mod: 'Video Generation', id: 'flux-video-pro', real: 'CogVideoX HD', prov: 'Zhipu AI', tier: 'Max', desc: 'Cinematic 1080p high-fidelity video generation.' },
                                            { mod: 'Speech-to-Text', id: 'flux-listen', real: 'Whisper Large v3 Turbo', prov: 'Groq / Meta', tier: 'Free', desc: '10x real-time multilingual transcription with timestamps on Groq LPUs.' },
                                            { mod: 'Speech-to-Text', id: 'flux-listen-pro', real: 'Whisper Large v3', prov: 'Groq / Meta', tier: 'Free', desc: 'Maximum precision transcription for noisy, technical audio.' },
                                            { mod: 'Speech-to-Text', id: 'flux-listen-en', real: 'Distil-Whisper Large v3 En', prov: 'Groq / Meta', tier: 'Free', desc: 'Lightweight, hyper-fast English-only speech recognition.' },
                                            { mod: 'Text-to-Speech', id: 'flux-speak', real: 'TTS-1', prov: 'OpenAI', tier: 'Free', desc: 'Natural voice synthesis across 6 voices (alloy, echo, fable, onyx, nova, shimmer).' },
                                            { mod: 'Text-to-Speech', id: 'flux-speak-hd', real: 'TTS-1 HD', prov: 'OpenAI', tier: 'Pro', desc: 'Studio-grade high-definition audio synthesis for production voiceovers.' },
                                            { mod: 'Embeddings', id: 'flux-embed', real: 'Text Embedding 004', prov: 'Google Gemini', tier: 'Free', desc: '768-dimensional dense vector embeddings for semantic search and RAG.' },
                                        ].map(m => (
                                            <tr key={m.id} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono text-cyan-400 text-xs font-semibold whitespace-nowrap">{m.mod}</td>
                                                <td className="px-4 py-3 font-mono text-orange-400 text-xs font-bold whitespace-nowrap">{m.id}</td>
                                                <td className="px-4 py-3 text-xs font-semibold text-foreground whitespace-nowrap">{m.real}</td>
                                                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.prov}</td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        m.tier === 'Max' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                                                        m.tier === 'Pro' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                                                        'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                                    }`}>
                                                        {m.tier}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-foreground/85 text-xs">{m.desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Tier Token Quotas Table */}
                            <h3 className="text-base font-bold text-white mt-8 flex items-center gap-2">
                                <Shield className="h-4 w-4 text-emerald-400" />
                                Tier Token Allocations & Rate Limits Matrix
                            </h3>
                            <p className="text-sm">
                                Token throughput (TPM), request velocity (RPM), and daily generation ceilings enforced per account tier:
                            </p>

                            <div className="rounded-lg border border-border overflow-hidden text-sm mt-3">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Plan Tier</th>
                                            <th className="px-4 py-3">Text & Reasoning TPM</th>
                                            <th className="px-4 py-3">Requests / Min</th>
                                            <th className="px-4 py-3">Daily Request Limit</th>
                                            <th className="px-4 py-3">Image Generation</th>
                                            <th className="px-4 py-3">Video Synthesis</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60 text-xs">
                                        <tr className="hover:bg-secondary/70">
                                            <td className="px-4 py-3 font-bold text-zinc-400">Free Tier</td>
                                            <td className="px-4 py-3 font-mono">10,000 TPM</td>
                                            <td className="px-4 py-3 font-mono">10 RPM</td>
                                            <td className="px-4 py-3">500 req / day</td>
                                            <td className="px-4 py-3">5 gens / day (20k TPM)</td>
                                            <td className="px-4 py-3 text-muted-foreground">Locked (Pro/Max)</td>
                                        </tr>
                                        <tr className="hover:bg-secondary/70">
                                            <td className="px-4 py-3 font-bold text-blue-400">Pro Tier</td>
                                            <td className="px-4 py-3 font-mono text-blue-300">100,000 TPM</td>
                                            <td className="px-4 py-3 font-mono">60 RPM</td>
                                            <td className="px-4 py-3">10,000 req / day</td>
                                            <td className="px-4 py-3 text-blue-300">50 gens / day (100k TPM)</td>
                                            <td className="px-4 py-3 text-blue-300">5 gens / day (50k TPM)</td>
                                        </tr>
                                        <tr className="hover:bg-secondary/70">
                                            <td className="px-4 py-3 font-bold text-amber-400">Max Tier</td>
                                            <td className="px-4 py-3 font-mono text-amber-300">500,000 TPM</td>
                                            <td className="px-4 py-3 font-mono">300 RPM</td>
                                            <td className="px-4 py-3">50,000 req / day</td>
                                            <td className="px-4 py-3 text-amber-300">200 gens / day (300k TPM)</td>
                                            <td className="px-4 py-3 text-amber-300">20 gens / day (100k TPM)</td>
                                        </tr>
                                        <tr className="hover:bg-secondary/70 bg-emerald-500/5">
                                            <td className="px-4 py-3 font-bold text-emerald-400">Pay-As-You-Go / Enterprise</td>
                                            <td className="px-4 py-3 font-mono text-emerald-300 font-bold">Unlimited (Uncapped)</td>
                                            <td className="px-4 py-3 font-mono text-emerald-300 font-bold">Unlimited</td>
                                            <td className="px-4 py-3 text-emerald-300 font-bold">Unlimited (Metered)</td>
                                            <td className="px-4 py-3 text-emerald-300 font-bold">Unlimited</td>
                                            <td className="px-4 py-3 text-emerald-300 font-bold">Unlimited</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <h3 className="text-base font-bold text-white mt-8">Integration Examples by Modality</h3>
                            <p className="text-sm">
                                The gateway is a 100% drop-in replacement for OpenAI. Point your client to <code className="text-xs font-mono text-foreground/80 bg-muted px-1.5 py-0.5 rounded">base_url=&quot;https://www.fluxbasedb.me/api/v1&quot;</code> and use your Fluxbase API Key:
                            </p>

                            <Tabs defaultValue="chat" className="w-full mt-3">
                                <TabsList className="flex flex-wrap h-auto gap-1 bg-secondary border border-border p-1 rounded-lg">
                                    <TabsTrigger value="chat" className="text-xs">1. Chat & Reasoning</TabsTrigger>
                                    <TabsTrigger value="images" className="text-xs">2. Image Generation</TabsTrigger>
                                    <TabsTrigger value="voice-stt" className="text-xs">3. Speech-to-Text</TabsTrigger>
                                    <TabsTrigger value="voice-tts" className="text-xs">4. Text-to-Speech</TabsTrigger>
                                    <TabsTrigger value="video" className="text-xs">5. Video Generation</TabsTrigger>
                                    <TabsTrigger value="embeddings" className="text-xs">6. Embeddings</TabsTrigger>
                                </TabsList>

                                {/* Tab 1: Chat */}
                                <TabsContent value="chat" className="space-y-3 mt-4">
                                    <h4 className="text-sm font-bold text-white">Chat & SQL Reasoning (SSE Streaming Supported)</h4>
                                    <CodeBlock title="chat_completion.py" code={`from openai import OpenAI

client = OpenAI(
    base_url="https://www.fluxbasedb.me/api/v1",
    api_key="flx_live_your_fluxbase_key"
)

# Streaming Chat Completion
stream = client.chat.completions.create(
    model="flux",  # or "flux-pro", "flux-ultra", "gpt-4o"
    messages=[
        {"role": "system", "content": "You are a database architect."},
        {"role": "user", "content": "Generate an optimal indexing strategy for a high-traffic analytics table."}
    ],
    stream=True
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`} />
                                </TabsContent>

                                {/* Tab 2: Images */}
                                <TabsContent value="images" className="space-y-3 mt-4">
                                    <h4 className="text-sm font-bold text-white">Photorealistic Image Generation</h4>
                                    <p className="text-xs text-muted-foreground">Generated images are automatically persisted to private S3 buckets and delivered via high-speed CDN URLs or Base64 JSON:</p>
                                    <CodeBlock title="generate_image.py" code={`from openai import OpenAI

client = OpenAI(
    base_url="https://www.fluxbasedb.me/api/v1",
    api_key="flx_live_your_fluxbase_key"
)

response = client.images.generate(
    model="flux-image",       # or "flux-image-fast", "dall-e-3"
    prompt="Cinematic render of a futuristic serverless database facility in neon lighting, 8k octane render",
    n=1,
    size="1024x1024"
)

image_url = response.data[0].url
print(f"Generated Image URL: {image_url}")`} />
                                </TabsContent>

                                {/* Tab 3: Audio STT */}
                                <TabsContent value="voice-stt" className="space-y-3 mt-4">
                                    <h4 className="text-sm font-bold text-white">Speech-to-Text Transcription</h4>
                                    <p className="text-xs text-muted-foreground">Supports mp3, wav, m4a, ogg, webm, and mp4 audio uploads:</p>
                                    <CodeBlock title="transcribe_audio.py" code={`from openai import OpenAI

client = OpenAI(
    base_url="https://www.fluxbasedb.me/api/v1",
    api_key="flx_live_your_fluxbase_key"
)

with open("meeting_recording.mp3", "rb") as audio_file:
    transcript = client.audio.transcriptions.create(
        model="flux-listen",  # or "flux-listen-pro", "whisper-1"
        file=audio_file,
        response_format="text"
    )

print(f"Transcript: {transcript}")`} />
                                </TabsContent>

                                {/* Tab 4: Audio TTS */}
                                <TabsContent value="voice-tts" className="space-y-3 mt-4">
                                    <h4 className="text-sm font-bold text-white">Text-to-Speech Voice Synthesis</h4>
                                    <p className="text-xs text-muted-foreground">Synthesize high-fidelity voice audio across alloy, echo, fable, onyx, nova, and shimmer voices:</p>
                                    <CodeBlock title="synthesize_speech.py" code={`from openai import OpenAI

client = OpenAI(
    base_url="https://www.fluxbasedb.me/api/v1",
    api_key="flx_live_your_fluxbase_key"
)

response = client.audio.speech.create(
    model="flux-speak",      # or "flux-speak-hd", "tts-1"
    voice="alloy",           # alloy | echo | fable | onyx | nova | shimmer
    input="Welcome to Fluxbase. Your multi-tenant serverless database is ready."
)

response.stream_to_file("welcome.mp3")
print("Audio saved to welcome.mp3")`} />
                                </TabsContent>

                                {/* Tab 5: Video */}
                                <TabsContent value="video" className="space-y-3 mt-4">
                                    <h4 className="text-sm font-bold text-white">Asynchronous Video Generation & Polling</h4>
                                    <p className="text-xs text-muted-foreground">Video generation returns an async task ID with HTTP 202 Accepted. Poll the status endpoint until completed:</p>
                                    <CodeBlock title="generate_video.sh" code={`# 1. Dispatch Video Generation Task
curl -X POST https://www.fluxbasedb.me/api/v1/videos/generations \\
  -H "Authorization: Bearer flx_live_your_fluxbase_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "flux-video",
    "prompt": "A continuous drone flyover through a futuristic crystal server rack room, cinematic lighting"
  }'

# Response (HTTP 202 Accepted):
# { "task_id": "vid_abc123", "status": "PROCESSING", "poll_url": "/api/v1/videos/generations/vid_abc123" }

# 2. Poll Status until SUCCESS:
curl https://www.fluxbasedb.me/api/v1/videos/generations/vid_abc123 \\
  -H "Authorization: Bearer flx_live_your_fluxbase_key"

# When completed:
# { "task_id": "vid_abc123", "status": "SUCCESS", "video_url": "https://www.fluxbasedb.me/api/v1/media/..." }`} />
                                </TabsContent>

                                {/* Tab 6: Embeddings */}
                                <TabsContent value="embeddings" className="space-y-3 mt-4">
                                    <h4 className="text-sm font-bold text-white">768-Dimensional Text Embeddings for RAG</h4>
                                    <CodeBlock title="create_embeddings.py" code={`from openai import OpenAI

client = OpenAI(
    base_url="https://www.fluxbasedb.me/api/v1",
    api_key="flx_live_your_fluxbase_key"
)

response = client.embeddings.create(
    model="flux-embed",     # or "text-embedding-3-small"
    input=["Vector search and pgvector in Fluxbase", "Serverless PostgreSQL database"]
)

for item in response.data:
    print(f"Index {item.index}: Vector length = {len(item.embedding)}")`} />
                                </TabsContent>
                            </Tabs>

                            <h3 className="text-base font-bold text-white mt-8">Rate Limits & Quota Specifications</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm mt-3">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Subscription Tier</th>
                                            <th className="px-4 py-3">Text (RPM / TPM / Daily)</th>
                                            <th className="px-4 py-3">Images (Daily)</th>
                                            <th className="px-4 py-3">Audio (Daily)</th>
                                            <th className="px-4 py-3">Video (Daily)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        <tr className="hover:bg-secondary/70">
                                            <td className="px-4 py-3 font-semibold text-foreground/90 text-xs">Free</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">10 RPM / 10k TPM / 500 req</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">5 / day</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">20 / day</td>
                                            <td className="px-4 py-3 text-xs text-red-400 font-mono">Locked (Requires Pro)</td>
                                        </tr>
                                        <tr className="hover:bg-secondary/70">
                                            <td className="px-4 py-3 font-semibold text-blue-400 text-xs">Pro</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">60 RPM / 100k TPM / 10k req</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">50 / day</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">200 / day</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">5 / day</td>
                                        </tr>
                                        <tr className="hover:bg-secondary/70">
                                            <td className="px-4 py-3 font-semibold text-purple-400 text-xs">Max</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">300 RPM / 500k TPM / 50k req</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">200 / day</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">1,000 / day</td>
                                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">20 / day</td>
                                        </tr>
                                        <tr className="bg-emerald-500/5 hover:bg-emerald-500/10">
                                            <td className="px-4 py-3 font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                                                <Sparkles className="h-3.5 w-3.5" /> Employee / Org Owner / PAYG
                                            </td>
                                            <td className="px-4 py-3 text-xs text-emerald-300 font-mono font-bold">Unlimited</td>
                                            <td className="px-4 py-3 text-xs text-emerald-300 font-mono font-bold">Unlimited</td>
                                            <td className="px-4 py-3 text-xs text-emerald-300 font-mono font-bold">Unlimited</td>
                                            <td className="px-4 py-3 text-xs text-emerald-300 font-mono font-bold">Unlimited</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </Section>

                        {/* ── 4. Model Context Protocol (MCP) AI Gateway ── */}
                        <Section id="mcp-gateway" title="Model Context Protocol (MCP) AI Gateway" icon={Cpu}>
                            <p>
                                Fluxbase provides a built-in, native <strong className="text-foreground/90">Model Context Protocol (MCP) Gateway</strong> operating over JSON-RPC 2.0. This allows AI coding assistants like <strong className="text-foreground/90">Google Antigravity</strong>, <strong className="text-foreground/90">Cursor</strong>, <strong className="text-foreground/90">Windsurf</strong>, and <strong className="text-foreground/90">Claude Desktop</strong> to inspect database schemas, run migrations, execute SQL queries, and manage projects autonomously.
                            </p>

                            <Endpoint method="POST" path="/api/mcp" />

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                {[
                                    { name: 'create_project', desc: 'Provisions new serverless PostgreSQL or MySQL database projects.', tag: 'PROJECT' },
                                    { name: 'list_projects', desc: 'Lists all database projects owned by or shared with your account.', tag: 'DISCOVERY' },
                                    { name: 'get_schema', desc: 'Inspects live table structures, columns, types, and primary keys.', tag: 'SCHEMA' },
                                    { name: 'run_sql', desc: 'Executes raw SQL DDL and DML statements against the tenant database.', tag: 'EXECUTE' },
                                ].map((tool) => (
                                    <div key={tool.name} className="p-4 rounded-lg border border-border bg-secondary/60 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <code className="text-xs font-mono font-bold text-orange-400">{tool.name}</code>
                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tool.tag}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed">{tool.desc}</p>
                                    </div>
                                ))}
                            </div>

                            <h3 className="text-base font-bold text-white mt-8">Connecting with Google Antigravity</h3>
                            <p className="text-sm">
                                Antigravity supports MCP natively via <code className="text-xs font-mono text-foreground/80 bg-muted px-1.5 py-0.5 rounded">mcp_config.json</code>. You can configure it either at the project level or globally across all workspaces.
                            </p>

                            <div className="space-y-4 mt-2">
                                <div className="space-y-2">
                                    <h4 className="text-xs uppercase tracking-wider font-bold text-orange-400">Method 1: Workspace / Repository Setup (Recommended)</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Create or update <code className="text-xs font-mono text-foreground/80 bg-muted px-1 py-0.5 rounded">.agents/mcp_config.json</code> in your project repository root:
                                    </p>
                                    <CodeBlock title=".agents/mcp_config.json" language="json" code={`{
  "mcpServers": {
    "fluxbase": {
      "serverUrl": "https://fluxbasedb.me/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_FLUXBASE_API_TOKEN>"
      }
    }
  }
}`} />
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-xs uppercase tracking-wider font-bold text-orange-400">Method 2: Global Configuration (Machine-wide)</h4>
                                    <p className="text-xs text-muted-foreground">
                                         Add the entry to your user Antigravity configuration file:
                                    </p>
                                    <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1 pl-1">
                                        <li><strong>Windows:</strong> <code className="text-[11px] font-mono">%USERPROFILE%\.gemini\config\mcp_config.json</code></li>
                                        <li><strong>macOS / Linux:</strong> <code className="text-[11px] font-mono">~/.gemini/config/mcp_config.json</code></li>
                                    </ul>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="text-xs uppercase tracking-wider font-bold text-orange-400">Method 3: Antigravity IDE UI</h4>
                                    <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1 pl-1">
                                        <li>Open Antigravity IDE and click <strong>Additional Options (...) → MCP Servers</strong>.</li>
                                        <li>Click <strong>Add MCP Server</strong> and choose <strong>Remote HTTP / SSE</strong>.</li>
                                        <li>Enter Server URL: <code className="text-[11px] font-mono text-foreground/90">https://fluxbasedb.me/api/mcp</code></li>
                                        <li>Add Header: <code className="text-[11px] font-mono text-foreground/90">Authorization: Bearer &lt;YOUR_API_TOKEN&gt;</code> and save.</li>
                                    </ol>
                                </div>
                            </div>

                            <h3 className="text-base font-bold text-white mt-8">Connecting with Cursor & Windsurf</h3>
                            <p className="text-sm">
                                In Cursor or Windsurf, navigate to <strong>Settings → Features → MCP</strong>, click <strong>+ Add New MCP Server</strong>, and configure:
                            </p>
                            <CodeBlock title="Cursor / Windsurf MCP Configuration" language="json" code={`{
  "mcpServers": {
    "fluxbase": {
      "url": "https://fluxbasedb.me/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_FLUXBASE_API_TOKEN>"
      }
    }
  }
}`} />

                            <h3 className="text-base font-bold text-white mt-8">Connecting with Claude Desktop</h3>
                            <p className="text-sm">
                                Open <code className="text-xs font-mono text-foreground/80 bg-muted px-1.5 py-0.5 rounded">%APPDATA%\Claude\claude_desktop_config.json</code> (or <code className="text-xs font-mono text-foreground/80 bg-muted px-1.5 py-0.5 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code> on Mac) and add:
                            </p>
                            <CodeBlock title="claude_desktop_config.json" language="json" code={`{
  "mcpServers": {
    "fluxbase": {
      "url": "https://fluxbasedb.me/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_FLUXBASE_API_TOKEN>"
      }
    }
  }
}`} />

                            <h3 className="text-base font-bold text-white mt-8">Testing the Gateway from Terminal</h3>
                            <p className="text-sm">
                                You can test the JSON-RPC interface directly in your terminal using Node.js or curl:
                            </p>
                            <CodeBlock title="Test MCP Tool Discovery (tools/list)" language="bash" code={`node -e "fetch('https://fluxbasedb.me/api/mcp',{method:'POST',headers:{'Authorization':'Bearer <YOUR_API_TOKEN>','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))"`} />

                            <Callout type="info">
                                <strong>Zero Extra Context Needed:</strong> AI agents discover the tools, argument schemas, and type definitions automatically via standard JSON-RPC <code className="text-xs font-mono">tools/list</code> upon connecting.
                            </Callout>
                        </Section>

                        {/* ── 4. Core SQL API ── */}
                        <Section id="core-api" title="Core SQL API" icon={Database}>
                            <p>Execute any SQL statement against your project database via a single unified endpoint.</p>

                            <Endpoint method="POST" path="/api/execute-sql" />

                            <CodeBlock title="Request Body" language="json" code={`{
  "projectId": "YOUR_PROJECT_ID",
  "query": "SELECT * FROM users LIMIT 10;"
}`} />

                            <CodeBlock title="Success Response (200)" language="json" code={`{
  "success": true,
  "result": {
    "rows": [
      { "id": 1, "name": "Alice", "email": "alice@example.com" }
    ],
    "columns": ["id", "name", "email"],
    "rowCount": 1,
    "message": null
  },
  "executionInfo": {
    "time": "11ms",
    "rowCount": 1,
    "operation": "SELECT"
  }
}`} />

                            <CodeBlock title="Error Response (200 with error)" language="json" code={`{
  "success": false,
  "error": {
    "message": "relation \"usrs\" does not exist",
    "code": "SQL_EXEC_ERROR",
    "details": "ERROR:  42P01"
  }
}`} />

                            <Callout type="warning">
                                SQL errors return HTTP <strong>200</strong> with <code className="text-xs">success: false</code>. Always check the <code className="text-xs">success</code> field — don't rely solely on HTTP status codes.
                            </Callout>

                            <h3 className="text-base font-bold text-white mt-6">Query Parameters</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Field</th>
                                            <th className="px-4 py-3">Type</th>
                                            <th className="px-4 py-3">Required</th>
                                            <th className="px-4 py-3">Description</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { field: 'projectId', type: 'string', req: 'Yes', desc: 'Your project\'s unique identifier.' },
                                            { field: 'query', type: 'string', req: 'Yes', desc: 'The SQL statement to execute. Supports DDL and DML.' },
                                            { field: 'params', type: 'array', req: 'No', desc: 'Optional parameterized values for $1, $2, â€¦ placeholders.' },
                                        ].map(r => (
                                            <tr key={r.field} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono text-orange-300 text-xs">{r.field}</td>
                                                <td className="px-4 py-3 text-blue-300 text-xs font-mono">{r.type}</td>
                                                <td className="px-4 py-3 text-xs">{r.req === 'Yes' ? <span className="text-red-400">Yes</span> : <span className="text-muted-foreground/75">No</span>}</td>
                                                <td className="px-4 py-3 text-muted-foreground text-xs">{r.desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>

                        {/* ── 4. Language SDKs ── */}
                        <Section id="sdks" title="Language SDKs" icon={Code2}>
                            <p>No official SDK required — Fluxbase is a plain HTTP API. Here are copy-paste integration snippets for the most popular languages.</p>

                            <Tabs defaultValue="nodejs" className="w-full mt-4">
                                <TabsList className="flex flex-wrap h-auto gap-1.5 bg-secondary border border-border p-1.5 rounded-lg">
                                    {[['Node.js', 'nodejs'], ['Python', 'python'], ['Go', 'go'], ['Rust', 'rust'], ['Java', 'java'], ['PHP', 'php'], ['Ruby', 'ruby'], ['cURL', 'curl']].map(([lang, val]) => (
                                        <TabsTrigger key={val} value={val} className="data-[state=active]:bg-orange-500 data-[state=active]:text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-all">
                                            {lang}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>

                                <div className="mt-4">
                                    <TabsContent value="nodejs">
                                        <CodeBlock language="typescript" title="fluxbase.js" code={`const BASE_URL = 'https://www.fluxbasedb.me';
const API_KEY  = process.env.FLUXBASE_API_KEY;
const PROJECT  = process.env.FLUXBASE_PROJECT_ID;

async function query(sql, params = []) {
  const res = await fetch(\`\${BASE_URL}/api/execute-sql\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${API_KEY}\`,
    },
    body: JSON.stringify({ projectId: PROJECT, query: sql, params }),
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Query failed');
  return json.result.rows;
}

// Usage
const users = await query('SELECT id, name FROM users WHERE active = $1', [true]);
console.log(users);`} />
                                    </TabsContent>

                                    <TabsContent value="python">
                                        <CodeBlock language="python" title="fluxbase.py" code={`import os, requests

BASE_URL = 'https://www.fluxbasedb.me'
API_KEY  = os.getenv('FLUXBASE_API_KEY')
PROJECT  = os.getenv('FLUXBASE_PROJECT_ID')

HEADERS = {
    'Authorization': f'Bearer {API_KEY}',
    'Content-Type': 'application/json',
}

def query(sql, params=None):
    payload = {'projectId': PROJECT, 'query': sql}
    if params:
        payload['params'] = params

    resp = requests.post(f'{BASE_URL}/api/execute-sql', json=payload, headers=HEADERS)
    data = resp.json()

    if not data.get('success'):
        raise Exception(data.get('error', {}).get('message', 'Query failed'))
    return data['result']['rows']

# Usage
users = query('SELECT id, name FROM users WHERE active = $1', [True])
print(users)`} />
                                    </TabsContent>

                                    <TabsContent value="go">
                                        <CodeBlock language="go" title="fluxbase.go" code={`package fluxbase

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
)

const baseURL = "https://www.fluxbasedb.me"

type queryRequest struct {
    ProjectID string   \`json:"projectId"\`
    Query     string   \`json:"query"\`
    Params    []any    \`json:"params,omitempty"\`
}

type queryResponse struct {
    Success bool \`json:"success"\`
    Result  struct {
        Rows []map[string]any \`json:"rows"\`
    } \`json:"result"\`
    Error struct{ Message string } \`json:"error"\`
}

func Query(sql string, params ...any) ([]map[string]any, error) {
    body, _ := json.Marshal(queryRequest{
        ProjectID: os.Getenv("FLUXBASE_PROJECT_ID"),
        Query:     sql,
        Params:    params,
    })

    req, _ := http.NewRequest("POST", baseURL+"/api/execute-sql", bytes.NewBuffer(body))
    req.Header.Set("Authorization", "Bearer "+os.Getenv("FLUXBASE_API_KEY"))
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result queryResponse
    json.NewDecoder(resp.Body).Decode(&result)
    if !result.Success {
        return nil, fmt.Errorf(result.Error.Message)
    }
    return result.Result.Rows, nil
}`} />
                                    </TabsContent>

                                    <TabsContent value="rust">
                                        <CodeBlock language="rust" title="main.rs" code={`// Cargo.toml: reqwest = { version = "0.12", features = ["json"] }, serde_json
use serde_json::{json, Value};
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let api_key = env::var("FLUXBASE_API_KEY")?;
    let project = env::var("FLUXBASE_PROJECT_ID")?;

    let body = json!({
        "projectId": project,
        "query": "SELECT id, name FROM users LIMIT 5"
    });

    let resp: Value = client
        .post("https://www.fluxbasedb.me/api/execute-sql")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await?
        .json().await?;

    if !resp["success"].as_bool().unwrap_or(false) {
        eprintln!("Error: {}", resp["error"]["message"]);
        return Ok(());
    }

    println!("{:#}", resp["result"]["rows"]);
    Ok(())
}`} />
                                    </TabsContent>

                                    <TabsContent value="java">
                                        <CodeBlock language="java" title="FluxbaseClient.java" code={`import java.net.URI;
import java.net.http.*;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse.BodyHandlers;

public class FluxbaseClient {
    private static final String BASE_URL = "https://www.fluxbasedb.me";
    private final String apiKey;
    private final String projectId;
    private final HttpClient http = HttpClient.newHttpClient();

    public FluxbaseClient(String apiKey, String projectId) {
        this.apiKey = apiKey;
        this.projectId = projectId;
    }

    public String query(String sql) throws Exception {
        String body = String.format(
            "{\"projectId\":\"%s\",\"query\":\"%s\"}", projectId, sql
        );

        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(BASE_URL + "/api/execute-sql"))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json")
            .POST(BodyPublishers.ofString(body))
            .build();

        return http.send(req, BodyHandlers.ofString()).body();
    }
}`} />
                                    </TabsContent>

                                    <TabsContent value="php">
                                        <CodeBlock language="php" title="Fluxbase.php" code={`<?php

class Fluxbase {
    private string $baseUrl = 'https://www.fluxbasedb.me';
    private string $apiKey;
    private string $projectId;

    public function __construct(string $apiKey, string $projectId) {
        $this->apiKey = $apiKey;
        $this->projectId = $projectId;
    }

    public function query(string $sql, array $params = []): array {
        $payload = json_encode([
            'projectId' => $this->projectId,
            'query'     => $sql,
            'params'    => $params,
        ]);

        $ch = curl_init($this->baseUrl . '/api/execute-sql');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
        ]);

        $resp = json_decode(curl_exec($ch), true);
        curl_close($ch);

        if (!$resp['success']) {
            throw new RuntimeException($resp['error']['message'] ?? 'Query failed');
        }
        return $resp['result']['rows'];
    }
}

// Usage
$db = new Fluxbase($_ENV['FLUXBASE_API_KEY'], $_ENV['FLUXBASE_PROJECT_ID']);
$users = $db->query('SELECT * FROM users LIMIT 10');
print_r($users);`} />
                                    </TabsContent>

                                    <TabsContent value="ruby">
                                        <CodeBlock language="ruby" title="fluxbase.rb" code={`require 'uri'
require 'net/http'
require 'json'

class Fluxbase
  BASE_URL = URI('https://www.fluxbasedb.me/api/execute-sql')

  def initialize(api_key, project_id)
    @api_key    = api_key
    @project_id = project_id
  end

  def query(sql, params: [])
    http  = Net::HTTP.new(BASE_URL.host, BASE_URL.port)
    http.use_ssl = true

    req = Net::HTTP::Post.new(BASE_URL)
    req['Authorization'] = "Bearer #{@api_key}"
    req['Content-Type']  = 'application/json'
    req.body = { projectId: @project_id, query: sql, params: }.to_json

    data = JSON.parse(http.request(req).body)
    raise data.dig('error', 'message') || 'Query failed' unless data['success']
    data['result']['rows']
  end
end

# Usage
db    = Fluxbase.new(ENV['FLUXBASE_API_KEY'], ENV['FLUXBASE_PROJECT_ID'])
users = db.query('SELECT * FROM users LIMIT 5')
puts users.inspect`} />
                                    </TabsContent>

                                    <TabsContent value="curl">
                                        <CodeBlock language="bash" title="Terminal" code={`# Basic SELECT query
curl -X POST "https://www.fluxbasedb.me/api/execute-sql" \\
  -H "Authorization: Bearer $FLUXBASE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "YOUR_PROJECT_ID",
    "query": "SELECT id, name, email FROM users LIMIT 5"
  }'

# CREATE TABLE example
curl -X POST "https://www.fluxbasedb.me/api/execute-sql" \\
  -H "Authorization: Bearer $FLUXBASE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "YOUR_PROJECT_ID",
    "query": "CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, price DECIMAL(10,2))"
  }'`} />
                                    </TabsContent>
                                </div>
                            </Tabs>
                        </Section>

                        {/* ── 5. Real-time (WebSocket) ── */}
                        <Section id="realtime" title="Real-time (WebSocket)" icon={Globe}>
                            <p>
                                Fluxbase uses a persistent <strong className="text-foreground/90">WebSocket connection</strong> to push live database events to connected clients. 
                                Subscribe once and receive row changes, schema updates, and custom broadcasts — with automatic reconnection.
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
                                {[
                                    { icon: Globe, color: 'text-orange-400 bg-orange-500/10', title: 'Connect & Subscribe', desc: 'Open one WebSocket and join a project room. All events are multiplexed over a single connection.' },
                                    { icon: Database, color: 'text-blue-400 bg-blue-500/10', title: 'Receive Events', desc: 'Get db_event messages for INSERT/UPDATE/DELETE and schema_update for DDL changes.' },
                                    { icon: Cpu, color: 'text-emerald-400 bg-emerald-500/10', title: 'Auto-Reconnect', desc: 'Built-in exponential backoff (1s → 2s → 4s → 15s max). Subscriptions restore automatically.' },
                                ].map((item, i) => (
                                    <div key={i} className="p-4 rounded-lg border border-border bg-secondary/60 space-y-2">
                                        <div className={cn('w-8 h-8 flex items-center justify-center rounded-lg', item.color)}>
                                            <item.icon className="h-4 w-4" />
                                        </div>
                                        <h5 className="font-semibold text-white text-sm">{item.title}</h5>
                                        <p className="text-xs text-muted-foreground/75 leading-relaxed">{item.desc}</p>
                                    </div>
                                ))}
                            </div>

                            <CodeBlock title=".env.local" language="bash" code={`NEXT_PUBLIC_WS_URL=wss://fluxbase-realtime.onrender.com`} />

                            <Tabs defaultValue="js-rt" className="w-full mt-4">
                                <TabsList className="flex flex-wrap h-auto gap-1.5 bg-secondary border border-border p-1.5 rounded-lg">
                                    {[['JavaScript', 'js-rt'], ['Python', 'python-rt'], ['wscat (CLI)', 'wscat-rt']].map(([lang, val]) => (
                                        <TabsTrigger key={val} value={val} className="data-[state=active]:bg-orange-500 data-[state=active]:text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-all">{lang}</TabsTrigger>
                                    ))}
                                </TabsList>
                                <div className="mt-4">
                                    <TabsContent value="js-rt">
                                        <CodeBlock language="typescript" title="realtime.js" code={`const WS_URL    = process.env.NEXT_PUBLIC_WS_URL ?? 'wss://fluxbase-realtime.onrender.com';
const PROJECT_ID = 'YOUR_PROJECT_ID';

let socket;
let reconnectDelay = 1000;

function connect() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    reconnectDelay = 1000; // reset on successful connection
    socket.send(JSON.stringify({
      type:   'subscribe',
      roomId: \`project_\${PROJECT_ID}\`,
    }));
    console.log('[WS] Connected and subscribed.');
  };

  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'subscribed':
        console.log('[WS] Subscription confirmed.');
        break;

      case 'db_event': {
        const { operation, table, record, old } = msg.payload ?? {};
        if (operation === 'INSERT') console.log(\`+  \${table}\`, record);
        if (operation === 'UPDATE') console.log(\`~  \${table}\`, { old, record });
        if (operation === 'DELETE') console.log(\`-  \${table}\`, record);
        break;
      }

      default:
        if (msg.payload?.event_type === 'schema_update') {
          console.log('[WS] Schema changed — refresh your table list.');
        }
    }
  };

  socket.onclose = () => {
    console.warn(\`[WS] Disconnected. Reconnecting in \${reconnectDelay}ms...\`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };

  socket.onerror = (err) => console.error('[WS] Error:', err);
}

connect();`} />
                                    </TabsContent>
                                    <TabsContent value="python-rt">
                                        <CodeBlock language="python" title="realtime.py" code={`import json, asyncio, websockets
from websockets.exceptions import ConnectionClosed

WS_URL     = "wss://fluxbase-realtime.onrender.com"
PROJECT_ID = "YOUR_PROJECT_ID"

async def listen():
    delay = 1
    while True:
        try:
            async with websockets.connect(WS_URL) as ws:
                delay = 1  # reset on success
                await ws.send(json.dumps({
                    "type":   "subscribe",
                    "roomId": f"project_{PROJECT_ID}"
                }))
                print("Subscribed. Listeningâ€¦")

                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") == "db_event":
                        p = msg.get("payload", {})
                        print(f"[{p.get('operation')}] {p.get('table')}: {p.get('record')}")
                    elif msg.get("payload", {}).get("event_type") == "schema_update":
                        print("Schema changed — refresh table list.")

        except (ConnectionClosed, OSError):
            print(f"Disconnected. Reconnecting in {delay}sâ€¦")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)

asyncio.run(listen())`} />
                                    </TabsContent>
                                    <TabsContent value="wscat-rt">
                                        <CodeBlock language="bash" title="Terminal (wscat)" code={`# Install wscat
npm install -g wscat

# Connect
wscat -c wss://fluxbase-realtime.onrender.com

# After connecting, subscribe to your project room:
{ "type": "subscribe", "roomId": "project_YOUR_PROJECT_ID" }

# Server responds:
# { "type": "subscribed", "roomId": "project_YOUR_PROJECT_ID" }

# Then live events arrive like:
# { "type": "db_event", "payload": { "operation": "INSERT", "table": "orders", "record": { "id": 42, "total": 99.00 } } }`} />
                                    </TabsContent>
                                </div>
                            </Tabs>

                            <h3 className="text-base font-bold text-white mt-8">Event Reference</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">msg.type</th>
                                            <th className="px-4 py-3">payload details</th>
                                            <th className="px-4 py-3">When it fires</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { type: 'subscribed', event: '—', when: 'Server confirmed room subscription.' },
                                            { type: 'db_event', event: 'operation: INSERT', when: 'A row was inserted via SQL or Table Editor.' },
                                            { type: 'db_event', event: 'operation: UPDATE', when: 'A row was modified.' },
                                            { type: 'db_event', event: 'operation: DELETE', when: 'A row was removed.' },
                                            { type: 'db_event', event: 'event_type: schema_update', when: 'DDL executed (CREATE / DROP / ALTER / RENAME / TRUNCATE).' },
                                        ].map((row, i) => (
                                            <tr key={i} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono font-bold text-orange-400 text-xs">{row.type}</td>
                                                <td className="px-4 py-3 font-mono text-blue-300 text-xs">{row.event}</td>
                                                <td className="px-4 py-3 text-muted-foreground text-xs">{row.when}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>

                        {/* ── 6. Storage v2 ── */}
                        <Section id="storage" title="Storage v2" icon={HardDrive}>
                            <p>Secure AWS S3-backed file storage with logically isolated buckets, private-by-default access, and short-lived pre-signed URLs.</p>

                            {/* Buckets */}
                            <h3 className="text-base font-bold text-white mt-2">Bucket Management</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead><tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75"><th className="px-4 py-3">Method</th><th className="px-4 py-3">Endpoint</th><th className="px-4 py-3">Action</th></tr></thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { m: 'GET', path: '/api/storage/buckets?projectId=â€¦', action: 'List all buckets + total size' },
                                            { m: 'POST', path: '/api/storage/buckets', action: 'Create a bucket' },
                                            { m: 'PATCH', path: '/api/storage/buckets', action: 'Rename a bucket' },
                                            { m: 'DELETE', path: '/api/storage/buckets', action: 'Delete a bucket (must be empty)' },
                                        ].map(r => {
                                            const colors: Record<string,string> = { GET: 'text-emerald-400 bg-emerald-500/10', POST: 'text-orange-400 bg-orange-500/10', PATCH: 'text-blue-400 bg-blue-500/10', DELETE: 'text-red-400 bg-red-500/10' };
                                            return (
                                                <tr key={r.m + r.path} className="hover:bg-secondary/70">
                                                    <td className="px-4 py-3"><span className={cn('px-2 py-0.5 rounded font-bold text-xs font-mono', colors[r.m])}>{r.m}</span></td>
                                                    <td className="px-4 py-3 font-mono text-foreground/85 text-xs">{r.path}</td>
                                                    <td className="px-4 py-3 text-muted-foreground/75 text-xs">{r.action}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <CodeBlock language="json" title="POST /api/storage/buckets — Create Bucket" code={`{
  "projectId": "YOUR_PROJECT_ID",
  "name": "profile-photos",
  "isPublic": false
}
// Name rules: lowercase alphanumeric, hyphens, underscores, 1–63 chars`} />

                            {/* Files */}
                            <h3 className="text-base font-bold text-white mt-6">File Operations</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead><tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75"><th className="px-4 py-3">Method</th><th className="px-4 py-3">Endpoint</th><th className="px-4 py-3">Action</th></tr></thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { m: 'POST', path: '/api/storage/upload', action: 'Upload file (multipart/form-data)' },
                                            { m: 'GET', path: '/api/storage/files?bucketId=â€¦&projectId=â€¦', action: 'List files in a bucket' },
                                            { m: 'GET', path: '/api/storage/url?s3Key=â€¦&projectId=â€¦', action: 'Get 15-min pre-signed download URL' },
                                            { m: 'DELETE', path: '/api/storage/files', action: 'Delete a file (S3 + database)' },
                                        ].map(r => {
                                            const colors: Record<string,string> = { GET: 'text-emerald-400 bg-emerald-500/10', POST: 'text-orange-400 bg-orange-500/10', DELETE: 'text-red-400 bg-red-500/10' };
                                            return (
                                                <tr key={r.m + r.path} className="hover:bg-secondary/70">
                                                    <td className="px-4 py-3"><span className={cn('px-2 py-0.5 rounded font-bold text-xs font-mono', colors[r.m])}>{r.m}</span></td>
                                                    <td className="px-4 py-3 font-mono text-foreground/85 text-xs">{r.path}</td>
                                                    <td className="px-4 py-3 text-muted-foreground/75 text-xs">{r.action}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <h3 className="text-base font-bold text-white mt-4">Upload a File</h3>
                            <p className="text-sm">Send <code className="text-orange-300 bg-muted px-1.5 py-0.5 rounded text-xs">multipart/form-data</code> — required fields: <code className="text-foreground/85 bg-muted px-1.5 py-0.5 rounded text-xs">file</code>, <code className="text-foreground/85 bg-muted px-1.5 py-0.5 rounded text-xs">bucketId</code>, <code className="text-foreground/85 bg-muted px-1.5 py-0.5 rounded text-xs">projectId</code>. <code className="text-foreground/85 bg-muted px-1.5 py-0.5 rounded text-xs">bucketId</code> accepts the bucket UUID or name.</p>
                            <CodeBlock language="bash" title="cURL — Multipart Upload" code={`curl -X POST "https://www.fluxbasedb.me/api/storage/upload" \\
  -H "Authorization: Bearer $FLUXBASE_API_KEY" \\
  -F "file=@avatar.jpg" \\
  -F "bucketId=profile-photos" \\
  -F "projectId=YOUR_PROJECT_ID"`} />
                            <CodeBlock language="json" title="Upload Response" code={`{
  "success": true,
  "file": {
    "id": "uuid-here",
    "name": "avatar.jpg",
    "s3_key": "YOUR_PROJECT_ID/bucket-uuid/avatar.jpg",
    "size": 204800,
}`} />

                            <h3 className="text-base font-bold text-white mt-6">Delete a File</h3>
                            <Endpoint method="DELETE" path="/api/storage/delete?s3Key=â€¦&projectId=â€¦" />

                            <Callout type="info">
                                Bucket names must be unique per project. Create and manage buckets from the <strong>Storage</strong> section in your project dashboard.
                            </Callout>
                        </Section>

                        {/* ── 7. Team & Invitations ── */}
                        <Section id="team-api" title="Team & Invitations" icon={Users}>
                            <p>Manage project collaborators and send role-based invitations programmatically. All team endpoints require admin-level privileges.</p>

                            <h3 className="text-base font-bold text-white mt-2">List Team Members</h3>
                            <Endpoint method="GET" path="/api/team?projectId=YOUR_PROJECT_ID" />
                            <CodeBlock language="json" title="Response" code={`{
  "members": [
    { "userId": "usr_abc", "email": "alice@acme.com", "displayName": "Alice", "role": "admin", "joinedAt": "2026-01-10T09:00:00Z" }
  ],
  "invites": [
    { "id": "inv_xyz", "email": "bob@acme.com", "role": "developer", "invitedAt": "2026-04-14T11:00:00Z" }
  ]
}`} />

                            <h3 className="text-base font-bold text-white mt-6">Send an Invitation</h3>
                            <Endpoint method="POST" path="/api/team" />
                            <CodeBlock language="json" title="Request Body" code={`{
  "projectId": "YOUR_PROJECT_ID",
  "email": "newmember@company.com",
  "role": "developer"
}`} />
                            <div className="rounded-lg border border-border overflow-hidden text-sm mt-3">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Role</th>
                                            <th className="px-4 py-3">Permissions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { role: 'admin', perms: 'Full access — manage members, settings, billing, and data.' },
                                            { role: 'developer', perms: 'Read/write data, manage schemas. Cannot manage billing or members.' },
                                            { role: 'viewer', perms: 'Read-only access to data and the dashboard.' },
                                        ].map(r => (
                                            <tr key={r.role} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono text-orange-400 text-xs">{r.role}</td>
                                                <td className="px-4 py-3 text-muted-foreground text-xs">{r.perms}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <h3 className="text-base font-bold text-white mt-6">Accept / Reject an Invitation</h3>
                            <Endpoint method="POST" path="/api/team/invites/accept" />
                            <CodeBlock language="json" title="Request Body" code={`{
  "inviteId": "inv_xyz",
  "status": "accepted"
}`} />

                            <h3 className="text-base font-bold text-white mt-6">Remove a Member</h3>
                            <Endpoint method="DELETE" path="/api/team?projectId=YOUR_PROJECT_ID&userId=usr_abc" />

                            <Callout type="info">
                                Invitations are <strong>email-case-insensitive</strong>. Sending a new invite automatically resets any previous pending, accepted, or rejected state for that email in the project.
                            </Callout>

                            <Callout type="success">
                                <strong>Role Isolation & Owner-Driven Limits:</strong> Collaborators invited to a project retain their personal subscription tier and display as <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-emerald-300">[ DEVELOPER ] [ TEAM ]</code> without affecting their personal account billing. Meanwhile, all database limits for that project (tables, rows, instance sizes, webhooks, and scrapers) evaluate against the <strong>Project Owner's</strong> plan tier—enabling team members to work seamlessly in high-tier enterprise projects without hitting personal plan limits.
                            </Callout>
                        </Section>

                        {/* ── 8. Webhooks ── */}
                        <Section id="webhooks" title="Webhooks" icon={Webhook}>
                            <p>Webhooks are outbound HTTP POST requests sent from Fluxbase to your server when data events occur. Ideal for serverless functions (Vercel, AWS Lambda, Cloudflare Workers).</p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                                <div className="p-4 border border-border rounded-lg bg-secondary/60 space-y-3">
                                    <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                                        <Zap className="h-4 w-4 text-orange-400" /> Supported Events
                                    </h4>
                                    <ul className="space-y-1.5 text-xs text-muted-foreground font-mono">
                                        {['row.inserted', 'row.updated', 'row.deleted', 'schema.changed'].map(e => (
                                            <li key={e} className="flex items-center gap-2"><ChevronRight className="h-3 w-3 text-muted-foreground/55" />{e}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="p-4 border border-border rounded-lg bg-secondary/60 space-y-3">
                                    <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                                        <ShieldCheck className="h-4 w-4 text-emerald-400" /> Signature Verification
                                    </h4>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        Register a <strong className="text-foreground/90">Secret</strong> in your webhook config. Fluxbase signs every delivery with an <code className="text-orange-300 bg-muted px-1 rounded">X-Fluxbase-Signature</code> HMAC-SHA256 header for you to verify.
                                    </p>
                                </div>
                            </div>

                            <CodeBlock title="Webhook Payload" language="json" code={`{
  "event_type": "row.inserted",
  "project_id": "YOUR_PROJECT_ID",
  "table_id": "orders",
  "timestamp": "2026-04-14T12:00:00.000Z",
  "data": {
    "new": { "id": 123, "customer_id": 7, "amount": 59.99, "status": "pending" },
    "old": null
  }
}`} />

                            <h3 className="text-base font-bold text-white mt-6">Verifying the Signature</h3>
                            <Tabs defaultValue="node-wh" className="w-full mt-3">
                                <TabsList className="flex flex-wrap h-auto gap-1.5 bg-secondary border border-border p-1.5 rounded-lg">
                                    {[['Node.js', 'node-wh'], ['Python', 'python-wh']].map(([l, v]) => (
                                        <TabsTrigger key={v} value={v} className="data-[state=active]:bg-orange-500 data-[state=active]:text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-all">{l}</TabsTrigger>
                                    ))}
                                </TabsList>
                                <div className="mt-4">
                                    <TabsContent value="node-wh">
                                        <CodeBlock language="typescript" title="webhook-handler.js" code={`import crypto from 'crypto';

export async function POST(req) {
  const rawBody = await req.text();
  const sig     = req.headers.get('x-fluxbase-signature') ?? '';
  const secret  = process.env.FLUXBASE_WEBHOOK_SECRET;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (sig !== \`sha256=\${expected}\`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  console.log('[Webhook]', event.event_type, event.data.new);

  // Your business logic here...
  return new Response('OK', { status: 200 });
}`} />
                                    </TabsContent>
                                    <TabsContent value="python-wh">
                                        <CodeBlock language="python" title="webhook.py" code={`import hashlib, hmac, os
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.getenv('FLUXBASE_WEBHOOK_SECRET', '').encode()

@app.post('/webhook/fluxbase')
def handle():
    sig      = request.headers.get('X-Fluxbase-Signature', '')
    expected = 'sha256=' + hmac.new(SECRET, request.data, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected):
        abort(401)

    event = request.json
    print(f"[Webhook] {event['event_type']}:", event['data'].get('new'))
    return 'OK', 200`} />
                                    </TabsContent>
                                </div>
                            </Tabs>
                        </Section>

                        {/* ── 9. Error Codes ── */}
                        <Section id="error-codes" title="Error Codes" icon={AlertCircle}>
                            <p>Fluxbase uses standard HTTP status codes alongside machine-readable error codes in the response body.</p>

                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">HTTP Status</th>
                                            <th className="px-4 py-3">Error Code</th>
                                            <th className="px-4 py-3">Meaning & Fix</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { status: '401', code: 'AUTH_REQUIRED', desc: 'API key missing or malformed. Include Authorization: Bearer <key>.' },
                                            { status: '401', code: 'TOKEN_EXPIRED', desc: 'Session token has expired. Re-authenticate to get a new token.' },
                                            { status: '403', code: 'SCOPE_MISMATCH', desc: 'API key does not have access to this project or resource.' },
                                            { status: '403', code: 'PROJECT_SUSPENDED', desc: 'Project is suspended due to plan limits or billing. Upgrade your plan.' },
                                            { status: '403', code: 'INSUFFICIENT_PERMISSIONS', desc: 'Only admins can perform this action (e.g., inviting members).' },
                                            { status: '404', code: 'PROJECT_NOT_FOUND', desc: 'No project found for the given projectId. Check your ID.' },
                                            { status: '404', code: 'USER_NOT_FOUND', desc: 'Invitee email does not match any registered Fluxbase account.' },
                                            { status: '429', code: 'RATE_LIMIT', desc: '50 requests per 10 seconds exceeded. Implement exponential backoff.' },
                                            { status: '500', code: 'INTERNAL_ERROR', desc: 'Unexpected server error. These are logged and auto-reported.' },
                                            { status: '503', code: 'DATABASE_CONNECTION_ERROR', desc: 'Transient database connectivity issue. Retry after a few seconds.' },
                                            { status: '200', code: 'SQL_EXEC_ERROR', desc: 'SQL syntax or logic error. Check the error.details field for the Postgres error.' },
                                        ].map((err, i) => (
                                            <tr key={i} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{err.status}</td>
                                                <td className="px-4 py-3 font-mono font-bold text-orange-400 text-xs">{err.code}</td>
                                                <td className="px-4 py-3 text-muted-foreground text-xs">{err.desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>

                        {/* ── 10. RLS ── */}
                        <Section id="rls-tutorial" title="Row Level Security" icon={Shield}>
                            <Callout type="warning">
                                <strong>Row Level Security (RLS)</strong> enforces access rules at the <em>database engine</em> level. Your backend API can never return data that violates a policy — regardless of the SQL query sent.
                            </Callout>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                                {[
                                    { icon: KeyRound, color: 'text-blue-400 bg-blue-500/10', title: 'Auth Identity', desc: 'Your logged-in user ID is injected via SET LOCAL fluxbase.auth_uid before each query.' },
                                    { icon: Lock, color: 'text-amber-400 bg-amber-500/10', title: 'Policy Evaluation', desc: 'PostgreSQL runs your USING expression (e.g. user_id = auth.uid()) before returning any row.' },
                                    { icon: Eye, color: 'text-emerald-400 bg-emerald-500/10', title: 'Silent Filtering', desc: 'Rows that fail the policy are silently excluded — no errors, just scoped results.' },
                                ].map((item, i) => (
                                    <div key={i} className="p-4 rounded-lg border border-border bg-secondary/60 space-y-2">
                                        <div className={cn('w-8 h-8 flex items-center justify-center rounded-lg', item.color)}>
                                            <item.icon className="h-4 w-4" />
                                        </div>
                                        <h5 className="font-semibold text-white text-sm">{item.title}</h5>
                                        <p className="text-xs text-muted-foreground/75 leading-relaxed">{item.desc}</p>
                                    </div>
                                ))}
                            </div>

                            <h3 className="text-base font-bold text-white mt-8">Step-by-Step Setup</h3>
                            <div className="space-y-3">
                                {[
                                    { step: '01', title: 'Open RLS Dashboard', desc: 'Navigate to Database → Row Level Security in your project sidebar. All tables are listed.' },
                                    { step: '02', title: 'Create a Policy', desc: 'Choose a table, select command scope (ALL / SELECT / INSERT / UPDATE / DELETE), then write your USING expression.' },
                                    { step: '03', title: 'Enable the Policy', desc: 'Toggle the switch. Fluxbase immediately runs ALTER TABLE â€¦ ENABLE ROW LEVEL SECURITY and CREATE POLICY.' },
                                    { step: '04', title: 'Test in SQL Editor', desc: 'Run SELECT * FROM your_table — you\'ll only see rows that pass the policy for the authenticated user.' },
                                ].map((item) => (
                                    <div key={item.step} className="flex gap-4 p-4 rounded-lg border border-border bg-secondary/50">
                                        <span className="text-xl font-black text-orange-500/30 font-mono shrink-0 leading-none mt-0.5">{item.step}</span>
                                        <div>
                                            <h5 className="font-semibold text-white text-sm mb-1">{item.title}</h5>
                                            <p className="text-xs text-muted-foreground/75 leading-relaxed">{item.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <h3 className="text-base font-bold text-white mt-8">Common Policy Patterns</h3>
                            <div className="space-y-5">
                                <div>
                                    <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-blue-400" /><h4 className="font-semibold text-white text-sm">User Owns Their Rows</h4></div>
                                    <p className="text-xs text-muted-foreground/75 mb-2">Classic pattern for <code className="bg-muted px-1 rounded">posts</code>, <code className="bg-muted px-1 rounded">orders</code>, and <code className="bg-muted px-1 rounded">profiles</code>.</p>
                                    <CodeBlock title="USING expression" language="sql" code={`user_id = auth.uid()`} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1"><Lock className="h-4 w-4 text-purple-400" /><h4 className="font-semibold text-white text-sm">Multi-Tenant (Org-Scoped)</h4></div>
                                    <p className="text-xs text-muted-foreground/75 mb-2">All members of an organization share visibility. Set <code className="bg-muted px-1 rounded">auth.uid()</code> to the org ID at the API level.</p>
                                    <CodeBlock title="USING expression" language="sql" code={`org_id = auth.uid()`} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1"><Eye className="h-4 w-4 text-emerald-400" /><h4 className="font-semibold text-white text-sm">Public Read, Owner Write</h4></div>
                                    <p className="text-xs text-muted-foreground/75 mb-2">Create two policies on the same table with different command scopes.</p>
                                    <CodeBlock title="Policy 1 — SELECT (anyone)" language="sql" code={`true`} />
                                    <CodeBlock title="Policy 2 — INSERT / UPDATE / DELETE (owner only)" language="sql" code={`author_id = auth.uid()`} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1"><ShieldCheck className="h-4 w-4 text-red-400" /><h4 className="font-semibold text-white text-sm">Full Lockdown</h4></div>
                                    <p className="text-xs text-muted-foreground/75 mb-2">Useful for internal audit tables that no API caller should read.</p>
                                    <CodeBlock title="USING expression" language="sql" code={`false`} />
                                </div>
                            </div>

                            <h3 className="text-base font-bold text-white mt-8">Troubleshooting</h3>
                            <div className="rounded-lg border border-border overflow-hidden text-sm">
                                <table className="w-full text-left bg-card">
                                    <thead>
                                        <tr className="bg-secondary border-b border-border text-xs uppercase tracking-wide text-muted-foreground/75">
                                            <th className="px-4 py-3">Problem</th>
                                            <th className="px-4 py-3">Cause</th>
                                            <th className="px-4 py-3">Fix</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {[
                                            { prob: 'Query returns 0 rows', cause: 'Policy never matches', fix: 'Temporarily set USING to true to confirm RLS is the cause.' },
                                            { prob: 'Policy toggle fails', cause: 'Column in expression missing', fix: 'Ensure user_id (or the referenced column) exists in the table.' },
                                            { prob: 'User can\'t see own rows', cause: 'Type mismatch (INT vs TEXT)', fix: 'Cast explicitly: user_id::text = auth.uid()' },
                                            { prob: 'Admin locked out', cause: 'FORCE ROW LEVEL SECURITY active', fix: 'Run ALTER TABLE â€¦ NO FORCE ROW LEVEL SECURITY in the SQL Editor.' },
                                        ].map((row, i) => (
                                            <tr key={i} className="hover:bg-secondary/70">
                                                <td className="px-4 py-3 font-mono text-red-400 text-xs">{row.prob}</td>
                                                <td className="px-4 py-3 text-muted-foreground/75 text-xs">{row.cause}</td>
                                                <td className="px-4 py-3 text-foreground/85 text-xs">{row.fix}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Section>

                        {/* ── Footer CTA ── */}
                        <div className="pt-12 border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                            <div className="space-y-1">
                                <h4 className="text-lg font-bold text-white">Still have questions?</h4>
                                <p className="text-sm text-muted-foreground/75">Our team is available for architecture reviews and custom integration support.</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                <Button variant="outline" className="border-border bg-secondary text-foreground/85 hover:bg-muted rounded-lg" asChild>
                                    <a href="/api/docs/download-pdf" download="Fluxbase-Integration-Guide.pdf">
                                        <Download className="h-4 w-4 mr-2 text-orange-400" />PDF Guide
                                    </a>
                                </Button>
                                <Button className="bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-6 font-semibold shadow-lg shadow-orange-500/20 group" asChild>
                                    <Link href="/contact">
                                        Contact Support
                                        <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-0.5 transition-transform" />
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
