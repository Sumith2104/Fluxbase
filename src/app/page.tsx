
import { NextIntlClientProvider } from 'next-intl';
import HomeClient from './home-client';
import { Metadata } from 'next';
import messagesEn from '../../messages/en.json';
import { getCurrentUserId } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-static';

export const metadata: Metadata = {
    title: 'Fluxbase - The Intelligent AI Spreadsheet',
    description: 'The intelligent spreadsheet that thinks like a human. Build powerful databases, automate workflows, and collaborate in real-time.',
};

export default function Home() {
    // Manually load 'en' locale and messages since we are bypassing middleware routing
    const locale = 'en';
    const messages = messagesEn;

    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
            <HomeClient />
        </NextIntlClientProvider>
    );
}
