'use client';

import { useEffect, useState, useContext } from 'react';
import Image from 'next/image';
import { getProjectsForCurrentUser, Project } from '@/lib/data';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ChevronRight, AlertTriangle, Database, Sparkles, Layers, ArrowRight, Loader2, Bot, Key, Copy, Check, ShieldCheck, GraduationCap, Briefcase, Building2, Send, Cpu, HardDrive, Zap, CreditCard, Activity, Github, FolderGit2, RefreshCw, FileCode, CheckCircle2, XCircle, FileText, Globe, Lock, ExternalLink, ChevronDown, ChevronUp, Info, Terminal, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProjectContext } from '@/contexts/project-context';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectsPageSkeleton } from '@/components/skeletons/page-skeletons';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { createProjectAction, checkGitHubConnectionAction, disconnectGitHubAction } from '@/components/layout/actions';
import { createApiKeyAction } from '@/app/(app)/settings/api-key-actions';
import { getUserPlanAction } from '@/app/(app)/settings/billing-actions';

const timezones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'];

type UserRoleOption = 'student' | 'employee' | 'org_owner';
type BillingOption = 'monthly' | 'pay_as_you_go' | 'hybrid';

export default function SelectProjectPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPlan, setCurrentPlan] = useState<string>('free');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setProject } = useContext(ProjectContext);
  const { toast } = useToast();

  // Dialog States
  const [modalDialect, setModalDialect] = useState<'postgresql' | 'mysql' | null>(null);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Project Creation Form State
  const [projectName, setProjectName] = useState('');
  const [selectedTimezone, setSelectedTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [selectedRole, setSelectedRole] = useState<UserRoleOption | null>(null);
  const [billingPreference, setBillingPreference] = useState<BillingOption>('monthly');
  const [companyName, setCompanyName] = useState('');
  const [workDescription, setWorkDescription] = useState('');

  // MCP Key State
  const [mcpApiKey, setMcpApiKey] = useState<string>('');
  const [isGeneratingMcpKey, setIsGeneratingMcpKey] = useState(false);
  const [hasCopiedMcp, setHasCopiedMcp] = useState(false);
  const [mcpEnv, setMcpEnv] = useState<'vercel' | 'local'>('vercel');

  // GitHub Import States
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [githubStep, setGithubStep] = useState<
    'connect' | 'repos' | 'discover' | 'configure' | 'preview' | 'executing' | 'success'
  >('connect');
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState('');
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [githubRepos, setGithubRepos] = useState<any[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<any | null>(null);
  const existingProjectForSelectedRepo = selectedRepo
    ? projects.find(p => p.github_repo?.toLowerCase() === selectedRepo.full_name?.toLowerCase())
    : null;
  const [modulePath, setModulePath] = useState('fluxbase');
  const [isScanningModule, setIsScanningModule] = useState(false);
  const [moduleScanError, setModuleScanError] = useState<string | null>(null);
  const [fluxbaseModule, setFluxbaseModule] = useState<any | null>(null);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [expandedFilePreview, setExpandedFilePreview] = useState<string | null>(null);

  // Import configuration states
  const [importProjectName, setImportProjectName] = useState('');
  const [importDialect, setImportDialect] = useState<'postgresql' | 'mysql'>('postgresql');
  const [importTimezone, setImportTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [importRole, setImportRole] = useState<UserRoleOption | null>('student');
  const [studentPlan, setStudentPlan] = useState<'free' | 'pro' | 'max'>('free');
  const [importBillingPreference, setImportBillingPreference] = useState<BillingOption>('monthly');

  // Execution & Logs state
  const [isImporting, setIsImporting] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedProject, setImportedProject] = useState<Project | null>(null);

  // Subscription Quota Detection
  const isUpgradedAccount = currentPlan === 'employee' || currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max' || currentPlan === 'pro' || currentPlan === 'pay_as_you_go';

  const maxAllowedProjects = 
    (currentPlan === 'max' || currentPlan === 'org_owner' || currentPlan === 'org') ? 999999 :
    (currentPlan === 'employee' || currentPlan === 'pay_as_you_go') ? 10 :
    (currentPlan === 'pro') ? 3 : 1;

  const hasAvailableQuota = isUpgradedAccount && projects.length < maxAllowedProjects;

  const fetchProjects = async (silent = false) => {
    if (!silent && projects.length === 0) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success && data.projects) {
        setProjects(data.projects);
      } else {
        const userProjects = await getProjectsForCurrentUser();
        setProjects(userProjects);
      }
    } catch (e: any) {
      console.error("Failed to fetch projects:", e);
      if (projects.length === 0) {
        setError("We couldn't load your projects. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async () => {
    setCheckingConnection(true);
    try {
      const info = await checkGitHubConnectionAction();
      if (info && info.connected) {
        setGithubConnected(true);
        setGithubUsername(info.username || '');
        return true;
      } else {
        setGithubConnected(false);
        setGithubUsername('');
        return false;
      }
    } catch {
      setGithubConnected(false);
      return false;
    } finally {
      setCheckingConnection(false);
    }
  };

  const fetchRepos = async (search?: string) => {
    setLoadingRepos(true);
    try {
      const url = search ? `/api/github/repos?search=${encodeURIComponent(search)}` : '/api/github/repos';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.repos) {
        setGithubRepos(data.repos);
      } else if (data.connected === false) {
        setGithubConnected(false);
        setGithubStep('connect');
      }
    } catch (e) {
      console.error('Failed to fetch repositories:', e);
    } finally {
      setLoadingRepos(false);
    }
  };

  // Auto-open GitHub Import modal when redirected back from successful OAuth
  useEffect(() => {
    const isConnected = searchParams?.get('github_connected') === 'true';
    if (isConnected) {
      setIsGithubModalOpen(true);
      setGithubConnected(true);
      const username = searchParams.get('github_username');
      if (username) setGithubUsername(username);
      setGithubStep('repos');
      fetchRepos();
      toast({
        title: 'GitHub Connected',
        description: `Successfully connected GitHub${username ? ` (@${username})` : ''}. Select a repository to continue.`
      });
      // Clean up search param from URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams]);

  const handleOpenGithubModal = async () => {
    setIsGithubModalOpen(true);
    const connected = await checkConnection();
    if (connected) {
      setGithubStep('repos');
      fetchRepos();
    } else {
      setGithubStep('connect');
    }
  };

  const handleDisconnectGithub = async () => {
    try {
      await disconnectGitHubAction();
      setGithubConnected(false);
      setGithubUsername('');
      setGithubRepos([]);
      setSelectedRepo(null);
      setGithubStep('connect');
      toast({ title: 'GitHub Disconnected', description: 'Your GitHub access token has been revoked.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to disconnect GitHub.' });
    }
  };

  const handleScanRepository = async () => {
    if (!selectedRepo) return;
    setIsScanningModule(true);
    setModuleScanError(null);
    setGithubStep('discover');

    try {
      const res = await fetch('/api/github/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: selectedRepo.full_name,
          branch: selectedRepo.default_branch,
          modulePath: modulePath.trim() || 'fluxbase'
        })
      });

      const data = await res.json();
      if (!data.success) {
        setModuleScanError(data.error || 'Failed to scan repository.');
        return;
      }

      if (!data.module || !data.module.found || data.module.files.length === 0) {
        setFluxbaseModule(data.module || null);
        setModuleScanError(`No .sql files found in directory "${modulePath}" of ${selectedRepo.full_name}.`);
        return;
      }

      setFluxbaseModule(data.module);
      setPreviewData(data.preview);

      const defaultName = data.module.manifest?.projectName || 
        selectedRepo.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      setImportProjectName(defaultName);
      setImportDialect(data.module.detectedDialect || 'postgresql');

      // Auto-advance smoothly to configure so the user gets straight to execution
      setTimeout(() => {
        setGithubStep(prev => prev === 'discover' ? 'configure' : prev);
      }, 500);

    } catch (e: any) {
      setModuleScanError(e.message || 'Failed to scan repository.');
    } finally {
      setIsScanningModule(false);
    }
  };

  const handleRunImport = async () => {
    if (!selectedRepo || !fluxbaseModule) return;
    setGithubStep('executing');
    setIsImporting(true);
    setImportError(null);
    setExecutionLogs([
      `[${new Date().toLocaleTimeString()}] Initializing project "${importProjectName}" (${importDialect.toUpperCase()})...`,
      `[${new Date().toLocaleTimeString()}] Provisioning isolated serverless database workspace...`,
      `[${new Date().toLocaleTimeString()}] Discovered ${fluxbaseModule.files.length} migration file(s) from GitHub...`
    ]);

    const start = Date.now();
    const liveTimer = setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed > 300 && elapsed < 700) {
        setExecutionLogs(prev => {
          if (prev.some(l => l.includes('Provisioning isolated tenant schema'))) return prev;
          return [...prev, `[${new Date().toLocaleTimeString()}] Provisioning isolated serverless tenant schema...`];
        });
      } else if (elapsed >= 700 && elapsed < 1500) {
        setExecutionLogs(prev => {
          if (prev.some(l => l.includes('Executing SQL migration batch'))) return prev;
          return [...prev, `[${new Date().toLocaleTimeString()}] Executing SQL migration batch (${fluxbaseModule.files.map((f: any) => f.name).join(', ')})...`];
        });
      } else if (elapsed >= 1500 && elapsed < 2600) {
        setExecutionLogs(prev => {
          if (prev.some(l => l.includes('Compiling schema catalog'))) return prev;
          return [...prev, `[${new Date().toLocaleTimeString()}] Compiling schema catalog & constraints...`];
        });
      }
    }, 250);

    try {
      const res = await fetch('/api/github/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: selectedRepo.full_name,
          branch: selectedRepo.default_branch,
          modulePath: modulePath.trim() || 'fluxbase',
          projectName: importProjectName.trim(),
          dialect: importDialect,
          timezone: importTimezone,
          userRole: importRole === 'student' ? studentPlan : (importRole || 'student'),
          plan: studentPlan,
          billingPreference: importBillingPreference
        })
      });

      const data = await res.json();
      if (!data.success) {
        setImportError(data.error || 'Import failed.');
        setExecutionLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ERROR: ${data.error || 'Import failed'}`]);
        return;
      }

      setImportResult(data.importResults);
      if (data.project) {
        const fullProject = {
          ...data.project,
          role: data.project.role || 'admin',
          schema_name: data.project.schema_name || `flux_tenant_${data.project.project_id}`,
          is_serverless: true
        };
        setImportedProject(fullProject);
        setProject(fullProject);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flux:project-change', {
            detail: { action: 'INSERT', table: 'projects', record: fullProject, project: fullProject }
          }));
        }
      }
      setExecutionLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Successfully executed ${data.importResults.filesExecuted} file(s) (${data.importResults.totalStatements} statements).`,
        `[${new Date().toLocaleTimeString()}] Created tables: ${data.importResults.tablesCreated?.join(', ') || 'Done'}.`,
        `[${new Date().toLocaleTimeString()}] Project active and ready!`
      ]);
      setGithubStep('success');
      await fetchProjects(true);
    } catch (e: any) {
      setImportError(e.message || 'Execution error during import.');
      setExecutionLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] CRITICAL: ${e.message}`]);
    } finally {
      clearInterval(liveTimer);
      setIsImporting(false);
    }
  };

  useEffect(() => {
    fetchProjects();

    getUserPlanAction().then(res => {
      if (res?.plan) setCurrentPlan(res.plan.toLowerCase());
    }).catch(() => {});

    // Check GitHub connection return param
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('github_connected') === 'true') {
        const ghUser = urlParams.get('github_username') || '';
        setGithubConnected(true);
        if (ghUser) setGithubUsername(ghUser);
        setIsGithubModalOpen(true);
        setGithubStep('repos');
        fetch('/api/github/repos').then(r => r.json()).then(d => {
          if (d.success && d.repos) setGithubRepos(d.repos);
        }).catch(() => {});
        toast({
          title: 'GitHub Connected!',
          description: ghUser ? `Authorized as @${ghUser}. Select a repository to import.` : 'Connected to GitHub! Select a repo to import.'
        });
        window.history.replaceState({}, '', window.location.pathname);
      } else if (urlParams.get('error')?.includes('Github')) {
        toast({
          variant: 'destructive',
          title: 'GitHub Error',
          description: `Authorization error: ${urlParams.get('error')}`
        });
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    // Auto-provision pending paid project if user completed payment
    try {
      const pendingProjectJson = localStorage.getItem('pending_paid_project');
      if (pendingProjectJson) {
        const projData = JSON.parse(pendingProjectJson);
        getUserPlanAction().then(async (planData) => {
          const userPlan = planData.plan;
          if (userPlan && userPlan !== 'free') {
            const formData = new FormData();
            formData.append('projectName', projData.projectName);
            formData.append('dialect', projData.dialect);
            formData.append('timezone', projData.timezone || 'UTC');
            formData.append('userRole', projData.userRole || planData.role || 'employee');
            formData.append('billingPreference', projData.billingPreference || 'monthly');
            formData.append('companyName', projData.companyName || '');
            formData.append('workDescription', projData.workDescription || '');
            formData.append('connectionType', 'internal');

            toast({
              title: 'Finalizing Project Provisioning...',
              description: `Provisioning "${projData.projectName}" now that your ${userPlan.toUpperCase()} plan is confirmed.`
            });

            const result = await createProjectAction(formData);
            localStorage.removeItem('pending_paid_project');
            if (result && !result.error) {
              toast({
                title: 'Project Created!',
                description: `Project "${projData.projectName}" is active and ready.`
              });
              await fetchProjects();
            } else if (result?.error) {
              toast({
                variant: 'destructive',
                title: 'Provisioning Alert',
                description: result.error
              });
            }
          }
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Error auto-provisioning paid project:', e);
    }


    const handleProjectChange = async (e?: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent?.detail;
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
        }
      }
      try {
        const res = await fetch('/api/projects');
        const data = await res.json();
        if (data.success && Array.isArray(data.projects)) {
          setProjects(data.projects);
        }
      } catch (err) {}
    };

    window.addEventListener('flux:project-change', handleProjectChange);
    return () => {
      window.removeEventListener('flux:project-change', handleProjectChange);
    };
  }, []);

  const handleProjectSelect = (project: Project) => {
    setProject(project);
    router.push('/dashboard');
  };

  const openCreateModal = (dialect: 'postgresql' | 'mysql') => {
    setModalDialect(dialect);
    setProjectName('');
    const defaultRole: UserRoleOption = 
      (currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max') ? 'org_owner' :
      (currentPlan === 'employee' || currentPlan === 'pro') ? 'employee' :
      'student';
    setSelectedRole(hasAvailableQuota ? defaultRole : null);
    setBillingPreference('monthly');
    setCompanyName('');
    setWorkDescription('');
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || !modalDialect || !selectedRole) return;

    if (!hasAvailableQuota && selectedRole !== 'student') {
      if (!companyName.trim()) {
        toast({
          variant: 'destructive',
          title: 'Organization Name Required',
          description: 'Please provide your company or organization name.',
        });
        return;
      }
      if (!workDescription.trim()) {
        toast({
          variant: 'destructive',
          title: 'Work Description Required',
          description: 'Please describe your workload and team requirements.',
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const isAlreadyCovered = 
        hasAvailableQuota ||
        (selectedRole === 'student') ||
        (selectedRole === 'employee' && (currentPlan === 'employee' || currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max' || currentPlan === 'pro')) ||
        (selectedRole === 'org_owner' && (currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max')) ||
        (billingPreference === 'pay_as_you_go' && (currentPlan === 'pay_as_you_go' || currentPlan === 'employee' || currentPlan === 'org_owner' || currentPlan === 'max'));

      if (!isAlreadyCovered) {
        // For Paid Tiers not yet purchased:
        // 1. Save pending project payload in localStorage so it only provisions AFTER payment
        localStorage.setItem('pending_paid_project', JSON.stringify({
          projectName: projectName.trim(),
          dialect: modalDialect,
          timezone: selectedTimezone,
          userRole: selectedRole,
          billingPreference,
          companyName: companyName.trim(),
          workDescription: workDescription.trim()
        }));

        // 2. Redirect to FluxPay Hosted Gateway
        const isPayg = billingPreference === 'pay_as_you_go';
        const planKey = isPayg ? 'pay_as_you_go' : (selectedRole === 'org_owner' ? 'org_owner' : 'employee');

        setModalDialect(null);
        toast({
          title: 'Redirecting to FluxPay',
          description: `Redirecting to payments.fluxbasedb.me to review order and pay...`,
        });

        try {
          const res = await fetch('/api/payments/create-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan: planKey,
              projectData: {
                projectName: projectName.trim(),
                dialect: modalDialect,
                timezone: selectedTimezone,
                userRole: selectedRole,
                billingPreference,
                companyName: companyName.trim(),
                workDescription: workDescription.trim()
              }
            })
          });
          const data = await res.json();
          if (data.checkoutUrl) {
            let targetUrl = String(data.checkoutUrl).trim();
            if (targetUrl.startsWith('//')) {
              targetUrl = `https:${targetUrl}`;
            } else if (!/^https?:\/\//i.test(targetUrl)) {
              targetUrl = `https://${targetUrl.replace(/^\/+/, '')}`;
            }
            window.location.href = targetUrl;
            return;
          }
        } catch (e) {
          console.error('Direct checkout redirection error:', e);
        }
        router.push(`/checkout?plan=${planKey}`);
        return;
      }

      // User already has the paid tier (or Student)! Direct Instant Creation!
      const formData = new FormData();
      formData.append('projectName', projectName.trim());
      formData.append('dialect', modalDialect);
      formData.append('timezone', selectedTimezone);
      formData.append('userRole', selectedRole);
      formData.append('billingPreference', billingPreference);
      formData.append('companyName', companyName.trim() || 'Organization Workspace');
      formData.append('workDescription', workDescription.trim() || 'Dedicated workspace database');
      formData.append('connectionType', 'internal');

      const result = await createProjectAction(formData);

      if (result.success && result.project) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('flux:project-change', {
            detail: { action: 'INSERT', table: 'projects', record: result.project, project: result.project }
          }));
        }
        setModalDialect(null);
        setProject(result.project);
        toast({
          title: 'Project Created Successfully',
          description: `Created ${result.project.display_name} (${modalDialect === 'postgresql' ? 'PostgreSQL' : 'MySQL'}).`,
        });
        router.push('/dashboard');
      } else {
        throw new Error(result.error || 'Failed to create project.');
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Project Creation Failed',
        description: err.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateMcpKey = async () => {
    setIsGeneratingMcpKey(true);
    try {
      const res = await createApiKeyAction('Organization MCP Key', undefined, ['read', 'write', 'admin']);
      if (res.success && res.data?.key) {
        setMcpApiKey(res.data.key);
        toast({
          title: 'MCP API Key Generated',
          description: 'Your organization MCP key is ready. Keep it secure.',
        });
      } else {
        throw new Error(res.error || 'Failed to generate MCP key');
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Key Generation Failed',
        description: err.message,
      });
    } finally {
      setIsGeneratingMcpKey(false);
    }
  };

  const vercelMcpUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/mcp`
    : (typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://www.fluxbasedb.me/api/mcp');
  const localMcpUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'http://localhost:3000/api/mcp';
  const mcpServerUrl = mcpEnv === 'vercel' ? vercelMcpUrl : localMcpUrl;

  const mcpSnippet = JSON.stringify({
    mcpServers: {
      fluxbase: {
        url: mcpServerUrl,
        headers: {
          Authorization: `Bearer ${mcpApiKey || 'YOUR_FLUXBASE_API_KEY'}`
        }
      }
    }
  }, null, 2);

  const handleCopyMcpConfig = () => {
    navigator.clipboard.writeText(mcpSnippet);
    setHasCopiedMcp(true);
    toast({
      title: 'MCP Configuration Copied',
      description: 'Copied to clipboard. Paste into your Claude Desktop or Cursor configuration.',
    });
    setTimeout(() => setHasCopiedMcp(false), 2500);
  };

  const filteredProjects = projects.filter(p => 
    p.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.dialect?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.creator_role || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pgProjects = filteredProjects.filter(p => p.dialect?.toLowerCase() !== 'mysql');
  const mysqlProjects = filteredProjects.filter(p => p.dialect?.toLowerCase() === 'mysql');

  const renderProjectCard = (project: Project) => {
    const isPostgres = project.dialect !== 'mysql';
    return (
      <button
        key={project.project_id}
        onClick={() => handleProjectSelect(project)}
        className="w-full text-left group relative outline-none"
      >
        <Card className="relative overflow-hidden flex flex-col h-44 border-border/80 bg-card/40 transition-all duration-200 hover:bg-card/70 hover:-translate-y-0.5">
          {/* Faint Background Logo Outline */}
          <div className="absolute -right-6 -bottom-6 w-36 h-36 pointer-events-none overflow-visible z-0 transition-transform duration-300 group-hover:scale-105">
            {isPostgres ? (
              <Image 
                src="/postgres-bg.png" 
                alt="PostgreSQL Background" 
                width={144} 
                height={144} 
                className="w-full h-full object-contain grayscale invert opacity-20 group-hover:opacity-65 dark:invert-0 dark:opacity-20 dark:group-hover:opacity-85 transition-all duration-300" 
              />
            ) : (
              <Image 
                src="/mysql-bg.png" 
                alt="MySQL Background" 
                width={144} 
                height={144} 
                className="w-full h-full object-contain grayscale invert opacity-20 group-hover:opacity-65 dark:invert-0 dark:opacity-20 dark:group-hover:opacity-85 transition-all duration-300" 
              />
            )}
          </div>

          <div className="p-5 flex flex-col h-full z-10 relative">
            {/* Top: Dialect & Role (Left) and Date & Arrow (Right) */}
            <div className="flex justify-between items-center mb-3 gap-2">
              <div className="flex flex-wrap gap-1.5 items-center">
                <Badge variant="secondary" className={cn(
                  "text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 font-mono",
                  isPostgres 
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" 
                    : "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
                )}>
                  {isPostgres ? 'PostgreSQL' : 'MySQL'}
                </Badge>

                {project.creator_role && (
                  <Badge variant="outline" className={cn(
                    "text-[10px] font-mono capitalize border",
                    project.creator_role === 'employee' && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
                    project.creator_role === 'org_owner' && "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
                    project.creator_role === 'student' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  )}>
                    {project.creator_role.replace('_', ' ')}
                  </Badge>
                )}

                {project.role && (
                  <Badge variant="secondary" className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 border font-mono">
                    {project.role}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-muted-foreground/60">
                <span>{new Date(project.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
              </div>
            </div>

            {/* Middle: Project Name */}
            <div className="mt-auto mb-2">
              <h3 className="text-lg font-semibold tracking-tight text-foreground/90 group-hover:text-foreground transition-colors line-clamp-1">
                {project.display_name}
              </h3>
              {project.description && (
                <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5">
                  {project.description}
                </p>
              )}
            </div>

            {/* Bottom: Project ID */}
            <div className="flex items-center text-xs text-muted-foreground/60 font-mono mt-1 pt-2 border-t border-border/40">
              <span className="truncate max-w-[200px]">{project.project_id}</span>
            </div>
          </div>
        </Card>
      </button>
    );
  };

  const isFormValid = Boolean(
    projectName.trim() &&
    selectedRole &&
    (hasAvailableQuota || selectedRole === 'student' || (companyName.trim() && workDescription.trim()))
  );

  if (loading) {
    return <ProjectsPageSkeleton />;
  }

  return (
    <div className="flex flex-col items-center justify-start min-h-full bg-background p-4 sm:p-8 animate-in fade-in duration-500 space-y-8">
      <div className="w-full max-w-7xl space-y-8">
        
        {/* ── Page Header ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/50 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Projects & Workspaces
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Create a new database project, configure your organization MCP agent, or select an existing project.
            </p>
          </div>
          {projects.length > 0 && (
            <div className="w-full md:w-72">
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 bg-secondary/40 text-xs"
              />
            </div>
          )}
        </div>

        {/* ── 4 Primary Action Option Boxes (Equal Priority, Neutral, Badges have colors) ── */}
        <div>
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Quick Actions & Provisioning
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            
            {/* Box 1: Create PostgreSQL */}
            <Card 
              onClick={() => openCreateModal('postgresql')}
              className="relative overflow-hidden cursor-pointer border-border/80 bg-card/40 hover:bg-card/70 transition-all duration-200 flex flex-col justify-between group"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2.5 rounded-xl bg-secondary border border-border text-foreground flex items-center justify-center w-12 h-12">
                    <Image 
                      src="/postgres-bg.png" 
                      alt="PostgreSQL" 
                      width={24} 
                      height={24} 
                      className="w-6 h-6 object-contain invert opacity-80 dark:invert-0 dark:opacity-90" 
                    />
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
                    PostgreSQL
                  </Badge>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">
                  Create PostgreSQL Project
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Provision serverless PostgreSQL with full relational schemas, JSONB documents, vector indexes, and custom server tiers.
                </p>
              </div>
              <div className="p-6 pt-0">
                <Button variant="outline" className="w-full border-border hover:bg-secondary text-foreground transition-colors">
                  Configure & Create
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </Card>

            {/* Box 2: Create MySQL */}
            <Card 
              onClick={() => openCreateModal('mysql')}
              className="relative overflow-hidden cursor-pointer border-border/80 bg-card/40 hover:bg-card/70 transition-all duration-200 flex flex-col justify-between group"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2.5 rounded-xl bg-secondary border border-border text-foreground flex items-center justify-center w-12 h-12">
                    <Image 
                      src="/mysql-bg.png" 
                      alt="MySQL" 
                      width={24} 
                      height={24} 
                      className="w-6 h-6 object-contain invert opacity-80 dark:invert-0 dark:opacity-90" 
                    />
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono uppercase bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                    MySQL
                  </Badge>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">
                  Create MySQL Project
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Provision serverless MySQL 8 with high-throughput transactions, primary indexing, foreign keys, and custom server tiers.
                </p>
              </div>
              <div className="p-6 pt-0">
                <Button variant="outline" className="w-full border-border hover:bg-secondary text-foreground transition-colors">
                  Configure & Create
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </Card>

            {/* Box 3: Organization MCP Gateway */}
            <Card 
              onClick={() => setIsMcpModalOpen(true)}
              className="relative overflow-hidden cursor-pointer border-border/80 bg-card/40 hover:bg-card/70 transition-all duration-200 flex flex-col justify-between group"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-xl bg-secondary border border-border text-foreground">
                    <Bot className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono uppercase bg-purple-500/10 text-purple-400 border-purple-500/20">
                    MCP Integration
                  </Badge>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">
                  Organization MCP Gateway
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Connect AI agents (Claude, Cursor, AutoGLM) via Model Context Protocol with URL, API keys, and project automation.
                </p>
              </div>
              <div className="p-6 pt-0">
                <Button variant="outline" className="w-full border-border hover:bg-secondary text-foreground transition-colors">
                  View MCP Credentials
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </Card>

            {/* Box 4: Import from GitHub */}
            <Card 
              onClick={handleOpenGithubModal}
              className="relative overflow-hidden cursor-pointer border-border/80 bg-card/40 hover:bg-card/70 transition-all duration-200 flex flex-col justify-between group"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-xl bg-secondary border border-border text-foreground">
                    <Github className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    Git Import
                  </Badge>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1.5">
                  Import from GitHub
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Discover schema migrations from your repository's fluxbase/ folder, auto-detect dialect, and bootstrap instantly.
                </p>
              </div>
              <div className="p-6 pt-0">
                <Button variant="outline" className="w-full border-border hover:bg-secondary text-foreground transition-colors">
                  Connect & Import
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </Card>

          </div>
        </div>

        {/* ── Error Banner if any ── */}
        {error && (
          <div className="flex flex-col items-center justify-center text-center text-destructive-foreground bg-destructive/20 border border-destructive/50 rounded-lg p-8">
            <AlertTriangle className="h-10 w-10 mb-4" />
            <h3 className="text-lg font-semibold">Something went wrong</h3>
            <p className="text-sm">{error}</p>
            <Button onClick={() => { fetchProjects(); }} variant="destructive" className="mt-6">
              Try Again
            </Button>
          </div>
        )}

        {/* ── Dialect Projects Sections (Top: PostgreSQL, Down: MySQL) ── */}
        {!error && (
          <div className="space-y-12">

            {/* ── TOP SECTION: PostgreSQL Projects ── */}
            <div className="space-y-4">
              <div className="border-b border-border/60 pb-3">
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  PostgreSQL Workspaces
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Serverless relational databases with JSONB, vector extensions, and automated tenant schemas
                </p>
              </div>

              {pgProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 p-8 text-center bg-card/20">
                  <h3 className="text-sm font-semibold text-foreground">No PostgreSQL projects</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    {searchQuery ? `No PostgreSQL project matched "${searchQuery}".` : 'No PostgreSQL projects currently provisioned.'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {pgProjects.map(renderProjectCard)}
                </div>
              )}
            </div>

            {/* ── DOWN SECTION: MySQL Projects ── */}
            <div className="space-y-4 pt-2">
              <div className="border-b border-border/60 pb-3">
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  MySQL Workspaces
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  MySQL 8 relational engines with InnoDB ACID transactions and connection pooling
                </p>
              </div>

              {mysqlProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 p-8 text-center bg-card/20">
                  <h3 className="text-sm font-semibold text-foreground">No MySQL projects</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    {searchQuery ? `No MySQL project matched "${searchQuery}".` : 'No MySQL projects currently provisioned.'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {mysqlProjects.map(renderProjectCard)}
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* ── Dialog 1 & 2: Create PostgreSQL or MySQL Project Modal ── */}
      <Dialog open={modalDialect !== null} onOpenChange={(open) => { if (!open) setModalDialect(null); }}>
        <DialogContent className="sm:max-w-xl bg-card/95 backdrop-blur-2xl border-border/80 max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className={cn(
                "text-xs font-mono uppercase",
                modalDialect === 'postgresql' ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" : "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
              )}>
                {modalDialect === 'postgresql' ? 'PostgreSQL' : 'MySQL'}
              </Badge>
            </div>
            <DialogTitle className="text-xl font-bold">
              Create {modalDialect === 'postgresql' ? 'PostgreSQL' : 'MySQL'} Project
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Select your role, infrastructure tier, and configure your dedicated database workspace.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateProject} className="space-y-4 pt-2">
            
            {/* Project Name */}
            <div className="space-y-1.5">
              <Label htmlFor="projectName" className="text-xs font-semibold">Project Name</Label>
              <Input
                id="projectName"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder=""
                className="h-9 text-sm"
                required
              />
            </div>

            {/* Timezone */}
            <div className="space-y-1.5">
              <Label htmlFor="timezone" className="text-xs font-semibold">Project Timezone</Label>
              <Select value={selectedTimezone} onValueChange={setSelectedTimezone}>
                <SelectTrigger id="timezone" className="h-9 text-xs">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz} className="text-xs font-mono">
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Role & Server Tier Selection */}
            {hasAvailableQuota ? (
              <div className="rounded-xl p-4 bg-primary/5 border border-primary/20 space-y-2.5 animate-in fade-in duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          {currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max'
                            ? 'Organization Owner Tier'
                            : 'Employee Tier'}
                        </span>
                        <Badge variant="secondary" className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                          Active Plan
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {maxAllowedProjects >= 999999
                          ? `Unlimited projects included in your plan (${projects.length} provisioned)`
                          : `Project ${projects.length + 1} of ${maxAllowedProjects} included under your active subscription`}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
                  <div>
                    <span className="text-foreground font-medium">Compute: </span>
                    {currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max' ? '8 vCPU Xeon (32GB)' : '2 vCPU Dedicated (4GB)'}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Storage: </span>
                    {currentPlan === 'org_owner' || currentPlan === 'org' || currentPlan === 'max' ? '100GB NVMe' : '10GB SSD'}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Cost: </span>
                    <span className="text-emerald-500 font-semibold">₹0 (Included)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Select Your Role & Server Tier</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedRole ? `Selected: ${selectedRole.replace('_', ' ')}` : 'Please choose an option'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  
                  {/* Student */}
                  <button
                    type="button"
                    onClick={() => setSelectedRole('student')}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-lg border text-left transition-all relative overflow-hidden",
                      selectedRole === 'student'
                        ? "border-foreground bg-secondary/80 text-foreground"
                        : "border-border/80 bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center justify-end w-full mb-1">
                      <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">₹0 Free</span>
                    </div>
                    <span className="text-xs font-bold text-foreground">Student</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Shared Micro Sandbox</span>
                  </button>

                  {/* Employee */}
                  <button
                    type="button"
                    onClick={() => setSelectedRole('employee')}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-lg border text-left transition-all relative overflow-hidden",
                      selectedRole === 'employee'
                        ? "border-foreground bg-secondary/80 text-foreground"
                        : "border-border/80 bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center justify-end w-full mb-1">
                      <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">₹500/mo</span>
                    </div>
                    <span className="text-xs font-bold text-foreground">Employee</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">High-Performance (2 vCPU)</span>
                  </button>

                  {/* Org Owner */}
                  <button
                    type="button"
                    onClick={() => setSelectedRole('org_owner')}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-lg border text-left transition-all relative overflow-hidden",
                      selectedRole === 'org_owner'
                        ? "border-foreground bg-secondary/80 text-foreground"
                        : "border-border/80 bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <div className="flex items-center justify-end w-full mb-1">
                      <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">₹5,000/mo</span>
                    </div>
                    <span className="text-xs font-bold text-foreground">Org Owner</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Top-Grade (8 vCPU NVMe)</span>
                  </button>

                </div>
              </div>
            )}

            {/* Server Specifications & Pay-As-You-Go Preview (Only if choosing a plan) */}
            {(!hasAvailableQuota && selectedRole) && (
              <div className="rounded-lg p-3 bg-secondary/40 border border-border/80 space-y-2 animate-in fade-in duration-300">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground border-b border-border/60 pb-1.5">
                  <span>
                    {selectedRole === 'student' && 'Student Sandbox Compute'}
                    {selectedRole === 'employee' && 'High-Performance Dedicated Server (₹500 / mo)'}
                    {selectedRole === 'org_owner' && 'Top-Grade Enterprise Infrastructure (₹5,000 / mo)'}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {selectedRole === 'student' ? 'Community Tier' : 'Pay-As-You-Go Available'}
                  </Badge>
                </div>

                {/* Specs List */}
                <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground pt-1">
                  <div>
                    <span className="text-foreground font-medium">Compute: </span>
                    {selectedRole === 'student' && '0.5 vCPU Shared (512MB RAM)'}
                    {selectedRole === 'employee' && '2 vCPU Dedicated (4GB RAM)'}
                    {selectedRole === 'org_owner' && '8 vCPU Xeon/EPYC (32GB RAM)'}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Storage: </span>
                    {selectedRole === 'student' && '500 MB Shared Storage'}
                    {selectedRole === 'employee' && '10 GB High-Speed SSD Storage'}
                    {selectedRole === 'org_owner' && '100 GB Gen4 NVMe (10k IOPS)'}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Connections: </span>
                    {selectedRole === 'student' && '10 Concurrent Connections'}
                    {selectedRole === 'employee' && '100 Concurrent Connections'}
                    {selectedRole === 'org_owner' && '1,000+ Concurrent + Pooler'}
                  </div>
                  <div>
                    <span className="text-foreground font-medium">Pay-As-You-Go: </span>
                    {selectedRole === 'student' && 'None (Free Sandbox Limit)'}
                    {selectedRole === 'employee' && '₹0.50 / 10k queries | ₹5/GB extra'}
                    {selectedRole === 'org_owner' && '₹2.00 / 10k queries | ₹15/GB extra'}
                  </div>
                </div>
              </div>
            )}

            {/* Additional Organization Details for Employee & Org Owner (Only during first-time subscription) */}
            {(!hasAvailableQuota && (selectedRole === 'employee' || selectedRole === 'org_owner')) && (
              <div className="space-y-3 pt-2 p-3.5 rounded-lg bg-secondary/30 border border-border/80 animate-in fade-in duration-300">
                <div className="text-xs font-semibold text-foreground">
                  <span>Dedicated Server Tier & Organization Setup</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  As an {selectedRole === 'org_owner' ? 'Organization Owner' : 'Employee'}, you will be linked directly to our payment gateway to complete payment and instantly activate your dedicated database tier.
                </p>

                {/* Billing Model Selector */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Billing Model Preference</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setBillingPreference('monthly')}
                      className={cn(
                        "p-2 rounded border text-left text-xs transition-all",
                        billingPreference === 'monthly' ? "border-foreground bg-secondary font-semibold text-foreground" : "border-border/60 bg-background/50 text-muted-foreground"
                      )}
                    >
                      <div>Fixed Monthly</div>
                      <div className="text-[10px] opacity-75">{selectedRole === 'org_owner' ? '₹5,000/mo' : '₹500/mo'}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingPreference('pay_as_you_go')}
                      className={cn(
                        "p-2 rounded border text-left text-xs transition-all",
                        billingPreference === 'pay_as_you_go' ? "border-foreground bg-secondary font-semibold text-foreground" : "border-border/60 bg-background/50 text-muted-foreground"
                      )}
                    >
                      <div>Pay-As-You-Go</div>
                      <div className="text-[10px] opacity-75">₹50 refundable deposit • 28-day cycle</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingPreference('hybrid')}
                      className={cn(
                        "p-2 rounded border text-left text-xs transition-all",
                        billingPreference === 'hybrid' ? "border-foreground bg-secondary font-semibold text-foreground" : "border-border/60 bg-background/50 text-muted-foreground"
                      )}
                    >
                      <div>Hybrid Plan</div>
                      <div className="text-[10px] opacity-75">Base + Overages</div>
                    </button>
                  </div>
                </div>

                {/* Company / Organization Name */}
                <div className="space-y-1">
                  <Label htmlFor="companyName" className="text-xs font-medium">Company or Organization Name</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder=""
                    className="h-8 text-xs"
                    required
                  />
                </div>

                {/* What they do / Intended Use */}
                <div className="space-y-1">
                  <Label htmlFor="workDescription" className="text-xs font-medium">What do you do / Intended Workload</Label>
                  <Textarea
                    id="workDescription"
                    value={workDescription}
                    onChange={(e) => setWorkDescription(e.target.value)}
                    placeholder=""
                    className="min-h-[65px] text-xs resize-none"
                    required
                  />
                </div>
              </div>
            )}

            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setModalDialect(null)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || !isFormValid}
                className={cn(
                  "font-medium",
                  modalDialect === 'postgresql' ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Provisioning Workspace...
                  </>
                ) : hasAvailableQuota ? (
                  `Create ${modalDialect === 'postgresql' ? 'PostgreSQL' : 'MySQL'} Project (Included)`
                ) : !selectedRole ? (
                  'Select a Role to Continue'
                ) : billingPreference === 'pay_as_you_go' ? (
                  'Proceed to Verification (₹50 Refundable Deposit) & Activate'
                ) : selectedRole !== 'student' ? (
                  `Proceed to Payment (${selectedRole === 'org_owner' ? '₹5,000' : '₹500'}) & Activate`
                ) : (
                  `Create Free ${modalDialect === 'postgresql' ? 'PostgreSQL' : 'MySQL'} Project`
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Dialog 3: Organization MCP Gateway Modal ── */}
      <Dialog open={isMcpModalOpen} onOpenChange={setIsMcpModalOpen}>
        <DialogContent className="sm:max-w-xl bg-card/95 backdrop-blur-2xl border-border/80">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-xs font-mono uppercase bg-purple-500/10 text-purple-400 border-purple-500/20">
                Model Context Protocol
              </Badge>
            </div>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Bot className="h-5 w-5 text-purple-400" />
              Organization MCP Gateway Setup
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Connect Cursor, Claude Desktop, Windsurf, or AutoGLM to inspect schemas, build tables, and manage projects.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            
            {/* 1. MCP Environment Selector & Server URL */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">MCP Server Endpoint URL</Label>
                <div className="inline-flex items-center gap-1 p-0.5 bg-secondary/60 rounded-md border border-border/60">
                  <button
                    type="button"
                    onClick={() => setMcpEnv('vercel')}
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded font-mono transition-all",
                      mcpEnv === 'vercel' ? "bg-purple-600 text-white font-bold shadow" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Vercel Production
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpEnv('local')}
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded font-mono transition-all",
                      mcpEnv === 'local' ? "bg-purple-600 text-white font-bold shadow" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Localhost
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={mcpServerUrl}
                  className="h-9 font-mono text-xs bg-secondary/50"
                />
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(mcpServerUrl);
                    toast({ title: 'URL Copied', description: `Copied ${mcpServerUrl} to clipboard.` });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* 2. MCP API Key Generator */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Organization MCP API Token</Label>
                <button 
                  type="button" 
                  onClick={handleGenerateMcpKey}
                  disabled={isGeneratingMcpKey}
                  className="text-xs text-purple-400 hover:underline inline-flex items-center gap-1"
                >
                  {isGeneratingMcpKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
                  {mcpApiKey ? 'Generate New Key' : 'Generate Org Key'}
                </button>
              </div>
              <Input
                readOnly
                value={mcpApiKey || 'Click "Generate Org Key" to generate a live secret token'}
                placeholder=""
                className="h-9 font-mono text-xs bg-secondary/50"
              />
            </div>

            {/* 3. Claude Desktop / Cursor Config Snippet */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Claude Desktop / Cursor JSON Config</Label>
              <pre className="p-3 rounded-lg bg-black/60 border border-border text-[11px] font-mono text-muted-foreground overflow-x-auto">
                {mcpSnippet}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-muted-foreground">
                Compatible with all Model Context Protocol (MCP) clients.
              </p>
              <Button 
                onClick={handleCopyMcpConfig} 
                className="bg-purple-600 hover:bg-purple-700 text-white font-medium"
              >
                {hasCopiedMcp ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy MCP Config
                  </>
                )}
              </Button>
            </div>

          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog 4: GitHub Import Wizard Modal (7 Steps) ── */}
      <Dialog open={isGithubModalOpen} onOpenChange={(open) => {
        if (!isImporting) {
          setIsGithubModalOpen(open);
          if (!open) {
            setSelectedRepo(null);
            setFluxbaseModule(null);
            setPreviewData(null);
            setModuleScanError(null);
            setImportError(null);
          }
        }
      }}>
        <DialogContent className="sm:max-w-4xl lg:max-w-5xl rounded-none bg-card/98 backdrop-blur-2xl border border-border p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col md:flex-row">
          {/* LEFT SIDEBAR PIPELINE STACK */}
          <div className="w-full md:w-72 lg:w-80 shrink-0 border-b md:border-b-0 md:border-r border-border bg-secondary/25 flex flex-col justify-between p-5 select-none">
            <div className="space-y-4">
              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-none flex items-center gap-1 px-1.5 py-0.5">
                    <Github className="h-3 w-3" />
                    GitHub Import
                  </Badge>
                  {githubConnected && githubUsername && (
                    <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1 truncate">
                      <span className="h-1.5 w-1.5 rounded-none bg-emerald-500" />
                      @{githubUsername}
                    </span>
                  )}
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground tracking-tight">
                    Import Pipeline Stack
                  </DialogTitle>
                  <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                    Stage {['connect', 'repos', 'discover', 'configure', 'preview', 'executing', 'success'].indexOf(githubStep) + 1} of 7
                  </DialogDescription>
                </div>

                {/* 7-Segment Progress Stack Bar */}
                <div className="grid grid-cols-7 gap-1 h-1.5 w-full bg-secondary/80 pt-1">
                  {['connect', 'repos', 'discover', 'configure', 'preview', 'executing', 'success'].map((s, idx) => {
                    const currentIdx = ['connect', 'repos', 'discover', 'configure', 'preview', 'executing', 'success'].indexOf(githubStep);
                    const isDone = idx < currentIdx;
                    const isCurr = idx === currentIdx;
                    return (
                      <div
                        key={s}
                        className={cn(
                          "h-full transition-all rounded-none",
                          isDone ? "bg-emerald-500" : isCurr ? "bg-emerald-400 animate-pulse" : "bg-border/60"
                        )}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Vertical Stack of Step Cards */}
              <div className="space-y-1.5 pt-1">
                {[
                  {
                    id: 'connect',
                    title: 'Connect GitHub',
                    sub: githubConnected ? `✓ @${githubUsername || 'Sumith'}` : 'Authorize access'
                  },
                  {
                    id: 'repos',
                    title: 'Select Repository',
                    sub: selectedRepo ? `✓ ${selectedRepo.name}` : 'Choose target repository'
                  },
                  {
                    id: 'discover',
                    title: 'Schema Discovery',
                    sub: fluxbaseModule
                      ? `✓ ${fluxbaseModule.detectedDialect.toUpperCase()} (${fluxbaseModule.files.length} files)`
                      : 'Analyze SQL migrations'
                  },
                  {
                    id: 'configure',
                    title: 'Configure Project',
                    sub: importProjectName
                      ? `✓ ${importProjectName} (${importRole === 'student' ? studentPlan.toUpperCase() : importRole})`
                      : 'Name, dialect & plan'
                  },
                  {
                    id: 'preview',
                    title: 'Preview Schema',
                    sub: previewData
                      ? `✓ ${previewData.tablesToCreate?.length || 0} Tables (${previewData.estimatedStatements || 0} stmts)`
                      : 'Dry run execution'
                  },
                  {
                    id: 'executing',
                    title: 'Execute & Deploy',
                    sub: importError ? 'Failed — click to retry' : isImporting ? 'Provisioning...' : 'Run SQL migrations'
                  },
                  {
                    id: 'success',
                    title: 'Ready',
                    sub: importResult ? '✓ Live database workspace' : 'Complete & launch'
                  }
                ].map((st, idx) => {
                  const stepOrder = ['connect', 'repos', 'discover', 'configure', 'preview', 'executing', 'success'];
                  const currentIdx = stepOrder.indexOf(githubStep);
                  const isPassed = idx < currentIdx;
                  const isCurrent = idx === currentIdx;
                  const canNavigate = isPassed && !isImporting;

                  return (
                    <button
                      key={st.id}
                      type="button"
                      disabled={!canNavigate}
                      onClick={() => {
                        if (canNavigate) {
                          setImportError(null);
                          setGithubStep(st.id as any);
                        }
                      }}
                      className={cn(
                        "w-full text-left p-2.5 rounded-none border transition-all relative flex flex-col gap-0.5",
                        isCurrent
                          ? "bg-emerald-500/10 border-emerald-500 border-l-4 border-l-emerald-500 text-emerald-400 font-semibold shadow-sm"
                          : isPassed
                            ? "bg-secondary/40 border-border text-foreground hover:bg-emerald-500/5 hover:border-emerald-500/40 cursor-pointer"
                            : "opacity-40 border-border/40 text-muted-foreground cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className={cn("font-bold", isCurrent ? "text-emerald-400" : isPassed ? "text-emerald-500" : "text-muted-foreground/60")}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        {isPassed ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-[9px] font-bold uppercase">
                            <Check className="h-3 w-3 stroke-[3]" />
                            Done
                          </span>
                        ) : isCurrent ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-[9px] font-bold uppercase">
                            <span className="h-1.5 w-1.5 rounded-none bg-emerald-400 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="text-[9px] text-muted-foreground/50 uppercase">Queued</span>
                        )}
                      </div>
                      <div className={cn("text-xs font-semibold", isCurrent ? "text-emerald-300" : isPassed ? "text-foreground" : "text-muted-foreground")}>
                        {st.title}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {st.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Stack Footer */}
            <div className="pt-4 border-t border-border/80 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>AES-256-GCM</span>
              </div>
              <span className="text-emerald-400 font-semibold">ISOLATED TENANT</span>
            </div>
          </div>

          {/* RIGHT MAIN CONTENT AREA */}
          <div className="flex-1 flex flex-col p-6 sm:p-7 overflow-y-auto max-h-[90vh] relative">
            <div className="space-y-1 mb-4 pr-10 shrink-0">
              <div className="text-[10px] font-mono uppercase text-emerald-400 font-semibold tracking-wider">
                Pipeline Stage {['connect', 'repos', 'discover', 'configure', 'preview', 'executing', 'success'].indexOf(githubStep) + 1} of 7
              </div>
              <h2 className="text-xl font-bold text-foreground">
                {githubStep === 'connect' && 'Connect GitHub Account'}
                {githubStep === 'repos' && 'Select Target Repository'}
                {githubStep === 'discover' && 'Schema Discovery & Dialect Detection'}
                {githubStep === 'configure' && 'Configure Database Workspace'}
                {githubStep === 'preview' && 'Schema Dry Run Preview'}
                {githubStep === 'executing' && 'Provisioning Database Workspace'}
                {githubStep === 'success' && 'Database Live & Provisioned'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {githubStep === 'connect' && 'Authorize Fluxbase to inspect your repositories and detect database schemas.'}
                {githubStep === 'repos' && 'Choose a repository containing your database migration SQL files.'}
                {githubStep === 'discover' && 'Discovered SQL migrations and dialect analysis from your repo.'}
                {githubStep === 'configure' && 'Set your project name, dialect engine, role, and student plan tier.'}
                {githubStep === 'preview' && 'Review detected tables and SQL statements before provisioning.'}
                {githubStep === 'executing' && 'Executing SQL migrations into your isolated tenant database workspace.'}
                {githubStep === 'success' && 'Your database has been bootstrapped and is ready for queries.'}
              </p>
            </div>

          {/* STEP 1: CONNECT */}
          {githubStep === 'connect' && (
            <div className="py-6 my-auto flex flex-col items-center text-center space-y-5">
              <div className="p-4 rounded-none bg-secondary/80 border border-border text-foreground relative group">
                <Github className="h-12 w-12" />
                <div className="absolute -bottom-1 -right-1 p-1 rounded-none bg-emerald-500 text-black">
                  <Plus className="h-3 w-3" />
                </div>
              </div>

              <div className="max-w-md space-y-1.5">
                <h3 className="text-base font-semibold text-foreground">
                  Connect GitHub for Schema Discovery
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Authorize Fluxbase to inspect your public and private repositories. We will locate the <code className="px-1.5 py-0.5 rounded-none bg-secondary font-mono text-[11px] border border-border/60">fluxbase/</code> folder, auto-detect the SQL dialect, and execute the migrations in your dedicated tenant database.
                </p>
              </div>

              <div className="p-3.5 rounded-none bg-secondary/30 border border-border text-left max-w-md w-full text-xs text-muted-foreground space-y-1.5">
                <div className="flex items-center gap-2 text-foreground font-medium">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Secure & Encrypted</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  GitHub access tokens are encrypted with AES-256-GCM at rest. Fluxbase never modifies or writes files to your repository.
                </p>
              </div>

              <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md">
                {githubConnected ? (
                  <>
                    <Button
                      onClick={() => { setGithubStep('repos'); fetchRepos(); }}
                      className="w-full sm:w-auto min-w-[210px] h-10 px-6 rounded-none bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs tracking-wide shadow-md shadow-emerald-950/40 flex items-center justify-center gap-2"
                    >
                      <span>Continue as {githubUsername.replace(/^@/, '') || 'Sumith'}</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleDisconnectGithub}
                      className="w-full sm:w-auto h-10 px-5 rounded-none text-xs text-destructive hover:bg-destructive/10 border border-destructive/40 font-medium"
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={() => {
                        window.location.href = '/api/auth/github/import?returnTo=/dashboard/projects';
                      }}
                      className="w-full sm:w-auto min-w-[220px] h-10 px-6 rounded-none bg-white text-black hover:bg-white/90 font-semibold text-xs flex items-center justify-center gap-2.5"
                    >
                      <Github className="h-4 w-4" />
                      <span>Connect GitHub Account</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsGithubModalOpen(false)}
                      className="w-full sm:w-auto h-10 px-5 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium"
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: SELECT REPO */}
          {githubStep === 'repos' && (
            <div className="flex-1 flex flex-col min-h-0 space-y-3.5 pt-1">
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between shrink-0">
                <div className="w-full sm:w-72">
                  <Input
                    placeholder="Filter repositories..."
                    value={repoSearch}
                    onChange={(e) => {
                      setRepoSearch(e.target.value);
                      fetchRepos(e.target.value);
                    }}
                    className="h-9 text-xs rounded-none bg-secondary/50 border border-border focus-visible:ring-emerald-500/50"
                  />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Label htmlFor="modulePath" className="text-xs text-muted-foreground whitespace-nowrap">
                    Folder Path:
                  </Label>
                  <Input
                    id="modulePath"
                    value={modulePath}
                    onChange={(e) => setModulePath(e.target.value)}
                    placeholder="fluxbase"
                    className="h-9 w-32 font-mono text-xs rounded-none bg-secondary/50 border border-border focus-visible:ring-emerald-500/50"
                  />
                </div>
              </div>

              {/* Repo list - expands and fills the available vertical space */}
              <div className="border border-border rounded-none overflow-hidden flex-1 min-h-[320px] max-h-[500px] overflow-y-auto divide-y divide-border/60 bg-secondary/20">
                {loadingRepos ? (
                  <div className="p-10 flex flex-col items-center justify-center text-muted-foreground gap-2 min-h-[220px]">
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
                    <span className="text-xs font-mono">Loading repositories from GitHub...</span>
                  </div>
                ) : githubRepos.length === 0 ? (
                  <div className="p-10 text-center text-xs text-muted-foreground font-mono min-h-[220px] flex items-center justify-center">
                    No repositories found matching "{repoSearch}".
                  </div>
                ) : (
                  githubRepos.map((repo) => {
                    const isSelected = selectedRepo?.id === repo.id;
                    const linkedProject = projects.find(p => p.github_repo?.toLowerCase() === repo.full_name?.toLowerCase());
                    return (
                      <div
                        key={repo.id}
                        onClick={() => setSelectedRepo(repo)}
                        className={cn(
                          "p-3 flex items-center justify-between gap-3 cursor-pointer transition-colors",
                          isSelected ? "bg-emerald-500/10 border-l-2 border-emerald-500" : "hover:bg-secondary/50"
                        )}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-foreground truncate">
                              {repo.full_name}
                            </span>
                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0.5 rounded-none border border-border">
                              {repo.private ? <Lock className="h-2.5 w-2.5 mr-1 inline" /> : <Globe className="h-2.5 w-2.5 mr-1 inline" />}
                              {repo.private ? 'Private' : 'Public'}
                            </Badge>
                            {repo.language && (
                              <span className="text-[10px] text-muted-foreground/80 font-mono px-1.5 py-0.5 border border-border/50 bg-secondary/40">
                                {repo.language}
                              </span>
                            )}
                            {linkedProject && (
                              <Badge variant="secondary" className="text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-none">
                                Linked: {linkedProject.display_name}
                              </Badge>
                            )}
                          </div>
                          {repo.description && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {repo.description}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          <div className={cn(
                            "w-4 h-4 rounded-none border flex items-center justify-center transition-colors",
                            isSelected ? "border-emerald-500 bg-emerald-500 text-black shadow-sm" : "border-muted-foreground/40"
                          )}>
                            {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Notice if selected repo has an existing project */}
              {existingProjectForSelectedRepo && (
                <div className="p-3 shrink-0 rounded-none bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2.5">
                  <Info className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="text-[11px] leading-relaxed">
                    Project <strong className="text-white font-mono">{existingProjectForSelectedRepo.display_name}</strong> is already linked to this repo. Importing again creates an independent project environment.
                  </span>
                </div>
              )}

              <DialogFooter className="pt-2 mt-auto shrink-0 flex flex-col sm:flex-row items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGithubStep('connect')}
                    className="h-9.5 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleDisconnectGithub}
                    className="h-9.5 px-3 rounded-none text-xs text-muted-foreground hover:text-destructive"
                  >
                    Disconnect @{githubUsername}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsGithubModalOpen(false)}
                    className="h-9.5 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!selectedRepo}
                    onClick={handleScanRepository}
                    className="h-9.5 px-5 rounded-none bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 flex items-center gap-2"
                  >
                    <span>Scan Repository</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}

          {/* STEP 3: DISCOVER & DETECT */}
          {githubStep === 'discover' && (
            <div className="flex-1 flex flex-col justify-center space-y-4 my-auto">
              {isScanningModule ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                  <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      Scanning {selectedRepo?.name}...
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Checking for <code className="font-mono px-1 py-0.5 rounded-none bg-secondary border border-border/60">{modulePath}/</code> module, analyzing SQL migrations & syntax...
                    </p>
                  </div>
                </div>
              ) : moduleScanError ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-none bg-destructive/10 border border-destructive/30 text-destructive-foreground space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-xs">
                      <XCircle className="h-4 w-4" />
                      Fluxbase Module Not Found
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {moduleScanError}
                    </p>
                  </div>

                  <div className="p-4 rounded-none bg-secondary/30 border border-border space-y-2 text-xs">
                    <span className="font-semibold text-foreground">How to configure your repository:</span>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-[11px] leading-relaxed">
                      <li>Create a <code className="px-1 py-0.5 rounded-none bg-secondary font-mono border border-border/50">fluxbase/</code> folder in the root of <strong className="text-foreground">{selectedRepo?.name}</strong>.</li>
                      <li>Add your schema migration SQL files (e.g., <code className="px-1 py-0.5 rounded-none bg-secondary font-mono border border-border/50">001_create_users.sql</code>, <code className="px-1 py-0.5 rounded-none bg-secondary font-mono border border-border/50">002_create_posts.sql</code>).</li>
                      <li>(Optional) Add a <code className="px-1 py-0.5 rounded-none bg-secondary font-mono border border-border/50">fluxbase.json</code> manifest to declare custom dialect, execution order, or project name.</li>
                    </ol>
                  </div>

                  <DialogFooter className="pt-3">
                    <Button variant="outline" onClick={() => setGithubStep('repos')} className="h-9.5 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium">
                      Back to Repositories
                    </Button>
                  </DialogFooter>
                </div>
              ) : fluxbaseModule && (
                <div className="space-y-4">
                  {/* Dialect detection card */}
                  <div className="p-4 rounded-none bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-emerald-400">
                          Detected Dialect:
                        </span>
                        <Badge variant="secondary" className="text-xs font-mono uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold rounded-none px-2 py-0.5">
                          {fluxbaseModule.detectedDialect}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-mono border border-emerald-500/30 text-emerald-400 rounded-none px-2 py-0.5">
                          {fluxbaseModule.dialectConfidence}% confidence
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {fluxbaseModule.manifest
                          ? 'Configured from fluxbase.json manifest'
                          : 'Auto-detected from keyword scoring in SQL migration files'}
                      </p>
                    </div>
                    <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
                  </div>

                  {/* Discovered files */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Found {fluxbaseModule.files.length} SQL Migration File(s) in <code className="font-mono text-foreground px-1 py-0.5 rounded-none bg-secondary border border-border/60">{modulePath}/</code></span>
                      <span className="font-mono text-[11px]">{Math.round(fluxbaseModule.totalSizeBytes / 1024 * 10) / 10} KB total</span>
                    </div>

                    <div className="rounded-none border border-border bg-secondary/20 divide-y divide-border/50 max-h-48 overflow-y-auto">
                      {fluxbaseModule.files.map((file: any, idx: number) => (
                        <div key={file.sha} className="p-2.5 px-3 flex items-center justify-between text-xs font-mono">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground/50 text-[10px] w-4">{idx + 1}.</span>
                            <FileCode className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-foreground font-medium">{file.name}</span>
                          </div>
                          <span className="text-muted-foreground text-[10px]">{Math.round(file.size / 1024 * 10) / 10} KB</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <DialogFooter className="pt-3 flex flex-row items-center justify-between w-full">
                    <Button variant="outline" onClick={() => setGithubStep('repos')} className="h-9.5 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium">
                      Back to Repositories
                    </Button>
                    <Button
                      onClick={() => setGithubStep('configure')}
                      className="h-9.5 px-5 rounded-none bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 flex items-center gap-2"
                    >
                      <span>Configure Project</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: CONFIGURE */}
          {githubStep === 'configure' && (
            <div className="space-y-4 pt-2">
              {/* Notice if selected repo has an existing project */}
              {existingProjectForSelectedRepo && (
                <div className="p-3 rounded-none bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                  <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-amber-200">Existing Project Detected</span>
                    <p className="text-[11px] text-amber-300/80 leading-relaxed">
                      You already have <strong className="text-white font-mono">{existingProjectForSelectedRepo.display_name}</strong> linked to <span className="font-mono">{selectedRepo?.full_name}</span>. Importing again will create a second, independent project environment.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="importProjectName" className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span>Project Name</span>
                  <span className="text-[10px] text-muted-foreground font-normal">Identifies your database in the dashboard</span>
                </Label>
                <Input
                  id="importProjectName"
                  value={importProjectName}
                  onChange={(e) => setImportProjectName(e.target.value)}
                  placeholder="My Database Project"
                  className="h-9.5 text-xs bg-background/50 border border-border rounded-none focus-visible:ring-emerald-500/50"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="importDialect" className="text-xs font-semibold text-foreground">
                    Dialect Engine
                  </Label>
                  <Select value={importDialect} onValueChange={(val: any) => setImportDialect(val)}>
                    <SelectTrigger id="importDialect" className="h-9.5 text-xs bg-background/50 border border-border rounded-none focus:ring-emerald-500/50">
                      <SelectValue placeholder="Select dialect" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border border-border">
                      <SelectItem value="postgresql" className="text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <div className="relative w-3.5 h-3.5 shrink-0">
                            <Image 
                              src="/postgres-bg.png" 
                              alt="PostgreSQL" 
                              width={14} 
                              height={14} 
                              className="w-full h-full object-contain invert opacity-80 dark:invert-0 dark:opacity-90" 
                            />
                          </div>
                          <span>PostgreSQL (Serverless)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="mysql" className="text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <div className="relative w-3.5 h-3.5 shrink-0">
                            <Image 
                              src="/mysql-bg.png" 
                              alt="MySQL" 
                              width={14} 
                              height={14} 
                              className="w-full h-full object-contain invert opacity-80 dark:invert-0 dark:opacity-90" 
                            />
                          </div>
                          <span>MySQL 8 (Serverless)</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="importTimezone" className="text-xs font-semibold text-foreground">
                    Timezone
                  </Label>
                  <Select value={importTimezone} onValueChange={setImportTimezone}>
                    <SelectTrigger id="importTimezone" className="h-9.5 text-xs bg-background/50 border border-border rounded-none focus:ring-emerald-500/50">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent className="max-h-56 rounded-none border border-border">
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz} className="text-xs font-mono">
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Role & Server Tier Selection */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">Account Role & Tier</Label>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    {(importRole || 'student').replace('_', ' ').toUpperCase()} SELECTED
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'student', title: 'Student', price: (importRole || 'student') === 'student' ? `Plan: ${studentPlan.toUpperCase()}` : 'Free / Pro / Max', desc: 'Academic & Sandbox', icon: GraduationCap },
                    { id: 'employee', title: 'Employee', price: '₹500 / mo', desc: 'High Performance', icon: Briefcase },
                    { id: 'org_owner', title: 'Org Owner', price: '₹5,000 / mo', desc: 'Enterprise Scaling', icon: Building2 },
                  ].map((tier) => {
                    const isSel = (importRole || 'student') === tier.id;
                    const Icon = tier.icon;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setImportRole(tier.id as any)}
                        className={cn(
                          "flex flex-col p-2.5 rounded-none border text-left transition-all relative overflow-hidden",
                          isSel
                            ? "border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/50 text-emerald-400"
                            : "border-border bg-secondary/30 hover:bg-secondary/60 hover:border-border text-muted-foreground"
                        )}
                      >
                        {isSel && (
                          <div className="absolute top-2 right-2 h-4 w-4 rounded-none bg-emerald-500 text-black flex items-center justify-center">
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          </div>
                        )}
                        <Icon className={cn("h-4 w-4 mb-1.5", isSel ? "text-emerald-400" : "text-muted-foreground")} />
                        <span className={cn("text-xs font-bold", isSel ? "text-emerald-300" : "text-foreground")}>
                          {tier.title}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground/80 mt-0.5">{tier.price}</span>
                        <span className="text-[10px] text-muted-foreground/70 mt-0.5">{tier.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Student Plan Selection: Free, Pro, Max */}
              {(importRole || 'student') === 'student' && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <GraduationCap className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Student Plan</span>
                    </Label>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold uppercase">
                      STUDENT {studentPlan.toUpperCase()} SELECTED
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'free', title: 'Free', price: '₹0 / mo', desc: 'Coursework & Learning', badge: 'Sandbox', limit: '1 Project • 500 MB' },
                      { id: 'pro', title: 'Pro', price: '₹4 / mo', desc: 'Thesis & Portfolios', badge: 'Popular', limit: '3 Projects • 8 GB SSD' },
                      { id: 'max', title: 'Max', price: '₹2 / mo', desc: 'Startups & Capstones', badge: 'Best Value', limit: 'Unlimited • 50 GB' },
                    ].map((plan) => {
                      const isPlanSel = studentPlan === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setStudentPlan(plan.id as any)}
                          className={cn(
                            "flex flex-col p-2.5 rounded-none border text-left transition-all relative overflow-hidden",
                            isPlanSel
                              ? "border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/50 text-emerald-400"
                              : "border-border bg-secondary/30 hover:bg-secondary/60 hover:border-border text-muted-foreground"
                          )}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className={cn(
                              "text-[9px] font-mono px-1.5 py-0.5 rounded-none border font-semibold",
                              isPlanSel ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-secondary text-muted-foreground border-border"
                            )}>
                              {plan.badge}
                            </span>
                            {isPlanSel && (
                              <div className="h-4 w-4 rounded-none bg-emerald-500 text-black flex items-center justify-center">
                                <Check className="h-2.5 w-2.5 stroke-[3]" />
                              </div>
                            )}
                          </div>
                          <span className={cn("text-xs font-bold", isPlanSel ? "text-emerald-300" : "text-foreground")}>
                            {plan.title}
                          </span>
                          <span className="text-[11px] font-mono font-semibold text-foreground/90 mt-0.5">{plan.price}</span>
                          <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{plan.desc}</span>
                          <span className="text-[9px] font-mono text-emerald-400/80 mt-1 pt-1 border-t border-border/40">{plan.limit}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Billing Preference Selection */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">Billing Preference</Label>
                  <span className="text-[10px] text-muted-foreground font-mono uppercase">
                    {importBillingPreference.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'monthly', title: 'Monthly Fixed', desc: 'Predictable pricing' },
                    { id: 'pay_as_you_go', title: 'Pay As You Go', desc: 'Metered compute & rows' },
                    { id: 'hybrid', title: 'Hybrid Model', desc: 'Base quota + overage' },
                  ].map((bp) => {
                    const isSel = importBillingPreference === bp.id;
                    return (
                      <button
                        key={bp.id}
                        type="button"
                        onClick={() => setImportBillingPreference(bp.id as any)}
                        className={cn(
                          "flex flex-col p-2.5 rounded-none border text-left transition-all relative",
                          isSel
                            ? "border-emerald-500 bg-emerald-500/10 shadow-sm shadow-emerald-950/40 ring-1 ring-emerald-500/50 text-emerald-400"
                            : "border-border bg-secondary/30 hover:bg-secondary/60 hover:border-border text-muted-foreground"
                        )}
                      >
                        {isSel && (
                          <div className="absolute top-2 right-2 h-4 w-4 rounded-none bg-emerald-500 text-black flex items-center justify-center">
                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                          </div>
                        )}
                        <span className={cn("text-xs font-semibold", isSel ? "text-emerald-300" : "text-foreground")}>
                          {bp.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground/80 mt-0.5">{bp.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <DialogFooter className="pt-3 flex flex-row items-center justify-between w-full">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGithubStep('discover')}
                  className="h-9.5 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium"
                >
                  Back to Discovery
                </Button>
                <Button
                  type="button"
                  disabled={!importProjectName.trim()}
                  onClick={() => setGithubStep('preview')}
                  className="h-9.5 px-5 rounded-none bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 flex items-center gap-2"
                >
                  <span>Preview Schema (Dry Run)</span>
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 5: PREVIEW (DRY RUN) */}
          {githubStep === 'preview' && (
            <div className="space-y-4 pt-2">
              {/* Summary banner */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-3 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Tables</span>
                  <div className="text-lg font-bold text-foreground mt-0.5">
                    {previewData?.tablesToCreate?.length || 0}
                  </div>
                </div>
                <div className="p-3 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Statements</span>
                  <div className="text-lg font-bold text-foreground mt-0.5">
                    {previewData?.estimatedStatements || 0}
                  </div>
                </div>
                <div className="p-3 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Dialect</span>
                  <div className="text-lg font-bold text-foreground mt-0.5 capitalize">
                    {importDialect}
                  </div>
                </div>
                <div className="p-3 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Plan Tier</span>
                  <div className="text-lg font-bold text-emerald-400 mt-0.5 capitalize truncate">
                    {importRole === 'student' ? studentPlan : importRole}
                  </div>
                </div>
              </div>

              {/* Warnings if any */}
              {previewData?.warnings && previewData.warnings.length > 0 && (
                <div className="p-3 rounded-none bg-amber-500/10 border border-amber-500/30 text-amber-400 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <AlertTriangle className="h-4 w-4" />
                    SQL Notices & Warnings
                  </div>
                  <ul className="text-[11px] list-disc list-inside space-y-0.5 opacity-90 font-mono">
                    {previewData.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tables list preview */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-foreground">Tables & Schema Architecture</span>
                <div className="border border-border rounded-none overflow-hidden max-h-52 overflow-y-auto divide-y divide-border/40 bg-secondary/20">
                  {previewData?.tablesToCreate?.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground font-mono">
                      No explicit CREATE TABLE statements parsed. Raw SQL files will be executed directly.
                    </div>
                  ) : (
                    previewData?.tablesToCreate?.map((tbl: any) => (
                      <div key={tbl.tableName} className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Database className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="font-mono text-xs font-bold text-foreground">{tbl.tableName}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {tbl.columns.length} column(s)
                          </span>
                        </div>
                        {tbl.columns.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {tbl.columns.map((col: any) => (
                              <span key={col.name} className="px-1.5 py-0.5 rounded-none bg-secondary font-mono text-[10px] text-muted-foreground border border-border/40">
                                {col.name}: <span className="text-foreground">{col.type}</span>
                                {!col.nullable && <span className="text-amber-400 ml-0.5">*</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-3 rounded-none bg-emerald-500/5 border border-emerald-500/20 text-[11px] text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Fluxbase will automatically inject isolated search path scoping to guarantee complete schema privacy.</span>
              </div>

              <DialogFooter className="pt-3 flex flex-row items-center justify-between w-full">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGithubStep('configure')}
                  className="h-9.5 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium"
                >
                  Back to Configure
                </Button>
                <Button
                  type="button"
                  onClick={handleRunImport}
                  className="h-9.5 px-5 rounded-none bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 flex items-center gap-2"
                >
                  <span>Execute Import & Provision</span>
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* STEP 6: EXECUTING */}
          {githubStep === 'executing' && (
            <div className="py-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {importError ? (
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                  )}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {importError ? 'Migration Execution Failed' : 'Bootstrapping Database Workspace...'}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {importError ? 'An error occurred while provisioning your database.' : 'Executing SQL migrations into your isolated tenant schema.'}
                    </p>
                  </div>
                </div>
                {importError ? (
                  <Badge variant="destructive" className="font-mono text-[10px] rounded-none">
                    Failed
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="font-mono text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-none">
                    Running
                  </Badge>
                )}
              </div>

              {/* Terminal log window */}
              <div className="p-3 rounded-none bg-black/80 border border-border text-emerald-400 font-mono text-[11px] max-h-56 overflow-y-auto space-y-1">
                {executionLogs.map((log, idx) => (
                  <div key={idx} className={cn("leading-relaxed whitespace-pre-wrap", log.includes("ERROR") || log.includes("CRITICAL") ? "text-red-400" : "")}>{log}</div>
                ))}
              </div>

              {importError && (
                <div className="space-y-3">
                  <div className="p-3 rounded-none bg-destructive/10 border border-destructive/30 text-destructive-foreground text-xs flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{importError}</span>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setImportError(null);
                        setGithubStep('configure');
                      }}
                      className="h-9 px-4 rounded-none text-xs border border-border hover:bg-secondary/60 font-medium"
                    >
                      Back to Configure
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRunImport}
                      className="h-9 px-4 rounded-none text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      Retry Import
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 7: SUCCESS */}
          {githubStep === 'success' && (
            <div className="py-6 my-auto flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-300">
              <div className="p-4 rounded-none bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <CheckCircle2 className="h-12 w-12" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-bold text-foreground">
                  Database Provisioned & Bootstrapped!
                </h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Project <strong className="text-foreground">{importProjectName}</strong> has been created and synced with <span className="font-mono text-foreground">{selectedRepo?.full_name}</span>.
                </p>
              </div>

              {/* Summary details card */}
              <div className="grid grid-cols-3 gap-2 w-full max-w-md pt-2">
                <div className="p-2.5 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Files Executed</span>
                  <div className="text-sm font-bold text-foreground mt-0.5">
                    {importResult?.filesExecuted || fluxbaseModule?.files?.length || 0}
                  </div>
                </div>
                <div className="p-2.5 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Statements</span>
                  <div className="text-sm font-bold text-foreground mt-0.5">
                    {importResult?.totalStatements || 0}
                  </div>
                </div>
                <div className="p-2.5 rounded-none bg-secondary/40 border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">Time</span>
                  <div className="text-sm font-bold text-foreground mt-0.5">
                    {importResult?.executionTimeMs ? `${importResult.executionTimeMs}ms` : '< 1s'}
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-none bg-secondary/30 border border-border text-left max-w-md w-full text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Continuous Re-Sync Supported</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  As you push updates to <code className="font-mono px-1 py-0.5 rounded-none bg-secondary border border-border/50">{modulePath}/</code> on GitHub, you can pull new SQL migrations directly from your Project Settings.
                </p>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsGithubModalOpen(false);
                    if (importedProject) {
                      setProject(importedProject);
                    }
                    fetchProjects();
                  }}
                  className="w-full sm:w-auto min-w-[180px] h-10 px-5 rounded-none text-xs font-medium border border-border hover:bg-secondary/60"
                >
                  Close & View Projects
                </Button>
                <Button
                  onClick={() => {
                    setIsGithubModalOpen(false);
                    if (importedProject?.project_id) {
                      setProject(importedProject);
                      if (typeof document !== 'undefined') {
                        document.cookie = `selectedProject=${encodeURIComponent(JSON.stringify(importedProject))}; path=/; max-age=31536000; SameSite=Lax`;
                      }
                      const firstTable = importResult?.tablesCreated?.[0] || '';
                      const targetUrl = `/editor?projectId=${importedProject.project_id}${firstTable ? `&tableName=${encodeURIComponent(firstTable)}` : ''}`;
                      window.location.href = targetUrl;
                    } else {
                      router.push('/dashboard');
                    }
                  }}
                  className="w-full sm:w-auto min-w-[200px] h-10 px-6 rounded-none bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 flex items-center justify-center gap-2"
                >
                  <span>Open in Table Editor</span>
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

