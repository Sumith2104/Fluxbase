import { NextRequest } from 'next/server';
import { chatRelay, ChatWirePacket } from '@/lib/chat-relay';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const room = (searchParams.get('room') || 'general').trim().toLowerCase();

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const sendEvent = (event: string, data: any) => {
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // Client disconnected
                }
            };

            // 1. Send initial connected event + ephemeral in-memory history
            sendEvent('connected', { room, timestamp: Date.now() });

            const history = chatRelay.getEphemeralHistory(room);
            for (const packet of history) {
                sendEvent('packet', packet);
            }

            // 2. Subscribe to room broadcast events
            const onPacket = (packet: ChatWirePacket) => {
                sendEvent('packet', packet);
            };

            const roomEvent = `room:${room}`;
            chatRelay.on(roomEvent, onPacket);

            // 3. Keepalive ping every 15s
            const pingInterval = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(': ping\n\n'));
                } catch {
                    clearInterval(pingInterval);
                }
            }, 15000);

            // 4. Cleanup when client disconnects
            req.signal.addEventListener('abort', () => {
                clearInterval(pingInterval);
                chatRelay.off(roomEvent, onPacket);
            });
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
