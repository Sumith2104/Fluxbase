'use client';

import React, { useState, useEffect, useRef } from 'react';
import { deriveRoomKey, encryptText, decryptText } from '@/lib/e2ee-crypto';
import { Shield, Lock, Send, RefreshCw, Eye, EyeOff, Radio, Users, CheckCheck, Trash2, Webhook, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface DecryptedMessage {
    id: string;
    sender: string;
    text: string;
    timestamp: number;
    rawPacket: any;
    isOwn: boolean;
}

export function SingleChatPanel({
    room,
    passphrase,
    userName,
    onWireEvent,
    isSplitView = false
}: {
    room: string;
    passphrase: string;
    userName: string;
    onWireEvent?: (packet: any) => void;
    isSplitView?: boolean;
}) {
    const [messages, setMessages] = useState<DecryptedMessage[]>([]);
    const [input, setInput] = useState('');
    const [key, setKey] = useState<CryptoKey | null>(null);
    const [typingUser, setTypingUser] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isTypingRef = useRef(false);
    const chatBottomRef = useRef<HTMLDivElement>(null);

    // Derive CryptoKey whenever passphrase changes
    useEffect(() => {
        let isMounted = true;
        deriveRoomKey(passphrase).then(k => {
            if (isMounted) setKey(k);
        });
        return () => { isMounted = false; };
    }, [passphrase]);

    // Connect to SSE stream
    useEffect(() => {
        if (!key) return;

        setConnected(false);
        const eventSource = new EventSource(`/api/chat/stream?room=${encodeURIComponent(room)}`);

        eventSource.addEventListener('connected', () => {
            setConnected(true);
        });

        eventSource.addEventListener('packet', async (e: MessageEvent) => {
            try {
                const packet = JSON.parse(e.data);
                if (onWireEvent) onWireEvent(packet);

                if (packet.type === 'typing') {
                    if (packet.sender !== userName) {
                        if (packet.isTyping) {
                            setTypingUser(packet.sender);
                        } else {
                            setTypingUser(null);
                        }
                    }
                    return;
                }

                if (packet.type === 'presence') {
                    setMessages([]);
                    return;
                }

                if (packet.type === 'message' && packet.ciphertext && packet.iv) {
                    const decrypted = await decryptText(packet.ciphertext, packet.iv, key);
                    setMessages(prev => {
                        if (prev.some(m => m.id === packet.id)) return prev;
                        return [...prev, {
                            id: packet.id,
                            sender: packet.sender,
                            text: decrypted,
                            timestamp: packet.timestamp,
                            rawPacket: packet,
                            isOwn: packet.sender === userName
                        }];
                    });
                }
            } catch (err) {
                console.error('Failed to process incoming packet:', err);
            }
        });

        return () => {
            eventSource.close();
        };
    }, [room, key, userName]);

    // Auto scroll
    useEffect(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, typingUser]);

    // Handle typing indicator
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);

        if (!isTypingRef.current) {
            isTypingRef.current = true;
            fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, type: 'typing', sender: userName, isTyping: true })
            }).catch(() => {});
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, type: 'typing', sender: userName, isTyping: false })
            }).catch(() => {});
        }, 2000);
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || !key) return;

        // Clear typing status immediately
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        isTypingRef.current = false;
        fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room, type: 'typing', sender: userName, isTyping: false })
        }).catch(() => {});

        setInput('');

        // Encrypt using Web Crypto AES-256-GCM
        const { ciphertext, iv } = await encryptText(trimmed, key);

        // Transmit encrypted packet across the wire
        await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room,
                type: 'message',
                sender: userName,
                ciphertext,
                iv
            })
        });
    };

    return (
        <div className="flex flex-col h-full bg-[#111116] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-4 py-3 bg-[#181820] border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-bold text-white text-sm shadow-md">
                            {userName.slice(0, 2).toUpperCase()}
                        </div>
                        <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#181820] ${connected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-sm">{userName}</span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 font-mono">
                                <Lock className="w-2.5 h-2.5" /> E2EE
                            </span>
                        </div>
                        <p className="text-xs text-zinc-400">
                            {connected ? `Connected to #${room}` : 'Connecting...'}
                        </p>
                    </div>
                </div>

                <span className="text-xs font-mono text-zinc-400">
                    AES-GCM-256
                </span>
            </div>

            {/* Chat Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0c0c10]/70">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
                        <Shield className="w-8 h-8 text-emerald-500/40" />
                        <p className="text-sm font-medium text-zinc-300">End-to-End Encrypted Room</p>
                        <p className="text-xs text-zinc-500 max-w-xs">
                            Messages are encrypted in your browser before sending. Zero data is stored in the database.
                        </p>
                    </div>
                )}

                {messages.map((msg) => {
                    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                        <div
                            key={msg.id}
                            className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}
                        >
                            <div className="text-[10px] text-zinc-500 mb-0.5 px-1 font-medium">
                                {msg.isOwn ? 'You' : msg.sender}
                            </div>
                            <div
                                className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm relative group ${
                                    msg.isOwn
                                        ? 'bg-emerald-600 text-white rounded-tr-none'
                                        : 'bg-[#1c1c24] text-zinc-100 border border-white/10 rounded-tl-none'
                                }`}
                            >
                                <p className="leading-relaxed break-words">{msg.text}</p>
                                <div className="flex items-center justify-end gap-1 mt-1 text-[10px] opacity-70">
                                    <span>{timeStr}</span>
                                    {msg.isOwn && <CheckCheck className="w-3 h-3 text-emerald-200" />}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* WhatsApp-Style Typing Alert */}
                {typingUser && (
                    <div className="flex items-center gap-2 pt-1 animate-fade-in">
                        <div className="px-3.5 py-2 bg-[#1c1c24] border border-white/10 rounded-2xl rounded-tl-none flex items-center gap-2">
                            <span className="text-xs text-emerald-400 font-medium">{typingUser} is typing</span>
                            <div className="flex gap-1 items-center">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={chatBottomRef} />
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendMessage} className="p-3 bg-[#181820] border-t border-white/10 flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={handleInputChange}
                    placeholder={`Message as ${userName}...`}
                    className="flex-1 bg-[#101015] border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-zinc-500"
                />
                <button
                    type="submit"
                    disabled={!input.trim()}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-500 text-black font-semibold text-sm transition-colors flex items-center justify-center shadow-lg shadow-emerald-500/20"
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
        </div>
    );
}

