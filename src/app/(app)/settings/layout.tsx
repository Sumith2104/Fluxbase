'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Settings, Key, Webhook, Bot, Activity, Users, Bell, Archive, BookOpen, CreditCard } from 'lucide-react';
import { BackButton } from "@/components/back-button";

const sidebarNavItems = [
    {
        title: "General",
        href: "/settings",
        icon: Settings,
    },
    {
        title: "Billing & Usage",
        href: "/settings/billing",
        icon: CreditCard,
    },
    {
        title: "API Keys",
        href: "/settings/api-keys",
        icon: Key,
    },
    {
        title: "Webhooks",
        href: "/settings/webhooks",
        icon: Webhook,
    },
    {
        title: "Limits & Alerts",
        href: "/settings/limits",
        icon: Activity,
    },
    {
        title: "Team & Audit",
        href: "/settings/team",
        icon: Users,
    },
    {
        title: "Alerting",
        href: "/settings/alerts",
        icon: Bell,
    },
    {
        title: "Backups",
        href: "/settings/backups",
        icon: Archive,
    },
    {
        title: "AI Assistant",
        href: "/settings/ai",
        icon: Bot,
    },
    {
        title: "Documentation",
        href: "/settings/docs",
        icon: BookOpen,
    },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="w-full max-w-full space-y-6 overflow-x-hidden pb-16">
            <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                <BackButton />
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
                    <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                        Manage your workspace, API keys, integrations, and preferences.
                    </p>
                </div>
            </div>
            
            <div className="flex min-w-0 flex-col space-y-6 lg:flex-row lg:space-x-8 lg:space-y-0 items-start">
                <aside
                    className="w-full lg:w-56 shrink-0 lg:sticky lg:top-4 lg:self-start max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar"
                >
                    <nav className="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 overflow-x-auto pb-2 lg:pb-0 hide-scrollbar">
                        {sidebarNavItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = pathname === item.href;
                            
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted hover:text-foreground flex-shrink-0 whitespace-nowrap transition-colors",
                                        isActive ? "bg-muted text-foreground font-medium" : "text-muted-foreground font-normal"
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {item.title}
                                </Link>
                            )
                        })}
                    </nav>
                </aside>
                <div className="min-w-0 flex-1 w-full">{children}</div>
            </div>
        </div>
    );
}

