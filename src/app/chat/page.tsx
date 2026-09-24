import { Metadata } from 'next';
import ChatAppInterface from './chat-interface';

export const metadata: Metadata = {
    title: 'E2EE Ephemeral Chat | Fluxbase',
    description: 'End-to-End Encrypted Ephemeral Chat with Zero Database Storage, WhatsApp-style typing alerts, and realtime webhook dispatch.',
};

export default function ChatPage() {
    return <ChatAppInterface />;
}
