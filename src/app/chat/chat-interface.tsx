'use client';

import React, { useState, useEffect, useRef } from 'react';
import { deriveRoomKey, encryptText, decryptText } from '@/lib/e2ee-crypto';
import { 
    Shield, Lock, Send, Copy, Check, Radio, 
    Share2, UserCheck, MessageSquare, ChevronDown, ChevronUp, Webhook, Trash2, KeyRound
} from 'lucide-react';

interface DecryptedMessage {
    id: string;
    sender: string;
    text: string;
    timestamp: number;
    rawPacket: any;
    isOwn: boolean;
}

export default function WhatsAppChatInterface() {
    // URL param extraction for seamless 1-click friend invites
    const [room, setRoom] = useState('friends-chat');
    const [passphrase, setPassphrase] = useState('fluxbase-secure-e2ee');
    const [myUserName, setMyUserName] = useState('');
    const [otherUserName, setOtherUserName] = useState<string>('Friend');
    const [nameModalOpen, setNameModalOpen] = useState(false);
    const [tempName, setTempName] = useState('');

    const [messages, setMessages] = useState<DecryptedMessage[]>([]);
    const [input, setInput] = useState('');
    const [key, setKey] = useState<CryptoKey | null>(null);
    const [typingUser, setTypingUser] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [copied, setCopied] = useState(false);

    // Wire inspector states
    const [showWireInspector, setShowWireInspector] = useState(false);
    const [wirePackets, setWirePackets] = useState<any[]>([]);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookStatus, setWebhookStatus] = useState<string | null>(null);

    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isTypingRef = useRef(false);
    const chatBottomRef = useRef<HTMLDivElement>(null);

    // 1. Initial setup from URL / localStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const params = new URLSearchParams(window.location.search);
        const urlRoom = params.get('room');
        const urlKey = params.get('key');
        const savedName = localStorage.getItem('fluxbase_e2ee_name');

        if (urlRoom) setRoom(urlRoom.trim().toLowerCase());
        if (urlKey) setPassphrase(urlKey.trim());

        if (savedName) {
            setMyUserName(savedName);
        } else {
            // Pick default or prompt
            const randomId = Math.floor(1000 + Math.random() * 9000);
            const defaultName = `User_${randomId}`;
            setMyUserName(defaultName);
            setTempName(defaultName);
            setNameModalOpen(true);
        }
    }, []);

    // 2. Derive 256-bit AES-GCM Key when passphrase changes
    useEffect(() => {
        let isMounted = true;
        deriveRoomKey(passphrase).then(k => {
            if (isMounted) setKey(k);
        });
        return () => { isMounted = false; };
    }, [passphrase]);

    // 3. Connect to Realtime Server-Sent Events (SSE) Stream
    useEffect(() => {
        if (!key || !myUserName) return;

        setConnected(false);
        const eventSource = new EventSource(`/api/chat/stream?room=${encodeURIComponent(room)}`);

        eventSource.addEventListener('connected', () => {
            setConnected(true);
        });

        eventSource.addEventListener('packet', async (e: MessageEvent) => {
            try {
                const packet = JSON.parse(e.data);
                
                // Track in wire inspector
                setWirePackets(prev => [packet, ...prev.slice(0, 19)]);

                // Typing event
                if (packet.type === 'typing') {
                    if (packet.sender !== myUserName) {
                        setOtherUserName(packet.sender);
                        if (packet.isTyping) {
                            setTypingUser(packet.sender);
                        } else {
                            setTypingUser(null);
                        }
                    }
                    return;
                }

                // Presence / Room Purge
                if (packet.type === 'presence') {
                    setMessages([]);
                    return;
                }

                // Encrypted message
                if (packet.type === 'message' && packet.ciphertext && packet.iv) {
                    if (packet.sender !== myUserName) {
                        setOtherUserName(packet.sender);
                    }
                    const decrypted = await decryptText(packet.ciphertext, packet.iv, key);
                    setMessages(prev => {
                        if (prev.some(m => m.id === packet.id)) return prev;
                        return [...prev, {
                            id: packet.id,
                            sender: packet.sender,
                            text: decrypted,
                            timestamp: packet.timestamp,
                            rawPacket: packet,
                            isOwn: packet.sender === myUserName
                        }];
                    });
                }
            } catch (err) {
                console.error('[Chat] Packet decode error:', err);
            }
        });

        return () => {
            eventSource.close();
        };
    }, [room, key, myUserName]);

    // Auto-scroll to bottom like WhatsApp
    useEffect(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, typingUser]);

    // WhatsApp-style typing dispatcher (debounced to 1400ms)
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);

        if (!isTypingRef.current) {
            isTypingRef.current = true;
            fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, type: 'typing', sender: myUserName, isTyping: true })
            }).catch(() => {});
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room, type: 'typing', sender: myUserName, isTyping: false })
            }).catch(() => {});
        }, 1400);
    };

    // Send encrypted message
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || !key) return;

        // Immediately clear typing indicator
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        isTypingRef.current = false;
        fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room, type: 'typing', sender: myUserName, isTyping: false })
        }).catch(() => {});

        setInput('');

        // 1. Client-Side WebCrypto AES-256-GCM Encryption
        const { ciphertext, iv } = await encryptText(trimmed, key);

        // 2. Transmit ciphertext + iv over ephemeral SSE relay (Zero DB)
        await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                room,
                type: 'message',
                sender: myUserName,
                ciphertext,
                iv
            })
        });
    };

    const copyInviteUrl = () => {
        const url = `${window.location.origin}/chat?room=${encodeURIComponent(room)}&key=${encodeURIComponent(passphrase)}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    const saveName = () => {
        const final = tempName.trim() || myUserName || 'User';
        setMyUserName(final);
        localStorage.setItem('fluxbase_e2ee_name', final);
        setNameModalOpen(false);
    };

    const handlePurgeMemory = async () => {
        if (!confirm('Clear all in-memory ephemeral messages in this room?')) return;
        await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clear', room })
        });
        setMessages([]);
        setWirePackets([]);
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
                setWebhookStatus(`✓ Webhook registered for #${room}`);
            } else {
                setWebhookStatus(`Error: ${data.error}`);
            }
        } catch (err: any) {
            setWebhookStatus(`Error: ${err.message}`);
        }
    };

    return (
        <div className="h-screen w-screen bg-[#0c1317] flex flex-col overflow-hidden text-[#e9edef] select-none font-sans">
            {/* Top Global Navigation Bar */}
            <div className="bg-[#202c33] border-b border-[#2a3942] px-4 py-2.5 flex items-center justify-between text-xs shrink-0 z-20">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                        <Shield className="w-4 h-4" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-sm">Fluxbase E2EE Private Chat</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono border border-emerald-500/30">
                                Zero-DB
                            </span>
                        </div>
                        <p className="text-[11px] text-[#8696a0]">
                            Client-Side AES-256-GCM • Ephemeral RAM Relay • Zero Database Storage
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={copyInviteUrl}
                        className="px-3.5 py-1.5 rounded-lg bg-[#25d366] hover:bg-[#20ba59] text-black font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                        title="Copy direct invite link for your friend with auto-configured room and encryption key"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-black" /> : <Share2 className="w-3.5 h-3.5" />}
                        {copied ? 'Link Copied! Send to Friend' : 'Invite Friend'}
                    </button>

                    <button
                        onClick={() => { setTempName(myUserName); setNameModalOpen(true); }}
                        className="px-3 py-1.5 rounded-lg bg-[#111b21] hover:bg-[#2a3942] border border-[#2a3942] text-xs text-[#d1d7db] flex items-center gap-1.5 transition-colors"
                    >
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>You: <strong className="text-white">{myUserName || 'Set Name'}</strong></span>
                    </button>

                    <button
                        onClick={handlePurgeMemory}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-[#8696a0] hover:text-red-400 transition-colors"
                        title="Purge Ephemeral Memory"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Main WhatsApp Window Container */}
            <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto my-0 sm:my-3 sm:border sm:border-[#2a3942] sm:rounded-2xl overflow-hidden shadow-2xl bg-[#0b141a] relative">
                
                {/* WhatsApp Chat Header */}
                <div className="bg-[#202c33] px-4 py-3 border-b border-[#2a3942] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-white text-sm shadow">
                                {(otherUserName || 'F').slice(0, 1).toUpperCase()}
                            </div>
                            <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#202c33] ${connected ? 'bg-[#25d366]' : 'bg-amber-500 animate-pulse'}`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="font-semibold text-white text-base leading-tight">
                                    {otherUserName || 'Waiting for friend...'}
                                </h2>
                                <span className="text-[10px] text-[#25d366] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1">
                                    <Lock className="w-2.5 h-2.5" /> End-to-End Encrypted
                                </span>
                            </div>

                            {/* WhatsApp Status Subtitle: Shows "typing..." in animated emerald green */}
                            <div className="h-4 flex items-center">
                                {typingUser ? (
                                    <p className="text-xs text-[#25d366] font-medium flex items-center gap-1 animate-pulse">
                                        <span>typing...</span>
                                    </p>
                                ) : (
                                    <p className="text-xs text-[#8696a0]">
                                        {connected ? `Room #${room}` : 'connecting to room...'}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Room & Key Badge */}
                    <div className="flex items-center gap-2 text-xs">
                        <span className="hidden sm:inline text-[#8696a0] font-mono text-[11px]">
                            AES-256-GCM
                        </span>
                    </div>
                </div>

                {/* WhatsApp Chat Message List */}
                <div 
                    className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-[#0b141a]"
                    style={{
                        backgroundImage: `radial-gradient(#1f2c34 1px, transparent 1px)`,
                        backgroundSize: '24px 24px'
                    }}
                >
                    {/* E2EE Info Bubble */}
                    <div className="flex justify-center my-2">
                        <div className="bg-[#182229] border border-[#2a3942] rounded-lg px-4 py-2 text-center max-w-md shadow">
                            <p className="text-[11px] text-[#ffd279] flex items-center justify-center gap-1.5 font-medium">
                                <Lock className="w-3 h-3 text-[#ffd279]" />
                                Messages are end-to-end encrypted.
                            </p>
                            <p className="text-[11px] text-[#8696a0] mt-0.5">
                                No one outside of this chat, not even Fluxbase or database tables, can read them.
                            </p>
                        </div>
                    </div>

                    {/* Messages */}
                    {messages.map((msg) => {
                        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        return (
                            <div
                                key={msg.id}
                                className={`flex flex-col ${msg.isOwn ? 'items-end' : 'items-start'}`}
                            >
                                {!msg.isOwn && (
                                    <span className="text-[11px] text-[#25d366] font-medium mb-0.5 px-2">
                                        {msg.sender}
                                    </span>
                                )}
                                <div
                                    className={`max-w-[85%] sm:max-w-[70%] rounded-xl px-3.5 py-2 shadow-sm text-sm relative break-words ${
                                        msg.isOwn
                                            ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none'
                                            : 'bg-[#202c33] text-[#e9edef] rounded-tl-none border border-white/5'
                                    }`}
                                >
                                    <p className="leading-relaxed select-text">{msg.text}</p>
                                    <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] text-[#8696a0] select-none">
                                        <span>{timeStr}</span>
                                        {msg.isOwn && (
                                            <span className="text-[#53bdeb] font-bold">✓✓</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* WhatsApp-Style In-Chat Animated Typing Bubble */}
                    {typingUser && (
                        <div className="flex flex-col items-start pt-1 animate-in fade-in duration-200">
                            <span className="text-[11px] text-[#25d366] font-medium mb-1 px-2">
                                {typingUser}
                            </span>
                            <div className="bg-[#202c33] border border-[#2a3942] rounded-2xl rounded-tl-none px-4 py-3 shadow-md flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-[#25d366] animate-bounce [animation-delay:-0.32s]" />
                                <span className="w-2 h-2 rounded-full bg-[#25d366] animate-bounce [animation-delay:-0.16s]" />
                                <span className="w-2 h-2 rounded-full bg-[#25d366] animate-bounce" />
                            </div>
                        </div>
                    )}

                    <div ref={chatBottomRef} />
                </div>

                {/* WhatsApp Chat Input Bar */}
                <form 
                    onSubmit={handleSendMessage}
                    className="bg-[#202c33] px-3 sm:px-4 py-3 border-t border-[#2a3942] flex items-center gap-2 shrink-0"
                >
                    <input
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        placeholder={myUserName ? `Type a message as ${myUserName}...` : 'Type a message...'}
                        className="flex-1 bg-[#2a3942] text-white text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#25d366] placeholder-[#8696a0] transition-all"
                        autoFocus
                    />
                    <button
                        type="submit"
                        disabled={!input.trim()}
                        className="w-10 h-10 rounded-full bg-[#25d366] hover:bg-[#20ba59] disabled:opacity-30 disabled:hover:bg-[#25d366] text-black font-semibold flex items-center justify-center transition-all shadow-md shrink-0 active:scale-95"
                    >
                        <Send className="w-4 h-4 text-black ml-0.5" />
                    </button>
                </form>

                {/* Bottom Collapsible Tray: Raw Wire & Webhook Inspector */}
                <div className="border-t border-[#2a3942] bg-[#111b21] shrink-0">
                    <button
                        onClick={() => setShowWireInspector(!showWireInspector)}
                        className="w-full px-4 py-2 flex items-center justify-between text-[#8696a0] hover:text-white transition-colors text-xs"
                    >
                        <span className="flex items-center gap-2">
                            <Radio className="w-3.5 h-3.5 text-emerald-400" />
                            Live Wire Inspector & Webhooks
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#202c33] text-[#25d366] font-mono">
                                Zero-DB Proof
                            </span>
                        </span>
                        {showWireInspector ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>

                    {showWireInspector && (
                        <div className="p-4 border-t border-[#2a3942] space-y-4 max-h-56 overflow-y-auto text-xs">
                            {/* Webhook tester */}
                            <div>
                                <p className="text-[#8696a0] mb-1.5 flex items-center gap-1.5 font-medium">
                                    <Webhook className="w-3.5 h-3.5 text-teal-400" />
                                    Forward real-time chat events to any Webhook URL:
                                </p>
                                <form onSubmit={handleRegisterWebhook} className="flex gap-2">
                                    <input
                                        type="url"
                                        value={webhookUrl}
                                        onChange={(e) => setWebhookUrl(e.target.value)}
                                        placeholder="https://webhook.site/your-id"
                                        className="flex-1 bg-[#202c33] border border-[#2a3942] rounded px-3 py-1.5 text-xs text-white font-mono focus:border-teal-400 outline-none"
                                    />
                                    <button
                                        type="submit"
                                        className="px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-black font-semibold rounded text-xs"
                                    >
                                        Register
                                    </button>
                                </form>
                                {webhookStatus && <p className="text-teal-400 text-[11px] mt-1 font-mono">{webhookStatus}</p>}
                            </div>

                            {/* Ciphertext Packets */}
                            <div>
                                <p className="text-[#8696a0] mb-1 font-mono text-[11px]">
                                    Live Wire Packets (Actual Payload Traveling Over HTTP/SSE):
                                </p>
                                <div className="bg-[#0b141a] border border-[#2a3942] rounded-lg p-2.5 space-y-1.5 font-mono text-[10px]">
                                    {wirePackets.length === 0 ? (
                                        <p className="text-[#8696a0] italic">Type or send a message to inspect encrypted network packets...</p>
                                    ) : (
                                        wirePackets.slice(0, 5).map((pkt, idx) => (
                                            <div key={idx} className="p-1.5 rounded bg-[#111b21] border border-[#2a3942]/60">
                                                <div className="flex justify-between text-[#8696a0]">
                                                    <span className="text-[#25d366] font-bold">TYPE: {pkt.type.toUpperCase()}</span>
                                                    <span>FROM: {pkt.sender}</span>
                                                    <span>{new Date(pkt.timestamp).toLocaleTimeString()}</span>
                                                </div>
                                                {pkt.ciphertext && (
                                                    <div className="text-amber-300 break-all mt-1">
                                                        CIPHERTEXT: {pkt.ciphertext}
                                                    </div>
                                                )}
                                                {pkt.type === 'typing' && (
                                                    <div className="text-teal-400">
                                                        isTyping: {pkt.isTyping ? 'TRUE' : 'FALSE'}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Set Name Modal */}
            {nameModalOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-[#202c33] border border-[#2a3942] rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-[#25d366] flex items-center justify-center">
                                <UserCheck className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-white">Enter Your Name</h3>
                                <p className="text-xs text-[#8696a0]">Your friend will see this name when chatting.</p>
                            </div>
                        </div>

                        <input
                            type="text"
                            value={tempName}
                            onChange={(e) => setTempName(e.target.value)}
                            placeholder="e.g. Sumith"
                            className="w-full bg-[#111b21] border border-[#2a3942] rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#25d366]"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
                        />

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={saveName}
                                className="w-full py-2.5 rounded-xl bg-[#25d366] hover:bg-[#20ba59] text-black font-semibold text-sm transition-colors shadow-md"
                            >
                                Start Chatting
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
