'use client';

import { useState, useEffect, useCallback, useContext } from 'react';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ProjectContext } from '@/contexts/project-context';
import {
    LayoutDashboard, Table, Database, BrainCircuit, BarChart3,
    Code, Globe, Folder, Settings, Search, ArrowRight,
    Users, Key, Webhook, Shield, GitBranch,
    Bell, Archive, CreditCard
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

interface CommandItem {
    id: string;
    label: string;
    description?: string;
    icon: React.ReactNode;
    href: string;
    category: string;
    keywords?: string[];
}

const getStaticItems = (projectId?: string): CommandItem[] => {
    const projectHref = (path: string) => projectId ? `${path}?projectId=${projectId}` : '#';

    return [
        // Navigation
        { id: 'dashboard', label: 'Dashboard', description: 'View analytics & overview', icon: <LayoutDashboard className="h-4 w-4" />, href: '/dashboard', category: 'Navigation', keywords: ['home', 'overview'] },
        { id: 'editor', label: 'Table Editor', description: 'Browse & edit table data', icon: <Table className="h-4 w-4" />, href: projectHref('/editor'), category: 'Navigation', keywords: ['tables', 'data', 'rows'] },
        { id: 'database', label: 'Database', description: 'Manage schema & structure', icon: <Database className="h-4 w-4" />, href: projectHref('/database'), category: 'Navigation', keywords: ['schema', 'columns'] },
        { id: 'query', label: 'SQL Editor', description: 'Run SQL queries', icon: <BrainCircuit className="h-4 w-4" />, href: projectHref('/query'), category: 'Navigation', keywords: ['sql', 'query', 'select'] },
        { id: 'analytics', label: 'Analytics', description: 'View usage analytics', icon: <BarChart3 className="h-4 w-4" />, href: projectHref('/analytics'), category: 'Navigation', keywords: ['charts', 'metrics', 'stats'] },
        { id: 'api', label: 'API', description: 'REST API explorer', icon: <Code className="h-4 w-4" />, href: projectHref('/api'), category: 'Navigation', keywords: ['rest', 'endpoint'] },
        { id: 'scraper', label: 'Scraper', description: 'Web scraping tools', icon: <Globe className="h-4 w-4" />, href: projectHref('/scraper'), category: 'Navigation', keywords: ['crawl', 'web'] },
        { id: 'storage', label: 'Storage', description: 'File & object storage', icon: <Folder className="h-4 w-4" />, href: projectHref('/storage'), category: 'Navigation', keywords: ['files', 's3', 'upload'] },
        // Settings
        { id: 'settings', label: 'Settings', description: 'Project settings', icon: <Settings className="h-4 w-4" />, href: projectHref('/settings'), category: 'Settings', keywords: ['config', 'preferences'] },
        { id: 'billing', label: 'Billing & Usage', description: 'Plans, usage meters & invoices', icon: <CreditCard className="h-4 w-4" />, href: projectHref('/settings/billing'), category: 'Settings', keywords: ['billing', 'subscription', 'plan', 'invoices', 'payg'] },
        { id: 'api-keys', label: 'API Keys', description: 'Manage API keys', icon: <Key className="h-4 w-4" />, href: projectHref('/settings/api-keys'), category: 'Settings', keywords: ['tokens', 'auth'] },
        { id: 'webhooks', label: 'Webhooks', description: 'Manage webhook endpoints', icon: <Webhook className="h-4 w-4" />, href: projectHref('/settings/webhooks'), category: 'Settings', keywords: ['events', 'notifications'] },
        // New pages
        { id: 'team', label: 'Team & Audit', description: 'Manage members & view audit log', icon: <Users className="h-4 w-4" />, href: projectHref('/settings/team'), category: 'Settings', keywords: ['members', 'audit', 'roles'] },
        { id: 'rls', label: 'Row Level Security', description: 'Manage access policies', icon: <Shield className="h-4 w-4" />, href: projectHref('/database/rls'), category: 'Security', keywords: ['policies', 'rls', 'access'] },
        { id: 'migrations', label: 'Migrations', description: 'Database migration history', icon: <GitBranch className="h-4 w-4" />, href: projectHref('/database/migrations'), category: 'Database', keywords: ['flyway', 'schema', 'version'] },
        { id: 'alerts', label: 'Alerts', description: 'Set threshold alerts', icon: <Bell className="h-4 w-4" />, href: projectHref('/settings/alerts'), category: 'Settings', keywords: ['notifications', 'threshold'] },
        { id: 'backups', label: 'Backups', description: 'Restore from backup', icon: <Archive className="h-4 w-4" />, href: projectHref('/settings/backups'), category: 'Settings', keywords: ['restore', 'snapshot', 'recovery'] },
    ];
};

const categoryColors: Record<string, string> = {
    Navigation: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    Settings: 'bg-secondary text-muted-foreground border-border',
    Security: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Database: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(0);
    const router = useRouter();
    const { project } = useContext(ProjectContext);

    const items = getStaticItems(project?.project_id);
    const filtered = search.trim()
        ? items.filter(item =>
            item.label.toLowerCase().includes(search.toLowerCase()) ||
            item.description?.toLowerCase().includes(search.toLowerCase()) ||
            item.keywords?.some(k => k.toLowerCase().includes(search.toLowerCase()))
        )
        : items;

    // Group by category
    const grouped = filtered.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
    }, {} as Record<string, CommandItem[]>);

    const flatFiltered = Object.values(grouped).flat();

    const navigate = useCallback((item: CommandItem) => {
        if (item.href === '#') return;
        setOpen(false);
        setSearch('');
        router.push(item.href);
    }, [router]);

    useKeyboardShortcuts([
        {
            combination: { key: 'k', ctrl: true },
            handler: () => setOpen(o => !o),
            description: 'Toggle Command Palette'
        }
    ]);

    useEffect(() => {
        setSelected(0);
    }, [search]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flatFiltered.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
            if (e.key === 'Enter' && flatFiltered[selected]) { navigate(flatFiltered[selected]); }
            if (e.key === 'Escape') { setOpen(false); }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, flatFiltered, selected, navigate]);

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/40 hover:bg-muted/70 border border-border rounded-md transition-all h-8 min-w-[140px]"
                id="command-palette-trigger"
            >
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:block truncate">Search...</span>
                <kbd className="hidden sm:flex ml-auto pointer-events-none items-center gap-0.5 rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground">
                    <span>⌘</span><span>K</span>
                </kbd>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden bg-card border-border">
                    <DialogTitle className="sr-only">Command Palette</DialogTitle>
                    <div className="flex items-center border-b border-border px-3 pr-12">
                        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Input
                            autoFocus
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search pages, features, settings..."
                            className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-12 text-sm placeholder:text-muted-foreground"
                            id="command-palette-input"
                        />
                        <kbd className="shrink-0 rounded border border-border/80 px-1.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto p-2">
                        {flatFiltered.length === 0 && (
                            <div className="py-12 text-center text-sm text-muted-foreground">No results for &ldquo;{search}&rdquo;</div>
                        )}
                        {Object.entries(grouped).map(([category, catItems]) => (
                            <div key={category} className="mb-1">
                                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/75">{category}</p>
                                {catItems.map((item) => {
                                    const globalIdx = flatFiltered.indexOf(item);
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => navigate(item)}
                                            className={cn(
                                                'w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors text-left group',
                                                globalIdx === selected ? 'bg-muted text-white' : 'text-foreground/85 hover:bg-muted/80'
                                            )}
                                            id={`cmd-item-${item.id}`}
                                        >
                                            <span className={cn('p-1.5 rounded-md border', categoryColors[item.category] || 'bg-muted text-muted-foreground')}>
                                                {item.icon}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{item.label}</div>
                                                {item.description && <div className="text-xs text-muted-foreground/75 truncate">{item.description}</div>}
                                            </div>
                                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/55 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-border px-3 py-2 flex items-center gap-3 text-[10px] text-muted-foreground/55">
                        <span><kbd className="rounded border border-border/80 px-1 font-mono">↑↓</kbd> navigate</span>
                        <span><kbd className="rounded border border-border/80 px-1 font-mono">â†µ</kbd> open</span>
                        <span><kbd className="rounded border border-border/80 px-1 font-mono">esc</kbd> close</span>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
