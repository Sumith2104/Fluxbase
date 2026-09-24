import { NextRequest, NextResponse } from 'next/server';
import { chatRelay, ChatWirePacket } from '@/lib/chat-relay';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const action = body.action || 'send';
        const room = (body.room || 'general').trim().toLowerCase();

        if (action === 'register_webhook') {
            const url = body.url?.trim();
            if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                return NextResponse.json({ success: false, error: 'Valid HTTP/HTTPS URL required' }, { status: 400 });
            }
            chatRelay.registerWebhook(room, url);
            return NextResponse.json({ success: true, message: `Webhook registered for room ${room}`, webhooks: chatRelay.getRegisteredWebhooks(room) });
        }

        if (action === 'clear') {
            chatRelay.clearRoom(room);
            return NextResponse.json({ success: true, message: `Room ${room} cleared` });
        }

        // Action: send message or typing
        const type = body.type; // 'message' | 'typing'
        const sender = (body.sender || 'Anonymous').trim().slice(0, 30);

        if (type === 'typing') {
            const packet: ChatWirePacket = {
                id: crypto.randomUUID(),
                room,
                sender,
                type: 'typing',
                isTyping: !!body.isTyping,
                timestamp: Date.now()
            };
            chatRelay.broadcast(packet);
            return NextResponse.json({ success: true });
        }

        if (type === 'message') {
            const { ciphertext, iv } = body;
            if (!ciphertext || !iv) {
                return NextResponse.json({ success: false, error: 'Encrypted ciphertext and IV are required' }, { status: 400 });
            }

            const packet: ChatWirePacket = {
                id: crypto.randomUUID(),
                room,
                sender,
                type: 'message',
                ciphertext,
                iv,
                timestamp: Date.now()
            };

            chatRelay.broadcast(packet);
            return NextResponse.json({ success: true, packetId: packet.id });
        }

        return NextResponse.json({ success: false, error: 'Invalid packet type' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
