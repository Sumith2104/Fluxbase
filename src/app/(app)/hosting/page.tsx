'use client';

import { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProjectContext } from '@/contexts/project-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Globe,
    UploadCloud,
    Rocket,
    ExternalLink,
    RefreshCw,
    Trash2,
    Plus,
    KeyRound,
    Check,
    Copy,
    FileText,
    Settings,
    AlertCircle,
    ArrowRight,
    Lock,
    Eye,
    EyeOff,
    Server,
    HardDrive,
    Layers,
    Activity,
    FolderArchive,
    CheckCircle2,
    Clock,
    Sparkles,
    ShieldCheck,
    Terminal,
    Code,
    Cpu,
    GitBranch,
    Search,
    ChevronDown,
    ChevronUp,
    Play,
    Unlock,
    Zap,
    GitCommit,
    CheckCheck,
    StopCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const FRAMEWORK_PRESETS = [
    {
        id: 'auto',
        name: 'Auto-Detect',
        description: 'Auto-inspects package.json',
        buildCommand: '',
        outputDirectory: '',
        installCommand: ''
    },
    {
        id: 'next',
        name: 'Next.js',
        description: 'Static HTML export (out/)',
        buildCommand: 'npx next build',
        outputDirectory: 'out',
        installCommand: 'npm install --legacy-peer-deps'
    },
    {
        id: 'vite',
        name: 'Vite / React',
        description: 'Modern frontend build (dist/)',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        installCommand: 'npm install --legacy-peer-deps'
    },
    {
        id: 'react',
        name: 'Create React App',
        description: 'Standard React CLI (build/)',
        buildCommand: 'npm run build',
        outputDirectory: 'build',
        installCommand: 'npm install --legacy-peer-deps'
    },
    {
        id: 'astro',
        name: 'Astro',
        description: 'Content static site (dist/)',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        installCommand: 'npm install --legacy-peer-deps'
    },
    {
        id: 'vue',
        name: 'Vue / Nuxt',
        description: 'Nuxt / Vue static generation',
        buildCommand: 'npm run generate',
        outputDirectory: 'dist',
        installCommand: 'npm install --legacy-peer-deps'
    },
    {
        id: 'svelte',
        name: 'Svelte',
        description: 'Svelte / SvelteKit static build',
        buildCommand: 'npm run build',
        outputDirectory: 'build',
        installCommand: 'npm install --legacy-peer-deps'
    },
    {
        id: 'static',
        name: 'Static HTML',
        description: 'Raw HTML/CSS/JS without build',
        buildCommand: '',
        outputDirectory: '.',
        installCommand: ''
    }
];

