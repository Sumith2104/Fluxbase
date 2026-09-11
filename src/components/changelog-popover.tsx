'use client';

import { useState } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Zap, Shield, GitBranch, BarChart3, Bell, Plug } from 'lucide-react';
import { FluxAiIcon } from '@/components/ui/flux-ai-icon';
import { cn } from '@/lib/utils';

interface ChangelogEntry {
    date: string;
    version: string;
    type: 'new' | 'improved' | 'fixed' | 'security';
    title: string;
    description: string;
    icon: React.ReactNode;
}

const CHANGELOG: ChangelogEntry[] = [
    {
        date: '29 Mar 2026',
        version: 'v2.4',
        type: 'new',
        title: 'Command Palette',
        description: 'Press ⌘K to search and navigate anywhere in Fluxbase instantly.',
        icon: <Zap className="h-3.5 w-3.5" />,
    },
    {
        date: '29 Mar 2026',
        version: 'v2.4',
        type: 'new',
        title: 'Row Level Security Editor',
        description: 'Define SQL-based access policies per table to control who can read, insert, update, or delete rows.',
        icon: <Shield className="h-3.5 w-3.5" />,
    },
    {
        date: '29 Mar 2026',
        version: 'v2.4',
        type: 'new',
        title: 'Database Migrations',
        description: 'Versioned schema migrations with up/down scripts. Full history with rollback support.',
        icon: <GitBranch className="h-3.5 w-3.5" />,
    },
    {
        date: '29 Mar 2026',
        version: 'v2.4',
        type: 'improved',
        title: 'Real-Time Analytics',
        description: 'Live Sessions now tracks real concurrent connections via Redis. Fixed recursive analytics spike.',
        icon: <BarChart3 className="h-3.5 w-3.5" />,
    },
    {
        date: '28 Mar 2026',
        version: 'v2.3',
        type: 'new',
        title: 'Threshold Alerts',
        description: 'Set alerts on row counts, request volume, or storage size. Get notified via email or webhook.',
        icon: <Bell className="h-3.5 w-3.5" />,
    },
    {
        date: '28 Mar 2026',
        version: 'v2.3',
        type: 'improved',
        title: 'Webhooks Delivery History',
        description: 'View every webhook delivery attempt, response codes, and retry failed events from the UI.',
        icon: <Plug className="h-3.5 w-3.5" />,
    },
    {
        date: '27 Mar 2026',
        version: 'v2.2',
        type: 'security',
        title: 'API Key Scoping',
        description: 'API keys now support read-only, write-only, and admin permission scopes per project.',
        icon: <Shield className="h-3.5 w-3.5" />,
    },
];

const typeConfig = {
    new: { label: 'New', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
    improved: { label: 'Improved', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
    fixed: { label: 'Fixed', className: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
    security: { label: 'Security', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

export function ChangelogPopover() {
    const [open, setOpen] = useState(false);
    // Track new entries (unread) — in a real app, persist last-seen version in localStorage
    const [lastSeen, setLastSeen] = useState<string | null>(() => {
        if (typeof window !== 'undefined') return localStorage.getItem('flux_changelog_seen');
        return null;
    });

    const newCount = CHANGELOG.filter(e => e.date > (lastSeen || '2020-01-01')).length;

    const handleOpen = (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen) {
            const today = new Date().toISOString().split('T')[0];
            localStorage.setItem('flux_changelog_seen', today);
            setLastSeen(today);
        }
    };

    return (
        <Popover open={open} onOpenChange={handleOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="relative h-8 gap-1.5 text-muted-foreground hover:text-foreground px-2"
                    id="changelog-button"
                >
                    <Megaphone className="h-4 w-4" />
                    <span className="hidden md:inline text-xs">What&apos;s New</span>
                    {newCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500 text-[8px] font-bold text-white">
                            {newCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0 bg-card border-border max-h-[480px] flex flex-col" align="end">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
                    <FluxAiIcon size={16} />
                    <div>
                        <h4 className="font-semibold text-sm text-foreground">What&apos;s New</h4>
                        <p className="text-[10px] text-muted-foreground">Latest updates to Fluxbase</p>
                    </div>
                </div>
                <div className="overflow-y-auto flex-1">
                    {CHANGELOG.map((entry, i) => {
                        const { label, className } = typeConfig[entry.type];
                        return (
                            <div
                                key={i}
                                className={cn(
                                    'px-4 py-3 border-b border-border/60 last:border-0 hover:bg-secondary/70 transition-colors',
                                )}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="p-1.5 rounded-md bg-muted text-foreground/85 shrink-0 mt-0.5">
                                        {entry.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                            <span className="text-sm font-medium text-foreground">{entry.title}</span>
                                            <Badge variant="outline" className={cn('text-[9px] h-4 px-1.5 py-0', className)}>
                                                {label}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed">{entry.description}</p>
                                        <p className="text-[10px] text-muted-foreground/55 mt-1">{entry.date} Â· {entry.version}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
