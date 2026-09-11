
'use client';

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { BorderBeam } from "@/components/ui/border-beam";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { User } from "@/lib/auth";
import { Project } from "@/lib/data";
import { ProjectSwitcher } from "@/components/project-switcher";
import { useEffect, useState, useContext } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { getAppLayoutBootstrapData, logoutAction } from "./actions";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectProvider, ProjectContext } from "@/contexts/project-context";
import { TimezoneSelector } from "@/components/timezone-selector";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";
import { FluxAiIcon } from "@/components/ui/flux-ai-icon";
import Dock from "@/components/dock";
// Phase 5+6: Lazy-load heavy components â€” they are NOT needed on initial page render.
// FluxAiAssistant: 555 lines, speech synthesis, complex state.
// CommandPalette: opened only on Ctrl+K.
const FluxAiAssistant = dynamic(
    () => import('@/components/flux-ai-assistant').then(m => m.FluxAiAssistant),
    { ssr: false }
);
const CommandPalette = dynamic(
    () => import('@/components/command-palette').then(m => m.CommandPalette),
    { ssr: false }
);
const InvitationAlerts = dynamic(
    () => import('@/components/team/invitation-alerts').then(m => m.InvitationAlerts),
    { ssr: false }
);
import { FeedbackWidget } from "@/components/feedback-widget";
import { ChangelogPopover } from "@/components/changelog-popover";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { StatusIndicator } from "@/components/status-indicator";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { PremiumLoader } from "@/components/ui/premium-loader";
import {
    LayoutDashboard,
    BrainCircuit,
    Folder,
    Settings as SettingsIcon,
    Table,
    Database,
    Globe,
    ServerCrash,
    BarChart3,
    AlertTriangle,
    Sparkles,
    SquareTerminal,
    LogOut,
    CreditCard,
    Users,
    KeyRound,
    BookOpen,
    Search
} from "lucide-react";


