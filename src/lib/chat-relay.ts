import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface ChatWirePacket {
    id: string;
    room: string;
    sender: string;
    type: 'message' | 'typing' | 'presence';
    // For encrypted messages:
    ciphertext?: string;
    iv?: string;
    // For typing indicators:
    isTyping?: boolean;
    timestamp: number;
}

class ChatRelayService extends EventEmitter {
    // In-memory ephemeral message buffer (max 20 messages per room, never written to DB)
    private roomBuffers: Map<string, ChatWirePacket[]> = new Map();
    // In-memory webhook subscribers per room: room -> webhookUrl[]
    private roomWebhooks: Map<string, Set<string>> = new Map();

    constructor() {
        super();
        this.setMaxListeners(0); // Unlimited room listeners
    }

    public broadcast(packet: ChatWirePacket) {
        // Emit to SSE listeners
        this.emit(`room:${packet.room}`, packet);

        // If it's a message, keep in ephemeral ring buffer (max 20)
        if (packet.type === 'message') {
            let buf = this.roomBuffers.get(packet.room);
            if (!buf) {
                buf = [];
                this.roomBuffers.set(packet.room, buf);
            }
            buf.push(packet);
            if (buf.length > 20) {
                buf.shift();
            }

            // Trigger registered webhooks asynchronously (Non-blocking)
            this.dispatchWebhooks(packet).catch(err => {
                console.warn('[ChatRelay] Webhook dispatch error:', err.message);
            });
        }
    }

    public getEphemeralHistory(room: string): ChatWirePacket[] {
        return this.roomBuffers.get(room) || [];
    }

    public clearRoom(room: string) {
        this.roomBuffers.delete(room);
        this.emit(`room:${room}`, {
            id: crypto.randomUUID(),
            room,
            sender: 'system',
            type: 'presence',
            timestamp: Date.now()
        });
    }

    public registerWebhook(room: string, url: string) {
        let set = this.roomWebhooks.get(room);
        if (!set) {
            set = new Set();
            this.roomWebhooks.set(room, set);
        }
        set.add(url);
    }

    public getRegisteredWebhooks(room: string): string[] {
        return Array.from(this.roomWebhooks.get(room) || []);
    }

    private async dispatchWebhooks(packet: ChatWirePacket) {
        const webhooks = this.roomWebhooks.get(packet.room);
        if (!webhooks || webhooks.size === 0) return;

        const payload = JSON.stringify({
            event: 'chat.e2ee_message',
            room: packet.room,
            sender: packet.sender,
            ciphertext: packet.ciphertext,
            iv: packet.iv,
            timestamp: packet.timestamp,
            notice: 'End-to-End Encrypted: Raw plaintext is strictly unavailable to server'
        });

        const signature = crypto.createHmac('sha256', 'fluxbase-e2ee-secret').update(payload).digest('hex');

        for (const url of webhooks) {
            try {
                await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Fluxbase-E2EE-Chat-Webhook/1.0',
                        'X-Fluxbase-Signature': `sha256=${signature}`
                    },
                    body: payload,
                    signal: AbortSignal.timeout(3000)
                });
            } catch (err: any) {
                console.warn(`[ChatRelay] Failed to deliver webhook to ${url}:`, err.message);
            }
        }
    }
}

// Preserve across Next.js dev reloads
const globalAny = global as any;
if (!globalAny.__fluxbaseChatRelay) {
    globalAny.__fluxbaseChatRelay = new ChatRelayService();
}

export const chatRelay: ChatRelayService = globalAny.__fluxbaseChatRelay;