export default function HostingPage() {
    const { project } = useContext(ProjectContext);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [activeTab, setActiveTab] = useState<'overview' | 'deployments' | 'github' | 'env' | 'settings'>('overview');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [deployEnvironment, setDeployEnvironment] = useState<'preview' | 'production'>('production');
    const [isDeploying, setIsDeploying] = useState(false);
    const [deployProgressText, setDeployProgressText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Deploy Mode Switcher in Overview (GitHub vs Zip Upload)
    const [deploySourceTab, setDeploySourceTab] = useState<'github' | 'upload'>('github');
    const [uploadFramework, setUploadFramework] = useState('auto');

    // Build Settings Overrides (for Quick Deploy)
    const [showBuildSettings, setShowBuildSettings] = useState(false);
    const [customBuildCommand, setCustomBuildCommand] = useState('');
    const [customOutputDir, setCustomOutputDir] = useState('');
    const [customInstallCommand, setCustomInstallCommand] = useState('');

    // GitHub Integration States
    const [githubSearch, setGithubSearch] = useState('');
    const [selectedRepoForDeploy, setSelectedRepoForDeploy] = useState<any | null>(null);
    const [repoBranch, setRepoBranch] = useState('main');
    const [repoFramework, setRepoFramework] = useState('auto');
    const [repoBuildCommand, setRepoBuildCommand] = useState('');
    const [repoOutputDir, setRepoOutputDir] = useState('');
    const [repoInstallCommand, setRepoInstallCommand] = useState('');
    const [isDeployingGithub, setIsDeployingGithub] = useState(false);
    const [isRefreshingGithub, setIsRefreshingGithub] = useState(false);

    // Build Logs Modal States
    const [activeLogDeployId, setActiveLogDeployId] = useState<string | null>(null);
    const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
    const terminalEndRef = useRef<HTMLDivElement>(null);

    // Repository Binding & Auto Deploy States
    const [isDisconnectRepoOpen, setIsDisconnectRepoOpen] = useState(false);
    const [isDisconnectingRepo, setIsDisconnectingRepo] = useState(false);
    const [isTogglingAutoDeploy, setIsTogglingAutoDeploy] = useState(false);
    const [isTriggeringAutoDeploy, setIsTriggeringAutoDeploy] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    // Cancel Deployment State
    const [isCancellingDeploy, setIsCancellingDeploy] = useState(false);
    const [cancellingDeployId, setCancellingDeployId] = useState<string | null>(null);

    // Env Var States
    const [envFilter, setEnvFilter] = useState<'all' | 'production' | 'preview'>('all');
    const [isAddEnvOpen, setIsAddEnvOpen] = useState(false);
    const [envKey, setEnvKey] = useState('');
    const [envValue, setEnvValue] = useState('');
    const [envTarget, setEnvTarget] = useState<'production' | 'preview' | 'all'>('production');
    const [envIsSecret, setEnvIsSecret] = useState(false);
    const [isPastingEnv, setIsPastingEnv] = useState(false);
    const [rawEnvText, setRawEnvText] = useState('');
    const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

    // Settings States
    const [subdomainInput, setSubdomainInput] = useState('');
    const [isSavingSubdomain, setIsSavingSubdomain] = useState(false);
    const [customDomainInput, setCustomDomainInput] = useState('');
    const [isAddingDomain, setIsAddingDomain] = useState(false);
    const [isVerifyingDomain, setIsVerifyingDomain] = useState(false);
    const [isDeleteSiteOpen, setIsDeleteSiteOpen] = useState(false);
    const [isDeletingSite, setIsDeletingSite] = useState(false);

    // Initial Setup Wizard State
    const [wizardSubdomain, setWizardSubdomain] = useState('');
    const [wizardFramework, setWizardFramework] = useState('static');
    const [isCreatingSite, setIsCreatingSite] = useState(false);

    const projectId = project?.project_id;

    // Fetch site data
    const { data: siteData, isLoading: isSiteLoading, refetch: refetchSite } = useQuery({
        queryKey: ['hosting-site', projectId],
        queryFn: async () => {
            if (!projectId) return null;
            const res = await fetch(`/api/hosting/sites?projectId=${projectId}`);
            if (!res.ok) throw new Error('Failed to fetch hosting site');
            return res.json();
        },
        enabled: !!projectId,
    });

    // Fetch deployments list
    const { data: deploysData, isLoading: isDeploysLoading, refetch: refetchDeploys } = useQuery({
        queryKey: ['hosting-deploys', siteData?.site?.site_id],
        queryFn: async () => {
            if (!siteData?.site?.site_id) return null;
            const res = await fetch(`/api/hosting/deployments?siteId=${siteData.site.site_id}`);
            if (!res.ok) throw new Error('Failed to fetch deployments');
            return res.json();
        },
        enabled: !!siteData?.site?.site_id,
        refetchInterval: (query) => {
            const hasActive = query.state.data?.deployments?.some((d: any) => d.status === 'uploading' || d.status === 'building');
            return hasActive ? 1500 : false;
        }
    });

    // Active deployment currently in flight
    const activeDeployment = useMemo(() => {
        return (deploysData?.deployments || []).find((d: any) => d.status === 'uploading' || d.status === 'building');
    }, [deploysData?.deployments]);

    // Fetch GitHub Repos
    const { data: githubData, isLoading: isGithubLoading, refetch: refetchGithub } = useQuery({
        queryKey: ['hosting-github-repos'],
        queryFn: async () => {
            const res = await fetch('/api/github/repos?per_page=100');
            return res.json();
        },
    });

    // Fetch Build Logs for Active Deploy
    const { data: logData, isLoading: isLogLoading, refetch: refetchLog } = useQuery({
        queryKey: ['hosting-deploy-logs', siteData?.site?.site_id, activeLogDeployId],
        queryFn: async () => {
            if (!activeLogDeployId || !siteData?.site?.site_id) return null;
            const res = await fetch(`/api/hosting/logs?siteId=${siteData.site.site_id}&deployId=${activeLogDeployId}`);
            if (!res.ok) throw new Error('Failed to fetch build logs');
            return res.json();
        },
        enabled: !!activeLogDeployId && !!siteData?.site?.site_id && isLogsModalOpen,
        refetchInterval: (query) => {
            const status = query.state.data?.deployment?.status;
            return (status === 'uploading' || status === 'building') ? 1000 : false;
        }
    });

    // Live elapsed timer for active build in modal
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        const status = logData?.deployment?.status;
        if (isLogsModalOpen && (status === 'uploading' || status === 'building')) {
            interval = setInterval(() => {
                setElapsedSeconds(prev => prev + 1);
            }, 1000);
        } else if (!isLogsModalOpen) {
            setElapsedSeconds(0);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isLogsModalOpen, logData?.deployment?.status]);

    // Visual 4-Step Pipeline Status
    const pipelineSteps = useMemo(() => {
        const logs = logData?.buildLogs || '';
        const status = logData?.deployment?.status;
        const isLive = status === 'live' || status === 'ready';
        const isFailed = status === 'failed';

        // Step 1: Fetch source
        const fetchDone = isLive || logs.includes('Writing') || logs.includes('Configuring Next.js') || logs.includes('Running install') || logs.includes('Running build');
        const fetchActive = (status === 'uploading' || status === 'building') && !fetchDone;

        // Step 2: Install dependencies
        const installStarted = logs.includes('Running install');
        const installDone = isLive || logs.includes('Running build') || logs.includes('Install notice:') || logs.includes('Detected pre-built') || logs.includes('Injected static export');
        const installActive = installStarted && !installDone && !isFailed;

        // Step 3: Compile and static export
        const buildStarted = logs.includes('Running build') || logs.includes('Starting deployment compilation');
        const buildDone = isLive || logs.includes('Uploading static assets') || logs.includes('Publishing to edge CDN') || logs.includes('Deployment successfully created');
        const buildActive = (buildStarted || status === 'building') && !buildDone && !isFailed;

        // Step 4: CDN edge publish
        const deployStarted = logs.includes('Uploading static assets') || logs.includes('Publishing to edge CDN');
        const deployDone = isLive;
        const deployActive = deployStarted && !deployDone && !isFailed;

        return [
            { id: 1, name: 'Fetch Source', status: fetchDone ? 'completed' : fetchActive ? 'running' : isFailed ? 'failed' : 'pending' },
            { id: 2, name: 'Install Deps', status: installDone ? 'completed' : installActive ? 'running' : isFailed && fetchDone ? 'failed' : 'pending' },
            { id: 3, name: 'Compile & Export', status: buildDone ? 'completed' : buildActive ? 'running' : isFailed && installDone ? 'failed' : 'pending' },
            { id: 4, name: 'Publish to CDN', status: deployDone ? 'completed' : deployActive ? 'running' : isFailed && buildDone ? 'failed' : 'pending' },
        ];
    }, [logData?.buildLogs, logData?.deployment?.status]);

    // Auto-scroll terminal to bottom as live compilation output streams in
    useEffect(() => {
        if (isLogsModalOpen && terminalEndRef.current) {
            terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logData?.buildLogs, isLogsModalOpen]);

    // Refetch site and deployments when active build transitions to completed/failed
    useEffect(() => {
        const status = logData?.deployment?.status;
        if (status === 'live' || status === 'ready' || status === 'failed') {
            refetchSite();
            refetchDeploys();
        }
    }, [logData?.deployment?.status]);

    // Fetch env vars
    const { data: envData, isLoading: isEnvLoading, refetch: refetchEnv } = useQuery({
        queryKey: ['hosting-env', siteData?.site?.site_id, envFilter],
        queryFn: async () => {
            if (!siteData?.site?.site_id) return null;
            const res = await fetch(`/api/hosting/env?siteId=${siteData.site.site_id}&environment=${envFilter}`);
            if (!res.ok) throw new Error('Failed to fetch environment variables');
            return res.json();
        },
        enabled: !!siteData?.site?.site_id && activeTab === 'env',
    });

    const site = siteData?.site;
    const plan = siteData?.plan || 'free';
    const limits = siteData?.limits;
    const usage = siteData?.usage;
    const deployments = deploysData?.deployments || [];
    const githubRepos = githubData?.repos || [];
    const isGithubConnected = Boolean(githubData?.connected && !githubData?.error);
    const githubUsername = githubData?.username || '';

    // Filter GitHub repos by search term
    const filteredRepos = useMemo(() => {
        if (!githubSearch.trim()) return githubRepos;
        const q = githubSearch.toLowerCase().trim();
        return githubRepos.filter((r: any) =>
            r.name.toLowerCase().includes(q) ||
            r.full_name.toLowerCase().includes(q) ||
            (r.description && r.description.toLowerCase().includes(q))
        );
    }, [githubRepos, githubSearch]);

    // Framework Preset Selectors
    const handleSelectUploadPreset = (presetId: string) => {
        setUploadFramework(presetId);
        const p = FRAMEWORK_PRESETS.find(item => item.id === presetId);
        if (p) {
            setCustomBuildCommand(p.buildCommand);
            setCustomOutputDir(p.outputDirectory);
            setCustomInstallCommand(p.installCommand);
        }
    };

    const handleSelectRepoPreset = (presetId: string) => {
        setRepoFramework(presetId);
        const p = FRAMEWORK_PRESETS.find(item => item.id === presetId);
        if (p) {
            setRepoBuildCommand(p.buildCommand);
            setRepoOutputDir(p.outputDirectory);
            setRepoInstallCommand(p.installCommand);
        }
    };

    const handleOpenRepoDeploy = (repo: any) => {
        setSelectedRepoForDeploy(repo);
        setRepoBranch(repo.default_branch || 'main');
        setRepoFramework('auto');
        setRepoBuildCommand('');
        setRepoOutputDir('');
        setRepoInstallCommand('');
    };

    const handleRefreshGithub = async () => {
        setIsRefreshingGithub(true);
        try {
            const res = await fetch('/api/github/repos?per_page=100&refresh=true');
            const data = await res.json();
            queryClient.setQueryData(['hosting-github-repos'], data);
            toast({
                title: 'Repositories updated',
                description: `Fetched ${data.repos?.length || 0} repositories from GitHub.`
            });
        } catch {
            refetchGithub();
        } finally {
            setIsRefreshingGithub(false);
        }
    };

    // Sync subdomain inputs
    useEffect(() => {
        if (site?.subdomain) {
            setSubdomainInput(site.subdomain);
        } else if (project?.display_name) {
            const clean = project.display_name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
            setWizardSubdomain(clean);
        }
    }, [site?.subdomain, project?.display_name]);

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast({ title: 'Copied to clipboard', description: label });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setUploadFile(e.dataTransfer.files[0]);
        }
    };

    const openBuildLogsModal = (deployId: string) => {
        setActiveLogDeployId(deployId);
        setIsLogsModalOpen(true);
    };

    // Deploy action (Zip Upload)
    const handleDeploy = async () => {
        if (!uploadFile || !projectId) return;

        setIsDeploying(true);
        setDeployProgressText('Uploading bundle and building...');

        try {
            const formData = new FormData();
            formData.append('projectId', projectId);
            formData.append('environment', deployEnvironment);
            formData.append('file', uploadFile);
            if (customBuildCommand.trim()) formData.append('buildCommand', customBuildCommand.trim());
            if (customOutputDir.trim()) formData.append('outputDirectory', customOutputDir.trim());
            if (customInstallCommand.trim()) formData.append('installCommand', customInstallCommand.trim());

            const res = await fetch('/api/hosting/deploy', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Deployment failed');
            }

            toast({
                title: 'Deployment initiated',
                description: `Building and deploying ${deployEnvironment === 'production' ? 'to production' : 'to preview'}.`,
            });

            if (data.deployment?.deploy_id) {
                openBuildLogsModal(data.deployment.deploy_id);
            }

            setUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            refetchSite();
            refetchDeploys();
        } catch (err: any) {
            toast({
                title: 'Deployment failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setIsDeploying(false);
            setDeployProgressText('');
        }
    };

    // Deploy from GitHub repository
    const handleDeployFromGithub = async () => {
        if (!selectedRepoForDeploy || !projectId) return;

        setIsDeployingGithub(true);
        try {
            const res = await fetch('/api/hosting/github/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    githubRepo: selectedRepoForDeploy.full_name,
                    branch: repoBranch || selectedRepoForDeploy.default_branch || 'main',
                    buildCommand: repoBuildCommand.trim(),
                    outputDirectory: repoOutputDir.trim(),
                    installCommand: repoInstallCommand.trim(),
                    environment: deployEnvironment,
                    autoDeploy: true,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to deploy from GitHub');
            }

            toast({
                title: 'Deployment started',
                description: `Importing and building repository ${selectedRepoForDeploy.full_name}...`,
            });

            if (data.deployment?.deploy_id) {
                openBuildLogsModal(data.deployment.deploy_id);
            }

            setSelectedRepoForDeploy(null);
            refetchSite();
            refetchDeploys();
        } catch (err: any) {
            toast({
                title: 'GitHub deployment failed',
                description: err.message,
                variant: 'destructive',
            });
        } finally {
            setIsDeployingGithub(false);
        }
    };

    // Disconnect GitHub Repository
    const handleDisconnectRepo = async () => {
        if (!site?.site_id) return;
        setIsDisconnectingRepo(true);
        try {
            const res = await fetch('/api/hosting/github/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to disconnect repository');
            toast({
                title: 'Repository disconnected',
                description: 'The repository was unlinked. You can now select another repository to deploy.'
            });
            setIsDisconnectRepoOpen(false);
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Disconnect failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsDisconnectingRepo(false);
        }
    };

    // Toggle Auto Deploy on Git Commit
    const handleToggleAutoDeploy = async (enabled: boolean) => {
        if (!site?.site_id) return;
        setIsTogglingAutoDeploy(true);
        try {
            const res = await fetch('/api/hosting/github/toggle-autodeploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id, autoDeploy: enabled }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update auto-deploy setting');
            toast({
                title: enabled ? 'Auto-deploy enabled' : 'Auto-deploy disabled',
                description: enabled
                    ? 'Fluxbase will automatically compile and deploy new commits pushed to GitHub.'
                    : 'Auto-deploy paused. Commits will not trigger builds until re-enabled.'
            });
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Failed to update auto-deploy', description: err.message, variant: 'destructive' });
        } finally {
            setIsTogglingAutoDeploy(false);
        }
    };

    // Test / Simulate Auto Deploy via Webhook
    const handleTriggerTestAutoDeploy = async () => {
        if (!site?.site_id) return;
        setIsTriggeringAutoDeploy(true);
        try {
            const res = await fetch('/api/hosting/github/trigger-webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to trigger auto-deploy');
            toast({
                title: 'Auto-deploy initiated',
                description: `Simulated git push for commit ${data.commitSha?.slice(0, 7) || 'latest'}: "${data.commitMessage || 'Latest commit'}"`,
            });
            if (data.deployId) {
                openBuildLogsModal(data.deployId);
            }
            refetchSite();
            refetchDeploys();
        } catch (err: any) {
            toast({ title: 'Auto-deploy test failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsTriggeringAutoDeploy(false);
        }
    };

    // Deploy Latest Commit of Bound Repo
    const handleDeployBoundRepo = async () => {
        if (!site?.site_id || !site?.github_repo) return;
        setIsDeployingGithub(true);
        try {
            const res = await fetch('/api/hosting/github/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    githubRepo: site.github_repo,
                    branch: site.github_branch || 'main',
                    buildCommand: site.build_command || '',
                    outputDirectory: site.output_directory || '',
                    installCommand: site.install_command || '',
                    environment: deployEnvironment,
                    autoDeploy: site.auto_deploy !== false,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start deployment');
            toast({
                title: 'Deployment queued',
                description: `Building ${site.github_repo}@${site.github_branch || 'main'}...`
            });
            if (data.deployment?.deploy_id) {
                openBuildLogsModal(data.deployment.deploy_id);
            }
            refetchSite();
            refetchDeploys();
        } catch (err: any) {
            toast({ title: 'Deployment failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsDeployingGithub(false);
        }
    };

    // Promote preview to production
    const handlePromote = async (deployId: string) => {
        if (!site?.site_id) return;
        try {
            const res = await fetch('/api/hosting/promote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id, deployId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Promotion failed');

            toast({ title: 'Promoted to Production', description: 'Your site is now live at the production URL.' });
            refetchSite();
            refetchDeploys();
        } catch (err: any) {
            toast({ title: 'Promotion failed', description: err.message, variant: 'destructive' });
        }
    };

    // Rollback to previous deployment
    const handleRollback = async (targetDeployId?: string) => {
        if (!site?.site_id) return;
        try {
            const res = await fetch('/api/hosting/rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id, targetDeployId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Rollback failed');

            toast({ title: 'Rollback Completed', description: 'Restored deployment to live.' });
            refetchSite();
            refetchDeploys();
        } catch (err: any) {
            toast({ title: 'Rollback failed', description: err.message, variant: 'destructive' });
        }
    };

    // Cancel In-Flight Deployment
    const handleCancelDeployment = async (deployId: string) => {
        if (!site?.site_id || !deployId) return;
        setIsCancellingDeploy(true);
        setCancellingDeployId(deployId);
        try {
            const res = await fetch('/api/hosting/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id, deployId }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to cancel deployment');

            toast({
                title: 'Deployment Canceled',
                description: 'The build process was terminated and the deployment marked as canceled.'
            });
            refetchLog();
            refetchDeploys();
            refetchSite();
        } catch (err: any) {
            toast({
                title: 'Cancellation Failed',
                description: err.message,
                variant: 'destructive'
            });
        } finally {
            setIsCancellingDeploy(false);
            setCancellingDeployId(null);
        }
    };

    // Add Env Var
    const handleSaveEnv = async () => {
        if (!site?.site_id) return;
        try {
            if (isPastingEnv) {
                const res = await fetch('/api/hosting/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ siteId: site.site_id, rawEnvText, environment: envTarget }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save parsed variables');

                toast({ title: 'Variables added', description: `Successfully imported ${data.count} environment variables.` });
                setIsPastingEnv(false);
                setRawEnvText('');
            } else {
                if (!envKey.trim()) return;
                const res = await fetch('/api/hosting/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        siteId: site.site_id,
                        key: envKey.trim(),
                        value: envValue,
                        environment: envTarget,
                        isSecret: envIsSecret,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add variable');

                toast({ title: 'Variable saved', description: `Saved ${envKey.trim()}` });
                setIsAddEnvOpen(false);
                setEnvKey('');
                setEnvValue('');
            }
            refetchEnv();
        } catch (err: any) {
            toast({ title: 'Error saving variable', description: err.message, variant: 'destructive' });
        }
    };

    // Delete Env Var
    const handleDeleteEnv = async (id: string, keyName: string) => {
        try {
            const res = await fetch(`/api/hosting/env?id=${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete variable');
            toast({ title: 'Variable deleted', description: `Removed ${keyName}` });
            refetchEnv();
        } catch (err: any) {
            toast({ title: 'Error deleting variable', description: err.message, variant: 'destructive' });
        }
    };

    // Update Subdomain
    const handleUpdateSubdomain = async () => {
        if (!site?.site_id || !subdomainInput.trim()) return;
        setIsSavingSubdomain(true);
        try {
            const res = await fetch('/api/hosting/sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    subdomain: subdomainInput.trim().toLowerCase(),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update subdomain');

            toast({ title: 'Subdomain updated', description: `Your site is now available at ${subdomainInput.trim()}.fluxbasedb.me` });
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Failed to update subdomain', description: err.message, variant: 'destructive' });
        } finally {
            setIsSavingSubdomain(false);
        }
    };

    // Add Custom Domain
    const handleAddCustomDomain = async () => {
        if (!site?.site_id || !customDomainInput.trim()) return;
        setIsAddingDomain(true);
        try {
            const res = await fetch('/api/hosting/domains', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    siteId: site.site_id,
                    domain: customDomainInput.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to configure custom domain');

            toast({ title: 'Custom domain registered', description: 'Configure your DNS CNAME record as shown.' });
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Custom domain error', description: err.message, variant: 'destructive' });
        } finally {
            setIsAddingDomain(false);
        }
    };

    // Verify Custom Domain
    const handleVerifyDomain = async () => {
        if (!site?.site_id) return;
        setIsVerifyingDomain(true);
        try {
            const res = await fetch('/api/hosting/domains/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteId: site.site_id }),
            });
            const data = await res.json();
            if (data.verified) {
                toast({ title: 'Domain verified', description: `${site.custom_domain} is verified and active.` });
            } else {
                toast({ title: 'Verification pending', description: data.details || 'DNS record not detected yet. DNS changes can take a few minutes to propagate.', variant: 'destructive' });
            }
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Verification failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsVerifyingDomain(false);
        }
    };

    // Toggle AI Models
    const handleToggleAiModels = async (enabled: boolean) => {
        if (!site?.site_id) return;
        try {
            const res = await fetch('/api/hosting/sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, aiModelsEnabled: enabled }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update AI settings');

            toast({ title: enabled ? 'AI models enabled' : 'AI models disabled', description: enabled ? 'Your hosted frontend now has direct access to Flux AI models.' : 'AI access turned off for this site.' });
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Error updating AI access', description: err.message, variant: 'destructive' });
        }
    };

    // Toggle SPA Routing
    const handleToggleSpa = async (enabled: boolean) => {
        if (!site?.site_id) return;
        try {
            const res = await fetch('/api/hosting/sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, isSpa: enabled }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update SPA routing');

            toast({ title: enabled ? 'SPA routing active' : 'SPA routing disabled', description: enabled ? 'Unmatched routes will now serve index.html' : 'Strict 404 behavior enabled' });
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Error updating SPA routing', description: err.message, variant: 'destructive' });
        }
    };

    // Delete Site
    const handleDeleteSite = async () => {
        if (!site?.site_id) return;
        setIsDeletingSite(true);
        try {
            const res = await fetch(`/api/hosting/sites?siteId=${site.site_id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete hosting site');

            toast({ title: 'Site deleted', description: 'Hosting site and deployments removed.' });
            setIsDeleteSiteOpen(false);
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Error deleting site', description: err.message, variant: 'destructive' });
        } finally {
            setIsDeletingSite(false);
        }
    };

    // First-time site initialization
    const handleCreateSite = async () => {
        if (!projectId) return;
        setIsCreatingSite(true);
        try {
            const res = await fetch('/api/hosting/sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    subdomain: wizardSubdomain.trim().toLowerCase(),
                    framework: wizardFramework,
                    isSpa: true,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create site');

            toast({ title: 'Hosting provisioned', description: `Site created at ${data.site.subdomain}.fluxbasedb.me` });
            refetchSite();
        } catch (err: any) {
            toast({ title: 'Creation failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsCreatingSite(false);
        }
    };

    if (!projectId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
                <Globe className="h-12 w-12 text-muted-foreground/40 mb-4" />
                <h2 className="text-xl font-semibold mb-2">No Project Selected</h2>
                <p className="text-sm text-muted-foreground max-w-sm mb-4">
                    Please select or create a project to deploy and manage web applications on Flux Hosting.
                </p>
            </div>
        );
    }

    if (isSiteLoading) {
        return (
            <div className="p-8 space-y-6 max-w-6xl mx-auto">
                <div className="flex justify-between items-center">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-9 w-32" />
                </div>
                <Skeleton className="h-44 w-full rounded-xl" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Skeleton className="h-32 rounded-xl" />
                    <Skeleton className="h-32 rounded-xl" />
                    <Skeleton className="h-32 rounded-xl" />
                </div>
            </div>
        );
    }

    // FIRST-TIME SETUP WIZARD (When no hosting site exists for project)
    if (!site) {
        return (
            <div className="p-6 md:p-10 max-w-4xl mx-auto">
                <div className="text-center mb-10">
                    <div className="inline-flex p-3 rounded-2xl bg-primary/10 border border-primary/20 text-primary mb-4">
                        <Globe className="h-8 w-8" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Deploy Your Web Application</h1>
                    <p className="text-muted-foreground text-base max-w-lg mx-auto">
                        Ship web applications, frontend projects, and static sites with instant preview URLs, custom domains, and zero-latency database access.
                    </p>
                </div>

                <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-xl">
                    <CardHeader className="border-b border-border/40 pb-6">
                        <CardTitle className="text-lg">Site Configuration</CardTitle>
                        <CardDescription>Choose your public subdomain and framework preset to get started.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                                Subdomain
                            </label>
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        value={wizardSubdomain}
                                        onChange={(e) => setWizardSubdomain(e.target.value)}
                                        placeholder="my-cool-app"
                                        className="font-mono text-sm pr-36"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground pointer-events-none">
                                        .fluxbasedb.me
                                    </span>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Must be 3-63 characters, lowercase letters, numbers, and hyphens.
                            </p>
                        </div>

                        <div>
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                                Framework Preset
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { id: 'static', label: 'Static HTML' },
                                    { id: 'next', label: 'Next.js' },
                                    { id: 'vite', label: 'Vite / React' },
                                    { id: 'vue', label: 'Vue / Nuxt' },
                                ].map((fw) => (
                                    <button
                                        key={fw.id}
                                        type="button"
                                        onClick={() => setWizardFramework(fw.id)}
                                        className={cn(
                                            "flex flex-col items-start p-3.5 rounded-lg border text-left transition-all",
                                            wizardFramework === fw.id
                                                ? "border-primary bg-primary/10 text-primary shadow-sm"
                                                : "border-border/60 hover:border-border hover:bg-secondary/40 text-foreground"
                                        )}
                                    >
                                        <span className="text-sm font-medium">{fw.label}</span>
                                        <span className="text-xs text-muted-foreground mt-0.5">Auto-build supported</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border/40 flex justify-end">
                            <Button
                                onClick={handleCreateSite}
                                disabled={isCreatingSite || !wizardSubdomain.trim()}
                                className="gap-2 px-6"
                            >
                                {isCreatingSite ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                                Provision Site &amp; Continue
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // ACTIVE SITE VIEW
    const liveUrl = `https://${site.subdomain}.fluxbasedb.me`;
    const previewUrl = site.prev_url;
    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatCleanErrorMessage = (raw?: string | null): string => {
        if (!raw) return 'Build process failed. Click to view logs.';

        // If it contains "BUILD FAILED:"
        if (raw.includes('BUILD FAILED:')) {
            const parts = raw.split('BUILD FAILED:');
            const after = parts[parts.length - 1].trim();
            if (after) {
                const firstLine = after.split(/\r?\n/).find(l => l.trim().length > 0);
                return firstLine ? firstLine.trim().slice(0, 160) : after.slice(0, 160);
            }
        }

        // If it contains "Failed to collect page data"
        if (raw.includes('Failed to collect page data')) {
            const match = raw.match(/Failed to collect page data for [^\s\]]+/);
            if (match) return match[0];
        }

        // If it contains turbopack error
        if (raw.includes("turbopack")) {
            return "Next.js static export error: next build does not support Turbopack in production.";
        }

        // If it contains exit code
        if (raw.includes('Command failed with exit code')) {
            const match = raw.match(/Command failed with exit code \d+/);
            if (match) return match[0];
        }

        // Remove timestamp brackets like [2026-09-29 ...]
        const cleanLines = raw
            .split(/\r?\n/)
            .map(l => l.replace(/^\[\d{4}-\d{2}-\d{2}[^\]]+\]\s*/, '').trim())
            .filter(Boolean);

        const relevant = cleanLines.reverse().find(l => 
            !l.startsWith('Starting deployment') && 
            !l.startsWith('Framework auto-detection') && 
            !l.startsWith('Install command') && 
            !l.startsWith('Build command') && 
            !l.startsWith('Output directory') && 
            !l.startsWith('Writing') && 
            !l.startsWith('Injected') && 
            !l.startsWith('Error:')
        );

        return relevant ? relevant.slice(0, 160) : cleanLines[0]?.slice(0, 160) || 'Build compilation failed. Click to inspect terminal output.';
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
            {/* Top Navigation & Status Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/40">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
                            <Globe className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold tracking-tight">Hosting</h1>
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Active
                                </Badge>
                                <Badge variant="secondary" className="text-xs uppercase font-mono tracking-wider">
                                    {plan}
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Subdomain: <span className="font-mono text-foreground">{site.subdomain}.fluxbasedb.me</span>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(liveUrl, '_blank')}
                        className="gap-1.5 text-xs"
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Visit Live Site
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                            setActiveTab('overview');
                            fileInputRef.current?.click();
                        }}
                        className="gap-1.5 text-xs"
                    >
                        <UploadCloud className="h-3.5 w-3.5" />
                        Deploy Bundle
                    </Button>
                </div>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)} className="space-y-6">
                <TabsList className="grid grid-cols-5 w-full md:w-auto md:inline-flex bg-muted/60 p-1 border border-border/40 rounded-xl">
                    <TabsTrigger value="overview" className="gap-2 text-xs">
                        <Activity className="h-3.5 w-3.5" />
                        Overview
                    </TabsTrigger>
                    <TabsTrigger value="deployments" className="gap-2 text-xs">
                        <Layers className="h-3.5 w-3.5" />
                        Deployments
                    </TabsTrigger>
                    <TabsTrigger value="github" className="gap-2 text-xs">
                        <GitBranch className="h-3.5 w-3.5" />
                        GitHub
                    </TabsTrigger>
                    <TabsTrigger value="env" className="gap-2 text-xs">
                        <KeyRound className="h-3.5 w-3.5" />
                        Environment
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="gap-2 text-xs">
                        <Settings className="h-3.5 w-3.5" />
                        Settings
                    </TabsTrigger>
                </TabsList>

                {/* Live Active Deployment Banner */}
                {activeDeployment && (
                    <div className="p-4 rounded-xl border border-primary/40 bg-primary/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-pulse">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/20 text-primary">
                                <RefreshCw className="h-5 w-5 animate-spin" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">Deployment v{activeDeployment.version} in progress</span>
                                    <Badge variant="secondary" className="text-[10px] uppercase font-mono tracking-wider bg-primary/20 text-primary">
                                        {activeDeployment.status}
                                    </Badge>
                                    {activeDeployment.commit_sha && (
                                        <Badge variant="outline" className="text-[10px] font-mono gap-1">
                                            <GitCommit className="h-2.5 w-2.5" />
                                            {activeDeployment.commit_sha.slice(0, 7)}
                                        </Badge>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Compiling static assets and publishing to edge CDN...
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 self-start sm:self-auto">
                            <Button
                                size="sm"
                                onClick={() => openBuildLogsModal(activeDeployment.deploy_id)}
                                className="gap-2 text-xs"
                            >
                                <Terminal className="h-3.5 w-3.5" />
                                View Live Logs
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleCancelDeployment(activeDeployment.deploy_id)}
                                disabled={isCancellingDeploy}
                                className="gap-1.5 text-xs bg-destructive/90 hover:bg-destructive text-destructive-foreground font-medium"
                            >
                                {isCancellingDeploy ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <StopCircle className="h-3.5 w-3.5" />
                                )}
                                Cancel Deployment
                            </Button>
                        </div>
                    </div>
                )}

                {/* OVERVIEW TAB */}
                <TabsContent value="overview" className="space-y-6">
                    {/* Live & Preview Deployments Status Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Production Deployment Card */}
                        <Card className="border-border/60 bg-card/60 backdrop-blur-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                                            Production
                                        </Badge>
                                        {site.prod_version && (
                                            <span className="text-xs font-mono text-muted-foreground">
                                                Version {site.prod_version}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        {site.prod_deployed_at ? new Date(site.prod_deployed_at).toLocaleString() : 'No deployment yet'}
                                    </span>
                                </div>
                                <CardTitle className="text-base font-semibold mt-2 flex items-center justify-between">
                                    <a
                                        href={liveUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-foreground hover:text-primary transition-colors flex items-center gap-1.5 font-mono text-sm"
                                    >
                                        {liveUrl}
                                        <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                                    </a>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                        onClick={() => handleCopy(liveUrl, 'Live URL')}
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-4">
                                <div className="grid grid-cols-2 gap-3 p-3 bg-secondary/30 rounded-lg text-xs">
                                    <div>
                                        <span className="text-muted-foreground block">Files Uploaded</span>
                                        <span className="font-semibold">{site.prod_file_count || 0} files</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block">Bundle Size</span>
                                        <span className="font-semibold">{formatBytes(parseInt(site.prod_size_bytes || '0', 10))}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full text-xs"
                                        onClick={() => window.open(liveUrl, '_blank')}
                                    >
                                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                        Visit Site
                                    </Button>
                                    {site.production_deploy_id && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full text-xs"
                                            onClick={() => openBuildLogsModal(site.production_deploy_id)}
                                        >
                                            <Terminal className="h-3.5 w-3.5 mr-1.5" />
                                            Build Logs
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Preview Deployment Card */}
                        <Card className="border-border/60 bg-card/60 backdrop-blur-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-xs">
                                            Latest Preview
                                        </Badge>
                                        {site.prev_version && (
                                            <span className="text-xs font-mono text-muted-foreground">
                                                Version {site.prev_version}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        {site.prev_deployed_at ? new Date(site.prev_deployed_at).toLocaleString() : 'No preview deploy'}
                                    </span>
                                </div>
                                <CardTitle className="text-base font-semibold mt-2 flex items-center justify-between">
                                    {previewUrl ? (
                                        <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-foreground hover:text-blue-400 transition-colors flex items-center gap-1.5 font-mono text-xs truncate max-w-[280px]"
                                        >
                                            {previewUrl}
                                            <ExternalLink className="h-3.5 w-3.5 opacity-60 flex-shrink-0" />
                                        </a>
                                    ) : (
                                        <span className="text-xs text-muted-foreground font-normal">
                                            No active preview build
                                        </span>
                                    )}
                                    {previewUrl && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                            onClick={() => handleCopy(previewUrl, 'Preview URL')}
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-4">
                                <p className="text-xs text-muted-foreground">
                                    Preview deployments allow you to test changes on an isolated URL before promoting to production.
                                </p>
                                <div className="flex items-center gap-2">
                                    {site.preview_deploy_id && (
                                        <>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="w-full text-xs"
                                                onClick={() => handlePromote(site.preview_deploy_id)}
                                            >
                                                <Rocket className="h-3.5 w-3.5 mr-1.5" />
                                                Promote to Production
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full text-xs"
                                                onClick={() => openBuildLogsModal(site.preview_deploy_id)}
                                            >
                                                <Terminal className="h-3.5 w-3.5 mr-1.5" />
                                                Build Logs
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Deploy New Version Card (Dual Mode: GitHub or Zip Upload) */}
                    <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
                        <CardHeader className="pb-3 border-b border-border/40">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Rocket className="h-4 w-4 text-primary" />
                                        Deploy New Version
                                    </CardTitle>
                                    <CardDescription>
                                        Choose your deployment source, select or auto-detect your framework, and publish in seconds.
                                    </CardDescription>
                                </div>
                                {/* Source Switcher Tabs */}
                                <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border/40 self-start sm:self-auto">
                                    <button
                                        type="button"
                                        onClick={() => setDeploySourceTab('github')}
                                        className={cn(
                                            "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-all",
                                            deploySourceTab === 'github'
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <GitBranch className="h-3.5 w-3.5" />
                                        GitHub {githubRepos.length > 0 && `(${githubRepos.length})`}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDeploySourceTab('upload')}
                                        className={cn(
                                            "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-all",
                                            deploySourceTab === 'upload'
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <UploadCloud className="h-3.5 w-3.5" />
                                        Upload Zip
                                    </button>
                                </div>
                            </div>
                        </CardHeader>

                        {deploySourceTab === 'github' ? (
                            <CardContent className="space-y-4 pt-4">
                                {!isGithubConnected ? (
                                    <div className="p-8 text-center space-y-4 rounded-xl border border-dashed border-border/60 bg-secondary/10">
                                        <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground">
                                            <GitBranch className="h-6 w-6 text-primary" />
                                        </div>
                                        <div className="max-w-md mx-auto">
                                            <h3 className="font-semibold text-base mb-1">Connect GitHub to Deploy</h3>
                                            <p className="text-xs text-muted-foreground mb-4">
                                                Authorize Fluxbase to access your repositories. Pick any personal or organization repo, choose branches, and auto-build with Next.js, Vite, or React.
                                            </p>
                                            <Button
                                                onClick={() => window.location.href = '/api/auth/github/import?returnTo=/hosting'}
                                                className="gap-2 text-xs"
                                            >
                                                <GitBranch className="h-4 w-4" />
                                                Authorize GitHub Repositories
                                            </Button>
                                        </div>
                                    </div>
                                ) : site?.github_repo ? (
                                    /* Single Repository Locked & Bound View */
                                    <div className="p-5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-background space-y-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/40">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                                                    <GitBranch className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <a
                                                            href={`https://github.com/${site.github_repo}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="font-semibold text-sm hover:underline flex items-center gap-1.5"
                                                        >
                                                            {site.github_repo}
                                                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                                        </a>
                                                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] gap-1">
                                                            <Lock className="h-2.5 w-2.5" />
                                                            Locked &amp; Bound
                                                        </Badge>
                                                        <Badge variant="outline" className="text-[10px] font-mono">
                                                            {site.github_branch || 'main'}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        Repository lock active. Other repositories cannot be selected for this site.
                                                    </p>
                                                </div>
                                            </div>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setIsDisconnectRepoOpen(true)}
                                                className="text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40 self-start sm:self-auto"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Disconnect Repo
                                            </Button>
                                        </div>

                                        {/* Auto Deploy & Deploy Controls */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="p-3.5 rounded-lg border border-border/40 bg-secondary/20 flex items-center justify-between gap-3">
                                                <div className="space-y-0.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-semibold text-foreground">Auto-Deploy on Push</span>
                                                        <Badge
                                                            variant="outline"
                                                            className={cn(
                                                                "text-[9px] uppercase font-mono px-1.5 py-0",
                                                                site.auto_deploy !== false ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground"
                                                            )}
                                                        >
                                                            {site.auto_deploy !== false ? 'Active' : 'Paused'}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Auto-triggers build on commits to {site.github_branch || 'main'}.
                                                    </p>
                                                </div>
                                                <Switch
                                                    checked={site.auto_deploy !== false}
                                                    onCheckedChange={handleToggleAutoDeploy}
                                                    disabled={isTogglingAutoDeploy}
                                                />
                                            </div>

                                            <div className="p-3.5 rounded-lg border border-border/40 bg-secondary/20 flex items-center justify-between gap-3">
                                                <div className="space-y-0.5">
                                                    <span className="text-xs font-semibold text-foreground block">Deploy Controls</span>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Re-compile latest commit or simulate push.
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={handleTriggerTestAutoDeploy}
                                                        disabled={isTriggeringAutoDeploy}
                                                        className="h-8 text-xs gap-1"
                                                        title="Simulate git push commit webhook"
                                                    >
                                                        <Zap className={cn("h-3 w-3 text-amber-400", isTriggeringAutoDeploy && "animate-spin")} />
                                                        Test Webhook
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        onClick={handleDeployBoundRepo}
                                                        disabled={isDeployingGithub}
                                                        className="h-8 text-xs gap-1"
                                                    >
                                                        <Rocket className={cn("h-3 w-3", isDeployingGithub && "animate-spin")} />
                                                        Deploy Latest
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border/40 text-[11px] text-muted-foreground flex items-center gap-2">
                                            <Lock className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                            <span>
                                                <strong>Single Repository Lock:</strong> No other repository can be selected for this site. To deploy a different repository, disconnect this repository first.
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Status & Search Header */}
                                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs gap-1.5 py-1">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                                    Connected to GitHub {githubUsername && `@${githubUsername}`}
                                                </Badge>
                                                <Badge variant="secondary" className="text-xs">
                                                    {filteredRepos.length} available
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="relative flex-1 sm:w-64">
                                                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                                    <Input
                                                        value={githubSearch}
                                                        onChange={(e) => setGithubSearch(e.target.value)}
                                                        placeholder="Search all repositories..."
                                                        className="pl-8 text-xs h-8"
                                                    />
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleRefreshGithub}
                                                    disabled={isRefreshingGithub || isGithubLoading}
                                                    className="h-8 text-xs gap-1 flex-shrink-0"
                                                >
                                                    <RefreshCw className={cn("h-3 w-3", (isRefreshingGithub || isGithubLoading) && "animate-spin")} />
                                                    Refresh
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Repositories Scrollable List */}
                                        {isGithubLoading ? (
                                            <div className="space-y-2 py-2">
                                                <Skeleton className="h-14 w-full" />
                                                <Skeleton className="h-14 w-full" />
                                                <Skeleton className="h-14 w-full" />
                                            </div>
                                        ) : filteredRepos.length === 0 ? (
                                            <div className="p-8 text-center text-muted-foreground text-xs border border-border/40 rounded-xl bg-secondary/10">
                                                {githubSearch ? `No repositories found matching "${githubSearch}".` : 'No repositories accessible. Try clicking Refresh or reconnecting.'}
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-border/40 border border-border/40 rounded-xl overflow-hidden max-h-[360px] overflow-y-auto">
                                                {filteredRepos.map((repo: any) => (
                                                    <div
                                                        key={repo.id}
                                                        className="p-3.5 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-semibold text-xs text-foreground truncate">
                                                                    {repo.full_name}
                                                                </span>
                                                                <Badge variant="outline" className="text-[10px]">
                                                                    {repo.private ? 'Private' : 'Public'}
                                                                </Badge>
                                                                {repo.language && (
                                                                    <Badge variant="secondary" className="text-[10px]">
                                                                        {repo.language}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            {repo.description && (
                                                                <p className="text-xs text-muted-foreground truncate mt-0.5 max-w-lg">
                                                                    {repo.description}
                                                                </p>
                                                            )}
                                                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                                                                <span>Branch: <span className="font-mono text-foreground">{repo.default_branch || 'main'}</span></span>
                                                                <span>•</span>
                                                                <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                                                            </div>
                                                        </div>

                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleOpenRepoDeploy(repo)}
                                                            className="h-8 text-xs gap-1.5 flex-shrink-0"
                                                        >
                                                            <Rocket className="h-3 w-3" />
                                                            Configure &amp; Deploy
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        ) : (
                            <CardContent className="space-y-4 pt-4">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".zip,application/zip"
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files.length > 0) {
                                            setUploadFile(e.target.files[0]);
                                        }
                                    }}
                                />

                                <div
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={cn(
                                        "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                                        uploadFile
                                            ? "border-primary/60 bg-primary/5"
                                            : "border-border/60 hover:border-primary/40 hover:bg-secondary/20"
                                    )}
                                >
                                    <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
                                        {uploadFile ? <FolderArchive className="h-6 w-6 text-primary" /> : <UploadCloud className="h-6 w-6" />}
                                    </div>
                                    {uploadFile ? (
                                        <div>
                                            <p className="text-sm font-semibold text-foreground">{uploadFile.name}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">{formatBytes(uploadFile.size)} - Click to change</p>
                                        </div>
                                    ) : (
                                        <div>
                                            <p className="text-sm font-medium text-foreground">
                                                Drop your project .zip archive here, or browse
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Supports Next.js, Vite, React, Vue, Svelte, Astro, or static HTML (up to {formatBytes(parseInt(limits?.deploySizeBytes || '52428800', 10))})
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Framework Presets & Auto-Detect Selection */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            Framework Preset &amp; Build Configuration
                                        </label>
                                        <span className="text-[11px] text-muted-foreground">
                                            Auto-Detect inspects package.json
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        {FRAMEWORK_PRESETS.map((preset) => (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => handleSelectUploadPreset(preset.id)}
                                                className={cn(
                                                    "p-2.5 rounded-lg border text-left transition-all text-xs",
                                                    uploadFramework === preset.id
                                                        ? "border-primary bg-primary/10 text-primary shadow-sm font-medium"
                                                        : "border-border/60 hover:border-border hover:bg-secondary/30 text-muted-foreground"
                                                )}
                                            >
                                                <div className="font-semibold text-foreground">{preset.name}</div>
                                                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{preset.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Build Command Inputs */}
                                <div className="p-3 rounded-lg border border-border/40 bg-secondary/20 space-y-3 text-xs">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">
                                                Build Command
                                            </label>
                                            <Input
                                                value={customBuildCommand}
                                                onChange={(e) => setCustomBuildCommand(e.target.value)}
                                                placeholder={uploadFramework === 'auto' ? 'Auto-detected from package.json' : 'npm run build'}
                                                className="font-mono text-xs h-8"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">
                                                Output Directory
                                            </label>
                                            <Input
                                                value={customOutputDir}
                                                onChange={(e) => setCustomOutputDir(e.target.value)}
                                                placeholder={uploadFramework === 'auto' ? 'Auto-detected (e.g. dist, out, build)' : 'dist or out'}
                                                className="font-mono text-xs h-8"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">
                                                Install Command
                                            </label>
                                            <Input
                                                value={customInstallCommand}
                                                onChange={(e) => setCustomInstallCommand(e.target.value)}
                                                placeholder={uploadFramework === 'auto' ? 'npm install --legacy-peer-deps' : 'npm install'}
                                                className="font-mono text-xs h-8"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Deploy Action Bar */}
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-muted-foreground font-medium">Target Environment:</span>
                                        <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg border border-border/40">
                                            <button
                                                type="button"
                                                onClick={() => setDeployEnvironment('preview')}
                                                className={cn(
                                                    "px-2.5 py-1 text-xs rounded font-medium transition-all",
                                                    deployEnvironment === 'preview'
                                                        ? "bg-background text-foreground shadow-sm"
                                                        : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                Preview
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeployEnvironment('production')}
                                                className={cn(
                                                    "px-2.5 py-1 text-xs rounded font-medium transition-all",
                                                    deployEnvironment === 'production'
                                                        ? "bg-background text-foreground shadow-sm"
                                                        : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                Production
                                            </button>
                                        </div>
                                    </div>

                                    <Button
                                        onClick={handleDeploy}
                                        disabled={!uploadFile || isDeploying}
                                        className="gap-2 w-full sm:w-auto"
                                    >
                                        {isDeploying ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                                {deployProgressText || 'Deploying...'}
                                            </>
                                        ) : (
                                            <>
                                                <Rocket className="h-4 w-4" />
                                                Deploy Application
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardContent>
                        )}
                    </Card>

                    {/* Usage & Quota Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="border-border/60 bg-card/60">
                            <CardContent className="p-4 space-y-2">
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="text-xs font-medium">Bandwidth (Month)</span>
                                    <Activity className="h-4 w-4" />
                                </div>
                                <div className="text-xl font-bold">
                                    {formatBytes(usage?.bandwidthBytes || 0)}
                                </div>
                                <Progress
                                    value={limits ? Math.min(100, Math.round(((usage?.bandwidthBytes || 0) / parseInt(limits.bandwidthBytesMonthly || '10737418240', 10)) * 100)) : 0}
                                    className="h-1.5"
                                />
                                <span className="text-[11px] text-muted-foreground block">
                                    Limit: {formatBytes(parseInt(limits?.bandwidthBytesMonthly || '10737418240', 10))}
                                </span>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card/60">
                            <CardContent className="p-4 space-y-2">
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="text-xs font-medium">Monthly Requests</span>
                                    <Server className="h-4 w-4" />
                                </div>
                                <div className="text-xl font-bold">
                                    {(usage?.requestsCount || 0).toLocaleString()}
                                </div>
                                <span className="text-[11px] text-muted-foreground block mt-3">
                                    HTTP/2 &amp; HTTP/3 edge requests
                                </span>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card/60">
                            <CardContent className="p-4 space-y-2">
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="text-xs font-medium">Total Deployments</span>
                                    <Layers className="h-4 w-4" />
                                </div>
                                <div className="text-xl font-bold">
                                    {usage?.deploymentsCount || 0}
                                </div>
                                <span className="text-[11px] text-muted-foreground block mt-3">
                                    Quota: {limits?.deploymentsMonthly || 50} / month
                                </span>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card/60">
                            <CardContent className="p-4 space-y-2">
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="text-xs font-medium">Custom Domains</span>
                                    <Globe className="h-4 w-4" />
                                </div>
                                <div className="text-xl font-bold">
                                    {site.custom_domain ? '1' : '0'} / {limits?.customDomains || 0}
                                </div>
                                <span className="text-[11px] text-muted-foreground block mt-3">
                                    {site.custom_domain ? site.custom_domain : 'None configured'}
                                </span>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* GITHUB INTEGRATION TAB */}
                <TabsContent value="github" className="space-y-6">
                    <Card className="border-border/60 bg-card/60">
                        <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <GitBranch className="h-4 w-4 text-primary" />
                                    Deploy from GitHub Repository
                                </CardTitle>
                                <CardDescription>
                                    Select any repository from your GitHub account to build and deploy automatically.
                                </CardDescription>
                            </div>
                            <div>
                                {!isGithubConnected ? (
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={() => window.location.href = '/api/auth/github/import?returnTo=/hosting'}
                                        className="gap-2 text-xs"
                                    >
                                        <GitBranch className="h-3.5 w-3.5" />
                                        Connect GitHub Account
                                    </Button>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => refetchGithub()}
                                        className="h-8 text-xs gap-1.5"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                        Refresh Repositories
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {!isGithubConnected ? (
                                <div className="p-10 text-center space-y-4 rounded-xl border border-dashed border-border/60 bg-secondary/10">
                                    <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground">
                                        <GitBranch className="h-6 w-6 text-primary" />
                                    </div>
                                    <div className="max-w-md mx-auto">
                                        <h3 className="font-semibold text-base mb-1">GitHub Not Connected</h3>
                                        <p className="text-xs text-muted-foreground mb-4">
                                            Connect your GitHub account to access all your repositories, select branches, and enable auto-deploy on every push.
                                        </p>
                                        <Button
                                            onClick={() => window.location.href = '/api/auth/github/import?returnTo=/hosting'}
                                            className="gap-2 text-xs"
                                        >
                                            <GitBranch className="h-4 w-4" />
                                            Authorize GitHub Connection
                                        </Button>
                                    </div>
                                </div>
                            ) : site?.github_repo ? (
                                    /* Bound Repository Management Card */
                                    <div className="space-y-4">
                                        <div className="p-5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-background space-y-4">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/40">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-primary">
                                                        <GitBranch className="h-5 w-5" />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <a
                                                                href={`https://github.com/${site.github_repo}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="font-semibold text-sm hover:underline flex items-center gap-1.5"
                                                            >
                                                                {site.github_repo}
                                                                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                                            </a>
                                                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] gap-1">
                                                                <Lock className="h-2.5 w-2.5" />
                                                                Locked to Site
                                                            </Badge>
                                                            <Badge variant="outline" className="text-[10px] font-mono">
                                                                Branch: {site.github_branch || 'main'}
                                                            </Badge>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            This hosting site is bound to this repository. All push webhooks and automated builds target this repo.
                                                        </p>
                                                    </div>
                                                </div>

                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setIsDisconnectRepoOpen(true)}
                                                    className="text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40 self-start sm:self-auto"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    Disconnect Repository
                                                </Button>
                                            </div>

                                            {/* Auto-Deploy Toggle & Test */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="p-4 rounded-lg border border-border/40 bg-secondary/20 flex items-center justify-between gap-3">
                                                    <div className="space-y-0.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-semibold text-foreground">Auto-Deploy on Push</span>
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    "text-[9px] uppercase font-mono px-1.5 py-0",
                                                                    site.auto_deploy !== false ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground"
                                                                )}
                                                            >
                                                                {site.auto_deploy !== false ? 'Active' : 'Disabled'}
                                                            </Badge>
                                                        </div>
                                                        <p className="text-[11px] text-muted-foreground">
                                                            Automatically triggers compilation when commits are pushed to {site.github_branch || 'main'}.
                                                        </p>
                                                    </div>
                                                    <Switch
                                                        checked={site.auto_deploy !== false}
                                                        onCheckedChange={handleToggleAutoDeploy}
                                                        disabled={isTogglingAutoDeploy}
                                                    />
                                                </div>

                                                <div className="p-4 rounded-lg border border-border/40 bg-secondary/20 flex items-center justify-between gap-3">
                                                    <div className="space-y-0.5">
                                                        <span className="text-xs font-semibold text-foreground block">Deployment Actions</span>
                                                        <p className="text-[11px] text-muted-foreground">
                                                            Run an immediate build or test push webhook.
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={handleTriggerTestAutoDeploy}
                                                            disabled={isTriggeringAutoDeploy}
                                                            className="h-8 text-xs gap-1"
                                                            title="Test auto-deploy using GitHub commit webhook pipeline"
                                                        >
                                                            <Zap className={cn("h-3 w-3 text-amber-400", isTriggeringAutoDeploy && "animate-spin")} />
                                                            Test Webhook
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            onClick={handleDeployBoundRepo}
                                                            disabled={isDeployingGithub}
                                                            className="h-8 text-xs gap-1"
                                                        >
                                                            <Rocket className={cn("h-3 w-3", isDeployingGithub && "animate-spin")} />
                                                            Deploy Latest
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Locked Repository Switcher Card */}
                                        <div className="p-6 rounded-xl border border-dashed border-border/60 bg-secondary/10 text-center space-y-3">
                                            <div className="mx-auto w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                                                <Lock className="h-5 w-5 text-primary" />
                                            </div>
                                            <div className="max-w-md mx-auto space-y-1">
                                                <h4 className="font-semibold text-sm">Repository Selection Locked</h4>
                                                <p className="text-xs text-muted-foreground">
                                                    This site is bound to <span className="font-mono text-foreground font-medium">{site.github_repo}</span>.
                                                    No other repository can be selected for this site.
                                                    To select and deploy a different repository, you must disconnect the current one first.
                                                </p>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setIsDisconnectRepoOpen(true)}
                                                className="text-xs text-muted-foreground hover:text-destructive gap-1.5"
                                            >
                                                <Unlock className="h-3.5 w-3.5" />
                                                Disconnect {site.github_repo} to switch
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                    {/* Search Bar */}
                                    <div className="relative">
                                        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={githubSearch}
                                            onChange={(e) => setGithubSearch(e.target.value)}
                                            placeholder="Search all repositories..."
                                            className="pl-9 text-xs"
                                        />
                                    </div>

                                    {/* Repositories List */}
                                    {isGithubLoading ? (
                                        <div className="space-y-2 py-4">
                                            <Skeleton className="h-14 w-full" />
                                            <Skeleton className="h-14 w-full" />
                                            <Skeleton className="h-14 w-full" />
                                        </div>
                                    ) : filteredRepos.length === 0 ? (
                                        <div className="p-8 text-center text-muted-foreground text-xs">
                                            No repositories found matching "{githubSearch}".
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-border/40 border border-border/40 rounded-xl overflow-hidden max-h-[480px] overflow-y-auto">
                                            {filteredRepos.map((repo: any) => (
                                                <div
                                                    key={repo.id}
                                                    className="p-3.5 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-xs text-foreground truncate">
                                                                {repo.full_name}
                                                            </span>
                                                            <Badge variant="outline" className="text-[10px]">
                                                                {repo.private ? 'Private' : 'Public'}
                                                            </Badge>
                                                            <Badge variant="secondary" className="text-[10px] font-mono">
                                                                {repo.default_branch}
                                                            </Badge>
                                                        </div>
                                                        {repo.description && (
                                                            <p className="text-xs text-muted-foreground truncate mt-0.5 max-w-lg">
                                                                {repo.description}
                                                            </p>
                                                        )}
                                                    </div>

                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleOpenRepoDeploy(repo)}
                                                        className="h-8 text-xs gap-1 flex-shrink-0"
                                                    >
                                                        <Rocket className="h-3 w-3" />
                                                        Deploy
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* DEPLOYMENTS TAB */}
                <TabsContent value="deployments" className="space-y-4">
                    <Card className="border-border/60 bg-card/60">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-base">Deployment History</CardTitle>
                                <CardDescription>Immutable record of all preview and production builds.</CardDescription>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => refetchDeploys()}
                                className="h-8 text-xs gap-1.5"
                            >
                                <RefreshCw className="h-3 w-3" />
                                Refresh
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0">
                            {deployments.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground text-sm">
                                    No deployments found. Drop a bundle in the Overview tab or import from GitHub to deploy.
                                </div>
                            ) : (
                                <div className="divide-y divide-border/40">
                                    {deployments.map((dep: any) => {
                                        const isLive = dep.status === 'live';
                                        return (
                                            <div
                                                key={dep.deploy_id}
                                                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
                                            >
                                                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                                                    <div className="p-2 rounded-lg bg-secondary/40 text-muted-foreground shrink-0 mt-0.5">
                                                        <FileText className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-semibold text-sm">v{dep.version}</span>
                                                            <Badge
                                                                variant="outline"
                                                                className={cn(
                                                                    "text-[10px] capitalize",
                                                                    dep.environment === 'production'
                                                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                                        : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                                )}
                                                            >
                                                                {dep.environment}
                                                            </Badge>
                                                            <Badge
                                                                variant="secondary"
                                                                className={cn(
                                                                    "text-[10px] uppercase font-mono tracking-wider",
                                                                    dep.status === 'live' && "bg-emerald-500/20 text-emerald-400",
                                                                    dep.status === 'ready' && "bg-teal-500/20 text-teal-400",
                                                                    dep.status === 'failed' && "bg-destructive/20 text-destructive border-destructive/30",
                                                                    dep.status === 'canceled' && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                                                                    dep.status === 'uploading' && "bg-blue-500/20 text-blue-400 animate-pulse",
                                                                    dep.status === 'building' && "bg-amber-500/20 text-amber-400 animate-pulse"
                                                                )}
                                                            >
                                                                {dep.status}
                                                            </Badge>
                                                            {dep.source && (
                                                                <span className="text-xs text-muted-foreground">
                                                                    via {dep.source}
                                                                </span>
                                                            )}
                                                            {dep.commit_sha && (
                                                                <Badge variant="outline" className="text-[10px] font-mono gap-1">
                                                                    <GitCommit className="h-2.5 w-2.5" />
                                                                    {dep.commit_sha.slice(0, 7)}
                                                                </Badge>
                                                            )}
                                                        </div>

                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                                                            <span>{dep.file_count || 0} files</span>
                                                            <span>•</span>
                                                            <span>{formatBytes(parseInt(dep.total_size_bytes || '0', 10))}</span>
                                                            <span>•</span>
                                                            <span>{new Date(dep.created_at).toLocaleString()}</span>
                                                        </div>

                                                        {dep.error_message && (
                                                            <div
                                                                role="button"
                                                                tabIndex={0}
                                                                onClick={() => openBuildLogsModal(dep.deploy_id)}
                                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openBuildLogsModal(dep.deploy_id); }}
                                                                className="mt-2.5 p-2.5 rounded-lg bg-destructive/10 border border-destructive/25 text-destructive text-xs font-mono flex items-start gap-2 hover:bg-destructive/15 transition-all cursor-pointer group max-w-2xl"
                                                                title="Click to view full build logs in terminal"
                                                            >
                                                                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                                                        <span className="font-semibold text-[10px] uppercase tracking-wider text-destructive/80">
                                                                            {dep.status === 'canceled' ? 'Notice' : 'Build Error'}
                                                                        </span>
                                                                        <span className="text-[10px] font-sans font-medium underline opacity-75 group-hover:opacity-100 flex items-center gap-1 shrink-0">
                                                                            View Logs
                                                                            <Terminal className="h-2.5 w-2.5" />
                                                                        </span>
                                                                    </div>
                                                                    <p className="line-clamp-2 break-words text-xs text-destructive/90 leading-relaxed font-mono">
                                                                        {formatCleanErrorMessage(dep.error_message)}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                                                    {(dep.status === 'building' || dep.status === 'uploading' || dep.status === 'queued') && (
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            className="h-8 text-xs gap-1.5 shrink-0 bg-destructive/90 hover:bg-destructive text-destructive-foreground font-medium"
                                                            onClick={() => handleCancelDeployment(dep.deploy_id)}
                                                            disabled={isCancellingDeploy && cancellingDeployId === dep.deploy_id}
                                                        >
                                                            {isCancellingDeploy && cancellingDeployId === dep.deploy_id ? (
                                                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                                            ) : (
                                                                <StopCircle className="h-3.5 w-3.5" />
                                                            )}
                                                            Cancel
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 text-xs gap-1.5 shrink-0 border-border/80"
                                                        onClick={() => openBuildLogsModal(dep.deploy_id)}
                                                    >
                                                        <Terminal className="h-3.5 w-3.5" />
                                                        Logs
                                                    </Button>
                                                    {dep.preview_url && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 text-xs gap-1.5 shrink-0"
                                                            onClick={() => window.open(dep.preview_url, '_blank')}
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                            Preview
                                                        </Button>
                                                    )}
                                                    {dep.status === 'ready' && !isLive && (
                                                        <Button
                                                            variant="default"
                                                            size="sm"
                                                            className="h-8 text-xs gap-1.5 shrink-0"
                                                            onClick={() => handlePromote(dep.deploy_id)}
                                                        >
                                                            <Rocket className="h-3.5 w-3.5" />
                                                            Promote
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ENVIRONMENT VARIABLES TAB */}
                <TabsContent value="env" className="space-y-4">
                    <Card className="border-border/60 bg-card/60">
                        <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="text-base">Environment Variables</CardTitle>
                                <CardDescription>
                                    Variables are encrypted with AES-256-GCM and injected into your served frontend bundle at runtime.
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsPastingEnv(!isPastingEnv)}
                                    className="h-8 text-xs gap-1.5"
                                >
                                    <Code className="h-3.5 w-3.5" />
                                    Paste .env
                                </Button>
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => {
                                        setIsPastingEnv(false);
                                        setIsAddEnvOpen(true);
                                    }}
                                    className="h-8 text-xs gap-1.5"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Variable
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Paste .env box */}
                            {isPastingEnv && (
                                <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-foreground">Paste .env file contents</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 text-xs"
                                            onClick={() => setIsPastingEnv(false)}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                    <textarea
                                        value={rawEnvText}
                                        onChange={(e) => setRawEnvText(e.target.value)}
                                        placeholder={`API_URL=https://fluxbasedb.me/api/v1/sql\nNEXT_PUBLIC_APP_NAME=My App\nSECRET_KEY=sk_live_123456`}
                                        rows={5}
                                        className="w-full rounded-md border border-border/60 bg-background p-2.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">Target:</span>
                                            <select
                                                value={envTarget}
                                                onChange={(e: any) => setEnvTarget(e.target.value)}
                                                className="bg-background border border-border/60 text-xs rounded px-2 py-1"
                                            >
                                                <option value="production">Production</option>
                                                <option value="preview">Preview</option>
                                                <option value="all">All Environments</option>
                                            </select>
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={handleSaveEnv}
                                            disabled={!rawEnvText.trim()}
                                            className="text-xs"
                                        >
                                            Parse &amp; Save Variables
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Variables list */}
                            {isEnvLoading ? (
                                <div className="space-y-2 py-4">
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                            ) : !envData?.envVars || envData.envVars.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground text-sm">
                                    No environment variables configured for this site.
                                </div>
                            ) : (
                                <div className="divide-y divide-border/40 border border-border/40 rounded-xl overflow-hidden">
                                    {envData.envVars.map((v: any) => (
                                        <div
                                            key={v.id}
                                            className="p-3.5 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className="font-mono text-xs font-semibold text-foreground">
                                                    {v.key}
                                                </span>
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] capitalize font-mono"
                                                >
                                                    {v.environment}
                                                </Badge>
                                                {v.isSecret && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-[10px] text-muted-foreground gap-1"
                                                    >
                                                        <Lock className="h-2.5 w-2.5" />
                                                        Encrypted
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                                                    {v.value}
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                    onClick={() => handleDeleteEnv(v.id, v.key)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* SETTINGS TAB */}
                <TabsContent value="settings" className="space-y-6">
                    {/* Subdomain Management */}
                    <Card className="border-border/60 bg-card/60">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Subdomain Configuration</CardTitle>
                            <CardDescription>
                                Change your public *.fluxbasedb.me subdomain.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-2 max-w-md">
                                <div className="relative flex-1">
                                    <Input
                                        value={subdomainInput}
                                        onChange={(e) => setSubdomainInput(e.target.value)}
                                        className="font-mono text-sm pr-36"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground pointer-events-none">
                                        .fluxbasedb.me
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={handleUpdateSubdomain}
                                    disabled={isSavingSubdomain || subdomainInput === site.subdomain}
                                    className="gap-1.5 text-xs"
                                >
                                    {isSavingSubdomain ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    Save
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Custom Domain Management */}
                    <Card className="border-border/60 bg-card/60">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-base">Custom Domain</CardTitle>
                                    <CardDescription>
                                        Map your own branded domain with automatic SSL via Caddy on-demand TLS.
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="text-xs">
                                    Quota: {limits?.customDomains || 0}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {site.custom_domain ? (
                                <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Globe className="h-4 w-4 text-primary" />
                                            <span className="font-semibold text-sm font-mono">{site.custom_domain}</span>
                                            {site.custom_domain_verified ? (
                                                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs gap-1">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Verified &amp; SSL Active
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    DNS Pending
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={handleVerifyDomain}
                                                disabled={isVerifyingDomain}
                                                className="h-8 text-xs gap-1"
                                            >
                                                {isVerifyingDomain ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                                                Verify DNS
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={async () => {
                                                    const res = await fetch(`/api/hosting/domains?siteId=${site.site_id}`, { method: 'DELETE' });
                                                    if (res.ok) {
                                                        toast({ title: 'Custom domain removed' });
                                                        refetchSite();
                                                    }
                                                }}
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>

                                    {!site.custom_domain_verified && (
                                        <div className="p-3 bg-background rounded-lg border border-border/40 text-xs space-y-2">
                                            <p className="font-medium text-foreground">Required DNS Record:</p>
                                            <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-muted-foreground">
                                                <div>Type: <span className="text-foreground">CNAME</span></div>
                                                <div>Name: <span className="text-foreground">@ or www</span></div>
                                                <div>Target: <span className="text-foreground">{site.subdomain}.fluxbasedb.me</span></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 max-w-md">
                                        <Input
                                            value={customDomainInput}
                                            onChange={(e) => setCustomDomainInput(e.target.value)}
                                            placeholder="www.mybrand.com"
                                            className="font-mono text-sm"
                                        />
                                        <Button
                                            size="sm"
                                            onClick={handleAddCustomDomain}
                                            disabled={isAddingDomain || !customDomainInput.trim()}
                                            className="text-xs"
                                        >
                                            {isAddingDomain ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Add Domain'}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Custom domains require a PRO, MAX, or ORG OWNER plan.
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Feature Toggles */}
                    <Card className="border-border/60 bg-card/60">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Features &amp; Routing</CardTitle>
                            <CardDescription>Configure framework routing and runtime features.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-sm font-semibold block">Single Page Application (SPA) Mode</span>
                                    <span className="text-xs text-muted-foreground">
                                        Rewrites unmatched URL paths to index.html for client-side routers (React Router, Vue Router).
                                    </span>
                                </div>
                                <Switch
                                    checked={Boolean(site.is_spa)}
                                    onCheckedChange={handleToggleSpa}
                                />
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-border/40">
                                <div>
                                    <span className="text-sm font-semibold block flex items-center gap-1.5">
                                        <Sparkles className="h-4 w-4 text-primary" />
                                        Flux AI Model Access for Hosted Frontend
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        Allows frontend JavaScript on this domain to call the Flux AI proxy without exposing API keys.
                                    </span>
                                </div>
                                <Switch
                                    checked={Boolean(site.ai_models_enabled)}
                                    onCheckedChange={handleToggleAiModels}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Danger Zone */}
                    <Card className="border-destructive/30 bg-destructive/5">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
                            <CardDescription>
                                Deleting this site will permanently remove all deployments and release the subdomain.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setIsDeleteSiteOpen(true)}
                                className="text-xs"
                            >
                                Delete Hosting Site
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* GitHub Deploy Configuration Modal */}
            <Dialog open={!!selectedRepoForDeploy} onOpenChange={(open) => !open && setSelectedRepoForDeploy(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <GitBranch className="h-4 w-4 text-primary" />
                            Deploy from {selectedRepoForDeploy?.full_name}
                        </DialogTitle>
                        <DialogDescription>
                            Configure your build and output settings for this repository.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2 text-xs">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="font-semibold text-muted-foreground uppercase text-[11px] block mb-1">
                                    Branch
                                </label>
                                <Input
                                    value={repoBranch}
                                    onChange={(e) => setRepoBranch(e.target.value)}
                                    placeholder="main"
                                    className="font-mono text-xs"
                                />
                            </div>
                            <div>
                                <label className="font-semibold text-muted-foreground uppercase text-[11px] block mb-1">
                                    Target Environment
                                </label>
                                <select
                                    value={deployEnvironment}
                                    onChange={(e: any) => setDeployEnvironment(e.target.value)}
                                    className="w-full bg-background border border-border/60 text-xs rounded px-3 py-2 h-9"
                                >
                                    <option value="production">Production</option>
                                    <option value="preview">Preview</option>
                                </select>
                            </div>
                        </div>

                        {/* Framework Presets */}
                        <div>
                            <label className="font-semibold text-muted-foreground uppercase text-[11px] block mb-1.5">
                                Framework Preset
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {FRAMEWORK_PRESETS.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => handleSelectRepoPreset(p.id)}
                                        className={cn(
                                            "p-2 rounded-lg border text-left transition-all text-xs",
                                            repoFramework === p.id
                                                ? "border-primary bg-primary/10 text-primary font-medium shadow-sm"
                                                : "border-border/60 hover:border-border hover:bg-secondary/30 text-muted-foreground"
                                        )}
                                    >
                                        <div className="font-semibold text-foreground">{p.name}</div>
                                        <div className="text-[10px] text-muted-foreground truncate">{p.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="font-semibold text-muted-foreground uppercase text-[11px] block mb-1">
                                Build Command
                            </label>
                            <Input
                                value={repoBuildCommand}
                                onChange={(e) => setRepoBuildCommand(e.target.value)}
                                placeholder={repoFramework === 'auto' ? 'Auto-detected from package.json (e.g. npm run build)' : 'npm run build'}
                                className="font-mono text-xs"
                            />
                            <p className="text-[11px] text-muted-foreground mt-1">
                                Command executed in the build container to compile static assets.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="font-semibold text-muted-foreground uppercase text-[11px] block mb-1">
                                    Output Directory
                                </label>
                                <Input
                                    value={repoOutputDir}
                                    onChange={(e) => setRepoOutputDir(e.target.value)}
                                    placeholder={repoFramework === 'auto' ? 'Auto-detected (out, dist, build)' : 'dist or out'}
                                    className="font-mono text-xs"
                                />
                            </div>
                            <div>
                                <label className="font-semibold text-muted-foreground uppercase text-[11px] block mb-1">
                                    Install Command
                                </label>
                                <Input
                                    value={repoInstallCommand}
                                    onChange={(e) => setRepoInstallCommand(e.target.value)}
                                    placeholder={repoFramework === 'auto' ? 'Auto-detected (npm install --legacy-peer-deps)' : 'npm install'}
                                    className="font-mono text-xs"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setSelectedRepoForDeploy(null)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleDeployFromGithub}
                            disabled={isDeployingGithub}
                            className="gap-2"
                        >
                            {isDeployingGithub ? (
                                <>
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    Starting Deployment...
                                </>
                            ) : (
                                <>
                                    <Rocket className="h-3.5 w-3.5" />
                                    Start Deployment
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Build Logs Terminal Modal */}
            <Dialog open={isLogsModalOpen} onOpenChange={setIsLogsModalOpen}>
                <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-[#0d1117] border-border/80 text-foreground">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Build and Deployment Logs</DialogTitle>
                        <DialogDescription>Real-time compilation and CDN deployment output</DialogDescription>
                    </DialogHeader>

                    {/* Terminal Header */}
                    <div className="p-4 border-b border-border/40 flex items-center justify-between bg-[#161b22]">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Terminal className="h-4 w-4 text-emerald-400" />
                            <span className="font-mono text-xs font-semibold">
                                Build &amp; Deployment Logs
                            </span>
                            {logData?.deployment && (
                                <>
                                    <Badge variant="outline" className="text-[10px] font-mono">
                                        v{logData.deployment.version}
                                    </Badge>
                                    <Badge
                                        variant="secondary"
                                        className={cn(
                                            "text-[10px] uppercase font-mono tracking-wider",
                                            logData.deployment.status === 'live' && "bg-emerald-500/20 text-emerald-400",
                                            logData.deployment.status === 'ready' && "bg-teal-500/20 text-teal-400",
                                            logData.deployment.status === 'failed' && "bg-destructive/20 text-destructive",
                                            logData.deployment.status === 'canceled' && "bg-amber-500/20 text-amber-400",
                                            logData.deployment.status === 'uploading' && "bg-blue-500/20 text-blue-400 animate-pulse",
                                            logData.deployment.status === 'building' && "bg-amber-500/20 text-amber-400 animate-pulse"
                                        )}
                                    >
                                        {logData.deployment.status}
                                    </Badge>
                                </>
                            )}
                            {elapsedSeconds > 0 && (
                                <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-[#0d1117] px-2 py-0.5 rounded border border-border/40">
                                    <Clock className="h-3 w-3 text-primary animate-pulse" />
                                    <span>{Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {(logData?.deployment?.status === 'building' || logData?.deployment?.status === 'uploading' || logData?.deployment?.status === 'queued') && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-7 text-xs gap-1.5 font-medium shadow-sm bg-destructive/90 hover:bg-destructive text-destructive-foreground"
                                    onClick={() => handleCancelDeployment(logData.deployment.deploy_id)}
                                    disabled={isCancellingDeploy}
                                >
                                    {isCancellingDeploy ? (
                                        <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <StopCircle className="h-3.5 w-3.5" />
                                    )}
                                    Cancel Deployment
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => refetchLog()}
                            >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Refresh
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => handleCopy(logData?.buildLogs || 'No logs', 'Build logs')}
                            >
                                <Copy className="h-3 w-3 mr-1" />
                                Copy
                            </Button>
                        </div>
                    </div>

                    {/* Visual 4-Step Pipeline Status */}
                    <div className="px-4 py-3 bg-[#13171f] border-b border-border/30 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {pipelineSteps.map((step) => {
                            const isCompleted = step.status === 'completed';
                            const isRunning = step.status === 'running';
                            const isFailed = step.status === 'failed';
                            return (
                                <div
                                    key={step.id}
                                    className={cn(
                                        "flex items-center gap-2 p-2 rounded-lg border text-xs transition-all",
                                        isCompleted && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
                                        isRunning && "bg-blue-500/10 border-blue-500/40 text-blue-400 animate-pulse font-medium",
                                        isFailed && "bg-destructive/10 border-destructive/30 text-destructive font-medium",
                                        step.status === 'pending' && "bg-[#161b22] border-border/30 text-muted-foreground/60"
                                    )}
                                >
                                    <div className="flex-shrink-0">
                                        {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                                        {isRunning && <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-400" />}
                                        {isFailed && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                                        {step.status === 'pending' && <Clock className="h-3.5 w-3.5 text-muted-foreground/40" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate font-mono text-[11px] leading-tight">
                                            {step.id}. {step.name}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Terminal Body */}
                    <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed bg-[#0d1117] min-h-[350px]">
                        {isLogLoading && !logData ? (
                            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                Loading build logs...
                            </div>
                        ) : logData?.buildLogs ? (
                            <>
                                <pre className="whitespace-pre-wrap select-text font-mono">
                                    {logData.buildLogs}
                                </pre>
                                <div ref={terminalEndRef} />
                            </>
                        ) : (
                            <div className="text-muted-foreground space-y-2">
                                <p>[System] Initializing deployment pipeline...</p>
                                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                                    Compiling assets and streaming real-time output.
                                </p>
                            </div>
                        )}

                        {logData?.deployment?.error_message && (
                            <div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive font-semibold">
                                Error: {logData.deployment.error_message}
                            </div>
                        )}

                        {logData?.deployment?.status === 'canceled' && (
                            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-amber-300 text-xs">
                                <StopCircle className="h-4 w-4 shrink-0 text-amber-400" />
                                <span>Deployment was canceled by user. Build process was stopped.</span>
                            </div>
                        )}

                        {(logData?.deployment?.status === 'live' || logData?.deployment?.status === 'ready') && (
                            <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3 text-emerald-400">
                                <div className="flex items-center gap-2 text-xs">
                                    <CheckCircle2 className="h-4 w-4" />
                                    <span>Deployment v{logData.deployment.version} completed successfully! Published to edge CDN.</span>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-emerald-500/40 hover:bg-emerald-500/20 text-emerald-300 gap-1"
                                    onClick={() => window.open(`https://${site?.subdomain}.fluxbasedb.me`, '_blank')}
                                >
                                    <ExternalLink className="h-3 w-3" />
                                    Open Live Site
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Add Env Variable Modal */}
            <Dialog open={isAddEnvOpen} onOpenChange={setIsAddEnvOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Environment Variable</DialogTitle>
                        <DialogDescription>
                            Variable will be encrypted at rest and injected into your served HTML bundle.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Key</label>
                            <Input
                                value={envKey}
                                onChange={(e) => setEnvKey(e.target.value)}
                                placeholder="NEXT_PUBLIC_API_URL"
                                className="font-mono text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Value</label>
                            <Input
                                value={envValue}
                                onChange={(e) => setEnvValue(e.target.value)}
                                placeholder="https://api.example.com"
                                className="font-mono text-sm"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">Environment</label>
                                <select
                                    value={envTarget}
                                    onChange={(e: any) => setEnvTarget(e.target.value)}
                                    className="w-full bg-background border border-border/60 text-xs rounded px-3 py-2"
                                >
                                    <option value="production">Production</option>
                                    <option value="preview">Preview</option>
                                    <option value="all">All</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-2 pt-6">
                                <Switch
                                    checked={envIsSecret}
                                    onCheckedChange={setEnvIsSecret}
                                />
                                <span className="text-xs text-muted-foreground font-medium">Encrypt &amp; Mask Value</span>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setIsAddEnvOpen(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleSaveEnv} disabled={!envKey.trim()}>Save Variable</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Site Confirmation Modal */}
            <AlertDialog open={isDeleteSiteOpen} onOpenChange={setIsDeleteSiteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will delete your hosting site <strong className="text-foreground">{site.subdomain}.fluxbasedb.me</strong> and all {deployments.length} deployment records. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteSite}
                            disabled={isDeletingSite}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeletingSite ? 'Deleting...' : 'Delete Site'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Disconnect Repository Confirmation Modal */}
            <AlertDialog open={isDisconnectRepoOpen} onOpenChange={setIsDisconnectRepoOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Unlock className="h-5 w-5 text-amber-400" />
                            Disconnect GitHub Repository?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            This will disconnect <strong className="text-foreground">{site?.github_repo}</strong> from this site.
                            Automatic deployments and GitHub commit webhooks will be unlinked. Once disconnected, you will be able to select and bind a different repository to this site.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDisconnectingRepo}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDisconnectRepo}
                            disabled={isDisconnectingRepo}
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                        >
                            {isDisconnectingRepo ? (
                                <>
                                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    Disconnecting...
                                </>
                            ) : (
                                'Disconnect Repository'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