export default function ChatAppInterface() {
    const [room, setRoom] = useState('demo-room');
    const [passphrase, setPassphrase] = useState('fluxbase-secure-key-2026');
    const [isSplitView, setIsSplitView] = useState(true);
    const [showKey, setShowKey] = useState(false);
    const [wirePackets, setWirePackets] = useState<any[]>([]);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
    const [showWireInspector, setShowWireInspector] = useState(true);
    const [copied, setCopied] = useState(false);

    const handleWireEvent = (packet: any) => {
        setWirePackets(prev => [packet, ...prev.slice(0, 19)]);
    };

    const handleRegisterWebhook = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!webhookUrl.trim()) return;
        setWebhookStatus('Registering...');
        try {
            const res = await fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register_webhook', room, url: webhookUrl })
            });
            const data = await res.json();
            if (data.success) {
                setWebhookStatus(`✓ Webhook registered for room #${room}!`);
            } else {
                setWebhookStatus(`Error: ${data.error}`);
            }
        } catch (err: any) {
            setWebhookStatus(`Error: ${err.message}`);
        }
    };

    const handlePurgeMemory = async () => {
        await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clear', room })
        });
        setWirePackets([]);
    };

    const copyInviteUrl = () => {
        const url = `${window.location.origin}/chat?room=${encodeURIComponent(room)}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="min-h-screen bg-[#09090c] text-white flex flex-col">
            {/* Top Bar Banner */}
            <div className="border-b border-white/10 bg-[#0f0f14]/80 backdrop-blur-md px-6 py-4">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-black font-bold shadow-lg shadow-emerald-500/20">
                                <Shield className="w-5 h-5 text-black" />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                                    Fluxbase E2EE Ephemeral Chat
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                                        Zero-DB
                                    </span>
                                </h1>
                                <p className="text-xs text-zinc-400">
                                    Client-Side Web Crypto AES-256-GCM • Realtime SSE Relay • WhatsApp Typing Alert • In-Flight Webhook Dispatch
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* View Controls */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={copyInviteUrl}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-300 flex items-center gap-1.5 transition-colors"
                        >
                            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            {copied ? 'Copied Room Link!' : 'Share Room'}
                        </button>
                        <button
                            onClick={() => setIsSplitView(!isSplitView)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                                isSplitView
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                            }`}
                        >
                            <Users className="w-3.5 h-3.5" />
                            {isSplitView ? 'Split View (Alice & Bob)' : 'Single View'}
                        </button>
                        <button
                            onClick={handlePurgeMemory}
                            className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-medium text-red-400 flex items-center gap-1.5 transition-colors"
                            title="Purge in-memory message buffer"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Purge Memory
                        </button>
                    </div>
                </div>
            </div>

            {/* Room & Passphrase Config Bar */}
            <div className="border-b border-white/5 bg-[#121217]/50 px-6 py-2.5 text-xs text-zinc-300">
                <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-zinc-500 font-mono">Room:</span>
                        <input
                            type="text"
                            value={room}
                            onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                            className="bg-[#181820] border border-white/10 rounded px-2.5 py-1 text-white font-mono focus:border-emerald-500 outline-none w-32"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-zinc-500 font-mono flex items-center gap-1">
                            <Lock className="w-3 h-3 text-emerald-400" />
                            E2EE Passphrase:
                        </span>
                        <div className="relative flex items-center">
                            <input
                                type={showKey ? 'text' : 'password'}
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                className="bg-[#181820] border border-white/10 rounded px-2.5 py-1 text-white font-mono focus:border-emerald-500 outline-none w-52 pr-8"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                className="absolute right-2 text-zinc-400 hover:text-white"
                            >
                                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    </div>

                    <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 ml-auto">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Zero database retention: messages exist only in browser memory and RAM stream</span>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="max-w-7xl mx-auto w-full p-4 md:p-6 flex-1 flex flex-col gap-6">
                {/* Chat Panels */}
                <div className={`grid gap-4 flex-1 min-h-[460px] ${isSplitView ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                    <SingleChatPanel
                        room={room}
                        passphrase={passphrase}
                        userName="Alice"
                        onWireEvent={handleWireEvent}
                        isSplitView={isSplitView}
                    />

                    {isSplitView && (
                        <SingleChatPanel
                            room={room}
                            passphrase={passphrase}
                            userName="Bob"
                            onWireEvent={handleWireEvent}
                            isSplitView={isSplitView}
                        />
                    )}
                </div>

                {/* Wire Inspector & Webhooks Section */}
                <div className="border border-white/10 rounded-2xl bg-[#101015] overflow-hidden shadow-xl">
                    <button
                        onClick={() => setShowWireInspector(!showWireInspector)}
                        className="w-full px-5 py-3.5 bg-[#16161d] flex items-center justify-between hover:bg-[#1a1a23] transition-colors"
                    >
                        <div className="flex items-center gap-2.5">
                            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                            <span className="font-semibold text-sm text-white">Live Wire Inspector & Webhook Dispatcher</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                                {wirePackets.length} packets intercepted
                            </span>
                        </div>
                        {showWireInspector ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                    </button>

                    {showWireInspector && (
                        <div className="p-5 space-y-6">
                            {/* Webhook Register */}
                            <div>
                                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Webhook className="w-3.5 h-3.5 text-teal-400" />
                                    Dispatch Live Webhook to External Endpoint
                                </h3>
                                <form onSubmit={handleRegisterWebhook} className="flex gap-2 max-w-xl">
                                    <input
                                        type="url"
                                        value={webhookUrl}
                                        onChange={(e) => setWebhookUrl(e.target.value)}
                                        placeholder="https://webhook.site/your-unique-id (or any webhook URL)"
                                        className="flex-1 bg-[#181822] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-400 font-mono"
                                    />
                                    <button
                                        type="submit"
                                        className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-black font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-md"
                                    >
                                        Register Webhook
                                    </button>
                                </form>
                                {webhookStatus && (
                                    <p className="text-xs text-teal-400 mt-2 font-mono">{webhookStatus}</p>
                                )}
                            </div>

                            {/* Raw Wire Packets (Proof of Zero Plaintext) */}
                            <div>
                                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                                    <span>Raw Wire Stream (Ciphertext over Network)</span>
                                    <span className="text-[11px] text-zinc-500 font-normal">Notice: Zero plaintext ever touches the wire</span>
                                </h3>
                                <div className="bg-[#09090c] border border-white/5 rounded-xl p-3 max-h-48 overflow-y-auto font-mono text-[11px] space-y-2">
                                    {wirePackets.length === 0 ? (
                                        <p className="text-zinc-600 italic">Send a message or type to watch real encrypted packets stream here...</p>
                                    ) : (
                                        wirePackets.map((pkt, idx) => (
                                            <div key={idx} className="p-2 rounded bg-white/[0.02] border border-white/5 flex flex-col gap-1">
                                                <div className="flex items-center justify-between text-zinc-400">
                                                    <span className="text-emerald-400 font-bold">TYPE: {pkt.type.toUpperCase()}</span>
                                                    <span>SENDER: {pkt.sender}</span>
                                                    <span>TIME: {new Date(pkt.timestamp).toLocaleTimeString()}</span>
                                                </div>
                                                {pkt.ciphertext ? (
                                                    <div className="text-amber-400/90 break-all">
                                                        <span className="text-zinc-500">CIPHERTEXT (AES-256): </span>
                                                        {pkt.ciphertext}
                                                        <span className="text-zinc-500 ml-2">IV: </span>
                                                        {pkt.iv}
                                                    </div>
                                                ) : pkt.type === 'typing' ? (
                                                    <div className="text-teal-400">
                                                        isTyping: {pkt.isTyping ? 'TRUE' : 'FALSE'}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