const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard /> },
    { href: "/editor", label: "Table Editor", icon: <Table /> },
    { href: "/database", label: "Database", icon: <Database /> },
    { href: "/query", label: "SQL Editor", icon: <SquareTerminal /> },
    { href: "/analytics", label: "Analytics", icon: <BarChart3 /> },
    { href: "/scraper", label: "Scraper", icon: <Globe /> },
    { href: "/storage", label: "Storage", icon: <Folder /> },
    { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

function AppLayoutContent({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();

    const [user, setUser] = useState<User | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [planType, setPlanType] = useState<string>('Free');
    const [isOffline, setIsOffline] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [invitations, setInvitations] = useState<any[]>([]);
    const [userLoading, setUserLoading] = useState(true);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const { project: selectedProject, setProject, loading: projectContextLoading, isSuspended, setIsSuspended } = useContext(ProjectContext);
    const [isAiOpen, setIsAiOpen] = useState(false);

    // Maintain persistent global/project realtime WebSocket subscription across the app
    useRealtimeSubscription(selectedProject?.project_id || 'global');

    // Real-time synchronization for projects list across top navbar & application
    useEffect(() => {
        const handleProjectChange = async (e?: Event) => {
            const customEvent = e as CustomEvent;
            const detail = customEvent?.detail;

            // 1. Optimistic instant UI update (0ms latency)
            if (detail?.action === 'INSERT' && (detail?.record || detail?.project || detail?.data)) {
                const newProj: Project = detail.record || detail.project || detail.data;
                if (newProj && newProj.project_id) {
                    setProjects(prev => {
                        if (prev.some(p => p.project_id === newProj.project_id)) return prev;
                        return [newProj, ...prev];
                    });
                }
            } else if (detail?.action === 'DELETE') {
                const delId = detail?.record?.project_id || detail?.projectId || detail?.data?.project_id;
                if (delId) {
                    setProjects(prev => prev.filter(p => p.project_id !== delId));
                    if (selectedProject?.project_id === delId) {
                        setProject(null);
                    }
                }
            }

            // 2. Fetch fresh projects from server to ensure complete sync
            try {
                const res = await fetch('/api/projects');
                const data = await res.json();
                if (data.success && Array.isArray(data.projects)) {
                    setProjects(data.projects);
                    if (!selectedProject && data.projects.length > 0) {
                        setProject({ ...data.projects[0], role: data.projects[0].role || 'admin' });
                    }
                }
            } catch (err) {
                console.error("[Layout] Failed to refresh projects in background:", err);
            }
        };

        window.addEventListener('flux:project-change', handleProjectChange);
        window.addEventListener('flux:projects-refresh', handleProjectChange);
        return () => {
            window.removeEventListener('flux:project-change', handleProjectChange);
            window.removeEventListener('flux:projects-refresh', handleProjectChange);
        };
    }, [selectedProject?.project_id, setProject]);

    useEffect(() => {
        async function fetchData() {
            setUserLoading(true);
            setLoadingProgress(10); // Initialization started
            try {
                // SINGLE ROUND TRIP Consolidating:
                // checkDatabaseHealth, getCurrentUserId, findUserById, getUserPlan, getProjects
                const data = await getAppLayoutBootstrapData();
                setLoadingProgress(70); // Server processing complete

                if ('error' in data) {
                    console.error("Bootstrap error:", data.error);
                    setLoadingProgress(100);
                    return;
                }

                if (data.isOffline) {
                    setIsOffline(true);
                    setUserLoading(false);
                    return;
                }

                setUserId(data.userId || null);

                if (data.userId) {
                    setUser(data.user || null);

                    if (data.plan) {
                        const rawType = data.plan.type?.toLowerCase();
                        if (rawType === 'max') setPlanType('Max');
                        else if (rawType === 'pro') setPlanType('Pro');
                        else if (rawType === 'employee') setPlanType('Employee');
                        else if (rawType === 'org_owner') setPlanType('Org Owner');
                        else if (rawType === 'pay_as_you_go') setPlanType('Pay-As-You-Go');
                        else setPlanType('Free');
                        setIsSuspended(data.plan.status === 'suspended');
                    }

                    setProjects(data.projects || []);
                    setInvitations(data.invitations || []);

                    if (selectedProject) {
                        const freshProj = data.projects?.find(p => p.project_id === selectedProject.project_id);
                        if (freshProj) {
                            const enriched = {
                                ...selectedProject,
                                ...freshProj,
                                role: freshProj.role || selectedProject.role || 'admin',
                                schema_name: freshProj.schema_name || selectedProject.schema_name || `flux_tenant_${freshProj.project_id}`,
                                is_serverless: true
                            };
                            if (
                                !selectedProject.role ||
                                !selectedProject.schema_name ||
                                freshProj.billing_preference !== selectedProject.billing_preference ||
                                freshProj.creator_role !== selectedProject.creator_role ||
                                freshProj.display_name !== selectedProject.display_name
                            ) {
                                setProject(enriched);
                            }
                        } else if (!data.projects?.some(p => p.project_id === selectedProject.project_id)) {
                            if (data.projects && data.projects.length > 0) {
                                setProject({ ...data.projects[0], role: data.projects[0].role || 'admin' });
                            } else {
                                setProject(null);
                            }
                        }
                    } else if (data.projects && data.projects.length > 0) {
                        setProject({ ...data.projects[0], role: data.projects[0].role || 'admin' });
                    }
                }

                setLoadingProgress(100);
            } catch (error) {
                console.error("Failed to fetch layout data:", error);
                setLoadingProgress(100);
            } finally {
                setUserLoading(false);
            }
        }
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Real-time Session Tracking
    useEffect(() => {
        if (userId && selectedProject?.project_id) {
            import('@/lib/track-session').then(({ trackSession }) => {
                trackSession(selectedProject.project_id, userId);
            });
        }
    }, [userId, selectedProject?.project_id, pathname]); // Re-track on page shifts too

    // Redirect logic
    useEffect(() => {
        // [STABILITY FIX]: If the app is in Offline Mode (DB Down), do not redirect to login.
        // This prevents an infinite loop where DB failure -> assumes logged out -> redirects to home -> home redirects to app.
        if (isOffline) return;

        // [STABILITY FIX]: Removed client-side redirect to root.
        // Middleware handles this before page load. Removing this prevents the infinite "ping-pong" redirect loop
        // that occurs when the client state is briefly null during hydration.
        if (!userLoading && !userId && !isOffline) {
            router.push('/');
            return;
        }

        const isProjectSelectionPage = pathname.startsWith('/dashboard/projects');
        const isSettingsPage = pathname.startsWith('/settings');

        // If user is logged-in but no project is selected, redirect to project selection page
        // [Requirement 4] Allow settings page access even without a project
        if (!selectedProject && !isProjectSelectionPage && !isSettingsPage) {
            router.push('/dashboard/projects');
        }

    }, [userLoading, projectContextLoading, userId, selectedProject, pathname, router, isOffline]);

    // Prefetch high-frequency routes in the background as soon as a project is active
    useEffect(() => {
        if (selectedProject?.project_id) {
            const pid = selectedProject.project_id;
            router.prefetch(`/editor?projectId=${pid}`);
            router.prefetch(`/database?projectId=${pid}`);
            router.prefetch(`/query?projectId=${pid}`);
            router.prefetch(`/settings?projectId=${pid}`);
            router.prefetch(`/analytics?projectId=${pid}`);
        }
    }, [selectedProject?.project_id, router]);

    const isEditorOrDbPage = pathname.startsWith('/editor') || pathname.startsWith('/database') || pathname.startsWith('/query');
    const isLoading = userLoading || projectContextLoading;

    const toolItems = navItems.slice(0, -1).map(item => {
        const isProjectSpecific = ["/editor", "/storage", "/query", "/database", "/analytics", "/scraper"].includes(item.href);
        const isDisabled = isProjectSpecific && !selectedProject?.project_id;
        let finalHref = item.href;

        if (isProjectSpecific && selectedProject?.project_id) {
            finalHref = `${item.href}?projectId=${selectedProject.project_id}`;
        }

        const isActive = item.href === '/dashboard'
            ? pathname.startsWith('/dashboard')
            : (pathname === item.href || pathname.startsWith(`${item.href}/`));

        return {
            ...item,
            isActive,
            isDisabled,
            onMouseEnter: () => {
                if (!isDisabled) {
                    router.prefetch(finalHref);
                }
            },
            onClick: () => {
                if (!isDisabled) {
                    router.push(finalHref);
                }
            },
        };
    });

    const searchItem = {
        icon: <Search />,
        label: "Search (⌘K)",
        isSeparatorBefore: true,
        onClick: () => {
            const el = document.getElementById('command-palette-trigger');
            if (el) el.click();
            else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        },
    };

    const settingsNavItem = navItems[navItems.length - 1];
    const settingsHref = selectedProject?.project_id ? `/settings?projectId=${selectedProject.project_id}` : '/settings';
    const isSettingsActive = pathname.startsWith('/settings');

    const settingsItem = {
        ...settingsNavItem,
        isActive: isSettingsActive,
        badgeCount: invitations?.length > 0 ? invitations.length : undefined,
        onMouseEnter: () => router.prefetch(settingsHref),
        onClick: () => router.push(settingsHref),
    };

    const dockItems = [...toolItems, searchItem, settingsItem];

    // Global Keyboard Shortcuts
    useKeyboardShortcuts([
        {
            combination: 'g d',
            handler: () => router.push('/dashboard'),
            description: 'Go to Dashboard'
        },
        {
            combination: 'g e',
            handler: () => selectedProject?.project_id ? router.push(`/editor?projectId=${selectedProject.project_id}`) : router.push('/dashboard/projects'),
            description: 'Go to Table Editor'
        },
        {
            combination: 'g b',
            handler: () => selectedProject?.project_id ? router.push(`/database?projectId=${selectedProject.project_id}`) : router.push('/dashboard/projects'),
            description: 'Go to Database'
        },
        {
            combination: 'g q',
            handler: () => selectedProject?.project_id ? router.push(`/query?projectId=${selectedProject.project_id}`) : router.push('/dashboard/projects'),
            description: 'Go to SQL Editor'
        },
        {
            combination: 'g a',
            handler: () => selectedProject?.project_id ? router.push(`/analytics?projectId=${selectedProject.project_id}`) : router.push('/dashboard/projects'),
            description: 'Go to Analytics'
        },
        {
            combination: 'g s',
            handler: () => selectedProject?.project_id ? router.push(`/settings?projectId=${selectedProject.project_id}`) : router.push('/dashboard/projects'),
            description: 'Go to Settings'
        },
        {
            combination: 'g w',
            handler: () => selectedProject?.project_id ? router.push(`/scraper?projectId=${selectedProject.project_id}`) : router.push('/dashboard/projects'),
            description: 'Go to Scraper'
        },
    ], !!userId);


    if (isLoading) {
        return <PremiumLoader text="Initializing Fluxbase..." progress={loadingProgress} />;
    }

    if (isOffline) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background text-center px-4">
                <div className="bg-destructive/10 p-6 rounded-full mb-6">
                    <ServerCrash className="h-12 w-12 text-destructive" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">We'll be right back</h1>
                <p className="text-muted-foreground text-lg max-w-md mx-auto mb-8">
                    Fluxbase is currently undergoing scheduled maintenance or the database is temporarily offline. Please check back shortly.
                </p>
                <Button onClick={() => window.location.reload()}>Try Again</Button>
            </div>
        );
    }

    if (!isLoading && !userId && !pathname.startsWith('/login') && !pathname.startsWith('/signup')) {
        return <div className="flex items-center justify-center h-screen">Redirecting to login...</div>;
    }

    // Use display_name if available, otherwise email prefix.
    const displayName = (user as any)?.display_name || (user?.email?.split('@')[0]) || 'User';
    const orgName = user ? `${displayName}'s Org` : "My Org";
    const avatarFallback = displayName.charAt(0).toUpperCase();
    const headerTitle = selectedProject
        ? `${orgName} / ${selectedProject.display_name}`
        : orgName;

    const shouldShowDock = userId && (selectedProject || pathname.startsWith('/dashboard/projects'));

    return (
        <div className="flex h-screen w-full max-w-full flex-col overflow-hidden bg-background text-foreground">
            {isSuspended ? (
                <div className="bg-destructive text-destructive-foreground text-center py-1.5 px-4 text-xs font-semibold flex items-center justify-center gap-2 z-50">
                    <AlertTriangle className="h-4 w-4" />
                    Your organization is currently suspended. Database access and webhooks are disabled.
                    <Link href="/settings" className="underline underline-offset-2 ml-1 opacity-90 hover:opacity-100">Resume in Settings</Link>
                </div>
            ) : selectedProject?.status === 'suspended' ? (
                <div className="bg-amber-600 text-white text-center py-1.5 px-4 text-xs font-semibold flex items-center justify-center gap-2 z-50">
                    <AlertTriangle className="h-4 w-4" />
                    This project is currently suspended. API and SQL access are disabled.
                    <Link href="/settings" className="underline underline-offset-2 ml-1 opacity-90 hover:opacity-100">Manage in Settings</Link>
                </div>
            ) : null}
            <header className="sticky top-0 z-40 flex h-12 max-w-full items-center gap-2 border-b border-border bg-background/95 px-2 backdrop-blur-md sm:gap-4 sm:px-4 md:px-6">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                className="group relative hidden rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:block cursor-pointer transition-transform duration-150 hover:scale-105"
                                title="Open account menu"
                            >
                                <BorderBeam size="sm" colorVariant="ocean" borderRadius={9999} className="rounded-full">
                                    <Avatar className="h-8 w-8 shrink-0">
                                        {(user as any)?.photo_url && <AvatarImage src={(user as any).photo_url} referrerPolicy="no-referrer" />}
                                        <AvatarFallback>{avatarFallback}</AvatarFallback>
                                    </Avatar>
                                </BorderBeam>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56 p-1.5 shadow-xl">
                            <DropdownMenuLabel className="font-normal px-2 py-1.5">
                                <div className="flex flex-col space-y-1">
                                    <p className="text-xs font-semibold leading-none text-foreground truncate">
                                        {(user as any)?.name || (user as any)?.email?.split('@')[0] || 'User'}
                                    </p>
                                    <p className="text-[11px] leading-none text-muted-foreground truncate font-mono">
                                        {(user as any)?.email || ''}
                                    </p>
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem asChild>
                                    <Link href="/settings" className="flex items-center gap-2 cursor-pointer text-xs">
                                        <SettingsIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>Account Settings</span>
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/settings/billing" className="flex items-center gap-2 cursor-pointer text-xs">
                                        <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>Billing & Usage</span>
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/settings/team" className="flex items-center gap-2 cursor-pointer text-xs">
                                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>Team Management</span>
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/settings/api-keys" className="flex items-center gap-2 cursor-pointer text-xs">
                                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>API Keys</span>
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/docs" className="flex items-center gap-2 cursor-pointer text-xs">
                                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>Documentation</span>
                                    </Link>
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={async () => {
                                    await logoutAction();
                                    router.push('/');
                                    router.refresh();
                                }}
                                className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer text-xs"
                            >
                                <LogOut className="h-3.5 w-3.5" />
                                <span>Log out</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <ProjectSwitcher
                        headerTitle={headerTitle}
                        orgName={orgName}
                        projects={projects}
                        selectedProject={selectedProject}
                    />
                    {selectedProject && (() => {
                        const liveProject = projects.find(p => p.project_id === selectedProject.project_id) || selectedProject;
                        const accountRole = (user as any)?.plan_type || (user as any)?.user_role || liveProject.creator_role || 'student';
                        const effectiveRole = accountRole === 'employee' || accountRole === 'org_owner' ? accountRole : (liveProject.creator_role || 'student');
                        const isStudent = effectiveRole === 'student';
                        const rawBilling = liveProject.billing_preference || selectedProject.billing_preference || (user as any)?.billing_preference;
                        const billingPlan = (rawBilling === 'pay_as_you_go' || planType === 'Pay-As-You-Go' || (user as any)?.plan_type === 'pay_as_you_go')
                            ? 'pay_as_you_go'
                            : (rawBilling === 'hybrid' ? 'hybrid' : 'fixed');

                        const projectRole = liveProject.role || selectedProject.role || 'admin';
                        const roleLabel = effectiveRole === 'org_owner' ? 'Owner' : (effectiveRole === 'employee' ? 'Emp' : 'Student');
                        const planLabel = isStudent
                            ? (planType === 'Max' ? 'Max' : (planType === 'Pro' ? 'Pro' : 'Free'))
                            : (billingPlan === 'pay_as_you_go' ? 'PAY-AS-YOU-GO' : (billingPlan === 'hybrid' ? 'Hybrid' : 'Fixed'));

                        const isMysqlDialect = liveProject.dialect?.toLowerCase() === 'mysql';

                        return (
                            <div className="flex items-center gap-1.5">
                                {/* Dialect Badge (PostgreSQL / MySQL) */}
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        "hidden sm:inline-flex transition-colors shadow-none text-[9px] uppercase font-bold tracking-wider rounded-md border font-mono",
                                        isMysqlDialect
                                            ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
                                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                    )}
                                >
                                    {isMysqlDialect ? 'MySQL' : 'PostgreSQL'}
                                </Badge>

                                {/* 1. Project Role / Ownership Badge (Admin, Developer, Viewer) */}
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        "hidden sm:inline-flex transition-colors shadow-none text-[9px] uppercase font-bold tracking-wider rounded-md border font-mono",
                                        projectRole === 'admin' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                                        projectRole === 'developer' && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
                                        projectRole === 'viewer' && "bg-secondary text-muted-foreground border-border"
                                    )}
                                >
                                    {projectRole}
                                </Badge>

                                {/* 2. Role Badge (Student, Emp, Owner) */}
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        "hidden sm:inline-flex transition-colors shadow-none text-[9px] uppercase font-bold tracking-wider rounded-md border font-mono",
                                        effectiveRole === 'org_owner' && "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
                                        effectiveRole === 'employee' && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
                                        effectiveRole === 'student' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    )}
                                >
                                    {roleLabel}
                                </Badge>

                                {/* 3. Plan Name Badge (Free, Pro, Max for Student | Fixed, Pay-As-You-Go, Hybrid for Emp/Owner) */}
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "hidden sm:inline-flex transition-colors shadow-none text-[9px] uppercase font-bold tracking-wider rounded-md font-mono",
                                        isStudent
                                            ? (planType === 'Max'
                                                ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-500"
                                                : planType === 'Pro'
                                                    ? "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-500"
                                                    : "border-muted-foreground/30 bg-muted/10 text-muted-foreground")
                                            : (billingPlan === 'pay_as_you_go'
                                                ? "border-purple-500/50 bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                                : billingPlan === 'hybrid'
                                                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                    : "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400")
                                    )}
                                >
                                    {planLabel}
                                </Badge>
                            </div>
                        );
                    })()}
                    <div className="hidden md:block">
                        <TimezoneSelector />
                    </div>
                </div>
                <div className="hidden sm:flex sm:flex-1"></div>
                {userId ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                        <div className="hidden sm:block">
                            <CommandPalette />
                        </div>
                        <div className="w-px h-5 bg-border mx-1 hidden md:block" />
                        <StatusIndicator />
                        <div className="hidden sm:block">
                            <ChangelogPopover />
                        </div>
                        <div className="hidden sm:block">
                            <FeedbackWidget />
                        </div>
                        <div className="hidden sm:block">
                            <KeyboardShortcuts />
                        </div>
                        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
                        {userId && (
                            <BorderBeam size="sm" colorVariant="ocean" borderRadius={8} className="rounded-lg">
                                <button
                                    onClick={() => setIsAiOpen(true)}
                                    className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all text-xs font-medium group cursor-pointer"
                                    title="Open Flux AI Assistant"
                                >
                                    <span className="relative flex items-center justify-center">
                                        <FluxAiIcon size={14} />
                                        <span className="absolute -top-1 -right-1 h-1.5 w-1.5 bg-emerald-400 rounded-full animate-pulse" />
                                    </span>
                                    <span className="hidden md:block">Flux AI</span>
                                </button>
                            </BorderBeam>
                        )}
                    </div>
                ) : (
                    <Button asChild variant="outline" size="sm">
                        <Link href="/login">Login</Link>
                    </Button>
                )}
            </header>
            <div className="relative flex min-w-0 flex-1 overflow-hidden">
                <main className={cn("flex-1 flex flex-col overflow-hidden bg-background", {
                    "pt-0 px-0 pb-36 md:pb-0": isEditorOrDbPage,
                    "p-3 sm:p-4 md:p-6 pb-36 md:pb-24": !isEditorOrDbPage,
                })}>
                    {userId && <InvitationAlerts initialInvites={invitations} />}
                    <div data-scroll-container="true" className={cn("flex-1 min-h-0 h-full flex flex-col", isEditorOrDbPage ? "overflow-hidden" : "overflow-auto")}>{children}</div>
                    {shouldShowDock && (
                        <div className="pointer-events-none fixed bottom-1.5 sm:bottom-2 left-0 right-0 z-50 flex justify-center px-2">
                            <Dock items={dockItems} className="pointer-events-auto" />
                        </div>
                    )}
                    {userId && <FluxAiAssistant key={userId} userId={userId} isOpen={isAiOpen} onOpenChange={setIsAiOpen} />}
                </main>
            </div>
        </div>
    );
}

import { McpApprovalModal } from "@/components/mcp/mcp-approval-modal";
import { UploadProvider } from "@/contexts/upload-context";
import { BackupProvider } from "@/contexts/backup-context";
import { BackgroundUploadWidget } from "@/components/storage/background-upload-widget";
import { BackgroundBackupWidget } from "@/components/storage/background-backup-widget";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppLayoutWrapper({ children }: { children: React.ReactNode }) {
    return (
        <TooltipProvider delayDuration={150}>
            <ProjectProvider>
                <UploadProvider>
                    <BackupProvider>
                        <McpApprovalModal />
                        <AppLayoutContent>{children}</AppLayoutContent>
                        <BackgroundUploadWidget />
                        <BackgroundBackupWidget />
                    </BackupProvider>
                </UploadProvider>
            </ProjectProvider>
        </TooltipProvider>
    );
}


