"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Volume2, VolumeX, ArrowUp, Zap, GripVertical, Play } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useContext } from "react";
import { ProjectContext } from "@/contexts/project-context";
import { createProjectAction } from "@/components/layout/actions";
import { cn } from "@/lib/utils";
import { FluxAiApprovalCard, ApprovalRequestData } from "@/components/flux-ai-approval-card";
import { FluxMarkdownRenderer } from "@/components/flux-markdown-renderer";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button, LiquidButton } from "@/components/ui/button";
import { FluxAiIcon } from "@/components/ui/flux-ai-icon";

// --- Types ---

type Message = {
  role: "user" | "assistant";
  content: string;
  pendingWorkflow?: { steps: WorkflowStep[] };
  approvalRequest?: ApprovalRequestData;
  sources?: string[];
  hidden?: boolean;
  timestamp?: number;
  isStreaming?: boolean;
};

type WorkflowStep = {
  type: "NAVIGATE" | "CLICK" | "TYPE" | "CONFIRM_ACTION" | "EXECUTE_SQL" | "REQUEST_APPROVAL" | "CALL_MCP" | "GOAL_ACCOMPLISHED";
  path?: string;
  elementId?: string;
  value?: string;
  locator?: string;
  actionType?: "CREATE_PROJECT" | "INJECT_SQL" | "EXECUTE_SQL" | "DROP_TABLE" | "MUTATION";
  projectName?: string;
  dialect?: string;
  query?: string;
  approvalData?: ApprovalRequestData;
  mcpTool?: string;
  mcpArgs?: Record<string, any>;
  goalSummary?: string;
};

type ActiveWorkflow = {
  steps: WorkflowStep[];
  currentStepIndex: number;
};

// --- Constants ---

const MAX_MESSAGES = 50;
const MAX_STORAGE_BYTES = 512 * 1024;

// --- Workflow Parser ---

const parseWorkflow = (text: string, currentProjectId?: string): { steps: WorkflowStep[]; cleanText: string; approvalRequest?: ApprovalRequestData } => {
  const steps: WorkflowStep[] = [];
  let approvalRequest: ApprovalRequestData | undefined = undefined;

  const codeBlockRanges: [number, number][] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    codeBlockRanges.push([cbMatch.index, cbMatch.index + cbMatch[0].length]);
  }

  const tagRegex = /\[(NAVIGATE|CLICK|TYPE|CONFIRM_ACTION|EXECUTE_SQL|REQUEST_APPROVAL|CALL_MCP|GOAL_ACCOMPLISHED):([^\]]*?)]/g;
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const inCode = codeBlockRanges.some(([start, end]) => match!.index >= start && match!.index < end);
    if (inCode) continue;

    const type = match[1].toUpperCase();
    const argsStr = match[2];

    if (type === 'NAVIGATE') {
      let p = argsStr.trim().replace(/^<\/+/, '/').replace(/>+$/, '');
      if (!p.startsWith('/')) p = '/' + p;
      steps.push({ type: 'NAVIGATE', path: p });
    } else if (type === 'CLICK') {
      steps.push({ type: 'CLICK', elementId: argsStr.trim() });
    } else if (type === 'TYPE') {
      const colonIdx = argsStr.lastIndexOf(':');
      if (colonIdx !== -1) {
        steps.push({ type: 'TYPE', value: argsStr.substring(0, colonIdx).trim(), locator: argsStr.substring(colonIdx + 1).trim() });
      }
    } else if (type === 'EXECUTE_SQL') {
      let query = argsStr.trim();
      if (!query || query.toLowerCase().includes('rawsqlquery') || query.startsWith('<') || query.endsWith('>') || query === '<query>') {
        const sqlBlock = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
        if (sqlBlock?.[1]?.trim()) query = sqlBlock[1].trim().replace(/;+$/, '');
      }
      if (query && !query.startsWith('<') && !query.toLowerCase().includes('rawsqlquery') && query !== '<query>') {
        steps.push({ type: 'EXECUTE_SQL', query });
      }
    } else if (type === 'REQUEST_APPROVAL') {
      const parts = argsStr.split(':');
      const id = parts[0]?.trim() || `appr_${Date.now()}`;
      const actionType = (parts[1]?.trim().toUpperCase() || 'EXECUTE_SQL') as any;
      const summary = parts[2]?.trim() || 'Review sensitive database operation';
      const payload = argsStr.split(':').slice(3).join(':').trim();
      approvalRequest = {
        id,
        actionType,
        summary,
        payload,
        projectId: currentProjectId,
        status: 'pending'
      };
      steps.push({ type: 'REQUEST_APPROVAL', approvalData: approvalRequest });
    } else if (type === 'CALL_MCP') {
      const firstColon = argsStr.indexOf(':');
      const mcpTool = firstColon !== -1 ? argsStr.substring(0, firstColon).trim() : argsStr.trim();
      let mcpArgs = {};
      if (firstColon !== -1) {
        try { mcpArgs = JSON.parse(argsStr.substring(firstColon + 1).trim()); } catch {}
      }
      steps.push({ type: 'CALL_MCP', mcpTool, mcpArgs });
    } else if (type === 'GOAL_ACCOMPLISHED') {
      steps.push({ type: 'GOAL_ACCOMPLISHED', goalSummary: argsStr.trim() });
    } else if (type === 'CONFIRM_ACTION') {
      const parts = argsStr.split(':');
      const actionType = parts[0]?.toUpperCase();
      if (actionType === 'CREATE_PROJECT') {
        steps.push({ type: 'CONFIRM_ACTION', actionType: 'CREATE_PROJECT', projectName: parts[1]?.trim(), dialect: parts[2]?.trim() || 'postgresql' });
      } else if (actionType === 'INJECT_SQL') {
        let query = argsStr.substring(argsStr.indexOf(':') + 1).trim();
        if (!query || query.toLowerCase().includes('rawsqlquery') || query.startsWith('<') || query.endsWith('>') || query === '<query>') {
          const sqlBlock = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
          if (sqlBlock?.[1]?.trim()) query = sqlBlock[1].trim().replace(/;+$/, '');
        }
        if (query && !query.startsWith('<') && !query.toLowerCase().includes('rawsqlquery') && query !== '<query>') {
          steps.push({ type: 'CONFIRM_ACTION', actionType: 'INJECT_SQL', query });
        }
      }
    }
  }

  const cleanText = text.replace(/\[(?:NAVIGATE|CLICK|TYPE|CONFIRM_ACTION|EXECUTE_SQL|REQUEST_APPROVAL|CALL_MCP|GOAL_ACCOMPLISHED)[^\]]*?]/g, '').trim();
  return { steps, cleanText, approvalRequest };
};

// --- Helpers ---

const isDestructiveSql = (q: string) => /^(\s*\/\*)?(\s*DROP\s|\s*TRUNCATE\s|\s*DELETE\s+FROM\s|\s*ALTER\s+.*\s+(DROP|RENAME))/i.test(q);

// --- Component ---

export function FluxAiAssistant({ userId, isOpen, onOpenChange }: { userId: string; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { project, setProject } = useContext(ProjectContext);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      el.scrollTo({
        top: el.scrollHeight,
        behavior
      });
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const isRestored = useRef(false);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [isTyping, setIsTyping] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [selectedModel, setSelectedModel] = useState("glm");
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveWorkflow | null>(null);
  const [autoPilotActive, setAutoPilotActive] = useState(false);
  const [autoPilotGoal, setAutoPilotGoal] = useState("");
  const [triggerCheckin, setTriggerCheckin] = useState(0);
  const [panelWidth, setPanelWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);
  const [isStreamingActive, setIsStreamingActive] = useState(false);

  // --- Panel resize ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('flux_ai_panel_width');
    if (saved) { const w = parseInt(saved, 10); if (!isNaN(w) && w >= 340 && w <= 1200) setPanelWidth(w); }
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(340, Math.min(window.innerWidth - ev.clientX, Math.min(950, window.innerWidth - 20)));
      setPanelWidth(w);
      localStorage.setItem('flux_ai_panel_width', String(w));
    };
    const onUp = () => { setIsResizing(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // --- Message persistence ---

  const STORAGE_VERSION = 4;
  const storageKey = `flux_ai_messages_v${STORAGE_VERSION}_${userId}_${project?.project_id || 'none'}`;
  const prevProjectIdRef = useRef(project?.project_id);

  // Reset messages only when project *changes*, not on initial mount
  useEffect(() => {
    if (prevProjectIdRef.current === project?.project_id) return;
    prevProjectIdRef.current = project?.project_id;
    isRestored.current = false;
    setMessages([]);
    setActiveWorkflow(null);
    setAutoPilotActive(false);
    setAutoPilotGoal("");
    try { localStorage.removeItem("flux_active_workflow"); localStorage.removeItem("flux_autopilot_goal"); localStorage.removeItem("flux_autopilot_active"); localStorage.removeItem("flux_autopilot_pending_checkin"); } catch {}
  }, [project?.project_id]);

  // Bust stale data from previous component versions
  useEffect(() => {
    if (typeof window === 'undefined') return;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('flux_ai_messages_') && !k.includes(`_v${STORAGE_VERSION}_`)) localStorage.removeItem(k);
    }
    localStorage.removeItem('flux_active_workflow');
    localStorage.removeItem('flux_autopilot_active');
    localStorage.removeItem('flux_autopilot_goal');
    localStorage.removeItem('flux_autopilot_pending_checkin');
  }, []);

  // Pre-warm the /api/ai-chat route in the background so Turbopack compiles it before user sends first message
  useEffect(() => {
    fetch('/api/ai-chat', { method: 'GET' }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isRestored.current) return;
    const saved = localStorage.getItem(storageKey);
    let parsed: Message[] = [];
    if (saved) { try { parsed = JSON.parse(saved); } catch { parsed = []; } parsed = Array.isArray(parsed) ? parsed.filter((m: any) => m && typeof m.content === 'string') : []; }
    setMessages(parsed.length > 0 ? parsed : [{ role: "assistant", content: "Hi! I'm Flux AI. I can write SQL, create tables, analyze data, and navigate the app for you. What do you need?", timestamp: Date.now() }]);
    isRestored.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!isRestored.current) return;
    const sanitized = messages.slice(-MAX_MESSAGES).map(m => m.isStreaming ? { ...m, isStreaming: false } : m);
    const serialized = JSON.stringify(sanitized);
    localStorage.setItem(storageKey, serialized.length < MAX_STORAGE_BYTES ? serialized : JSON.stringify(sanitized.slice(-10)));
  }, [messages, storageKey]);

  // Dedicated Auto-Scroll: Keeps viewport pinned to the bottom on new messages, typing indicator, or streaming tokens
  useEffect(() => {
    if (!isOpen) return;
    scrollToBottom(isStreamingActive ? 'auto' : 'smooth');
  }, [messages, isTyping, isOpen, isStreamingActive, scrollToBottom]);

  // When panel opens or mounts, ensure view is scrolled to latest messages after entrance animation
  useEffect(() => {
    if (isOpen) {
      const t1 = setTimeout(() => scrollToBottom('auto'), 50);
      const t2 = setTimeout(() => scrollToBottom('auto'), 200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isOpen, scrollToBottom]);

  // --- Auto-pilot state ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAutoPilotActive(localStorage.getItem("flux_autopilot_active") === "true");
    setAutoPilotGoal(localStorage.getItem("flux_autopilot_goal") || "");
  }, []);

  const requestAutopilotCheckin = useCallback((msg?: string) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('flux_autopilot_pending_checkin', 'true');
    if (msg) localStorage.setItem('flux_autopilot_checkin_message', msg);
    else localStorage.removeItem('flux_autopilot_checkin_message');
    setTriggerCheckin(p => p + 1);
  }, []);

  const toggleAutoPilot = () => {
    const next = !autoPilotActive;
    setAutoPilotActive(next);
    if (typeof window === 'undefined') return;
    localStorage.setItem("flux_autopilot_active", next ? "true" : "false");
    if (!next) { localStorage.removeItem('flux_autopilot_goal'); localStorage.removeItem('flux_autopilot_pending_checkin'); localStorage.removeItem('flux_autopilot_checkin_message'); setAutoPilotGoal(""); }
  };

  // --- Model selection ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem("flux_ai_selected_model");
    if (saved) setSelectedModel(saved);
  }, []);

  const handleModelChange = (model: string) => { setSelectedModel(model); localStorage.setItem("flux_ai_selected_model", model); };

  // --- Voice ---

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/[*#_~`]|(\[.*?\]\(.*?\))/g, "").trim();
    if (!clean) return;
    const utt = new SpeechSynthesisUtterance(clean);
    utt.rate = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes("Google US English") || v.lang === 'en-US') || voices[0];
    if (preferred) utt.voice = preferred;
    window.speechSynthesis.speak(utt);
  }, [voiceEnabled]);

  // --- Word-by-Word Live Streaming Engine ---

  const streamingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeStreamFinalizeRef = useRef<(() => void) | null>(null);

  const finalizeActiveStream = useCallback(() => {
    if (streamingTimerRef.current) {
      clearInterval(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
    if (activeStreamFinalizeRef.current) {
      activeStreamFinalizeRef.current();
      activeStreamFinalizeRef.current = null;
    }
    setIsStreamingActive(false);
    setTimeout(() => scrollToBottom('smooth'), 40);
  }, [scrollToBottom]);

  const streamAssistantResponse = useCallback((
    fullText: string,
    options?: {
      pendingWorkflow?: { steps: WorkflowStep[] };
      approvalRequest?: ApprovalRequestData;
      sources?: string[];
      onComplete?: () => void;
    }
  ) => {
    finalizeActiveStream();

    const clean = (fullText || '').trim();
    if (!clean) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "",
        pendingWorkflow: options?.pendingWorkflow,
        approvalRequest: options?.approvalRequest,
        sources: options?.sources,
        timestamp: Date.now()
      }]);
      options?.onComplete?.();
      return;
    }

    // Split text into tokens preserving words and whitespace/line breaks
    const tokens = clean.match(/\S+|\s+/g) || [clean];

    setIsStreamingActive(true);

    // Initial empty assistant message with isStreaming: true
    setMessages(prev => [...prev, {
      role: "assistant",
      content: "",
      isStreaming: true,
      timestamp: Date.now()
    }]);

    let currentIndex = 0;
    // Word-by-word live writing cadence:
    // Short: 1 token every 20ms (~50 tokens/sec)
    // Medium: 2 tokens every 16ms
    // Long: 4 tokens every 12ms
    const chunkSize = tokens.length > 200 ? 4 : tokens.length > 60 ? 2 : 1;
    const intervalMs = tokens.length > 200 ? 12 : tokens.length > 60 ? 16 : 20;

    const finalize = () => {
      setMessages(prev => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0) return prev;
        const updated = [...prev];
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: clean,
          isStreaming: false,
          pendingWorkflow: options?.pendingWorkflow,
          approvalRequest: options?.approvalRequest,
          sources: options?.sources
        };
        return updated;
      });
      setIsStreamingActive(false);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      options?.onComplete?.();
    };

    activeStreamFinalizeRef.current = finalize;

    const timer = setInterval(() => {
      currentIndex += chunkSize;
      if (currentIndex >= tokens.length) {
        clearInterval(timer);
        streamingTimerRef.current = null;
        activeStreamFinalizeRef.current = null;
        finalize();
      } else {
        const partial = tokens.slice(0, currentIndex).join('');
        setMessages(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const updated = [...prev];
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: partial,
            isStreaming: true
          };
          return updated;
        });
        scrollToBottom('auto');
      }
    }, intervalMs);

    streamingTimerRef.current = timer;
  }, [finalizeActiveStream]);

  // --- Schema cache invalidation ---

  useEffect(() => {
    const handler = () => { fetch('/api/ai-chat', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project?.project_id }) }).catch(() => {}); };
    window.addEventListener('flux:schema-change', handler);
    return () => window.removeEventListener('flux:schema-change', handler);
  }, [project?.project_id]);

  // --- Workflow state ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('flux_active_workflow');
    if (saved) { try { setActiveWorkflow(JSON.parse(saved)); } catch { localStorage.removeItem('flux_active_workflow'); } }
  }, [pathname]);

  // --- Workflow runner ---

  const advanceWorkflow = useCallback(() => {
    if (!activeWorkflow) return;
    const nextIdx = activeWorkflow.currentStepIndex + 1;
    const updated = { ...activeWorkflow, currentStepIndex: nextIdx };
    if (nextIdx >= activeWorkflow.steps.length) {
      localStorage.removeItem('flux_active_workflow');
      setActiveWorkflow(null);
      if (typeof window !== 'undefined' && localStorage.getItem("flux_autopilot_active") === "true") requestAutopilotCheckin();
    } else {
      localStorage.setItem('flux_active_workflow', JSON.stringify(updated));
      setActiveWorkflow(updated);
    }
  }, [activeWorkflow, requestAutopilotCheckin]);

  const handleWorkflowError = useCallback((errorMessage: string) => {
    localStorage.removeItem('flux_active_workflow');
    setActiveWorkflow(null);
    if (typeof window !== 'undefined' && localStorage.getItem("flux_autopilot_active") === "true") {
      const goal = localStorage.getItem("flux_autopilot_goal") || "";
      requestAutopilotCheckin(`System: Previous action failed: "${errorMessage}". Goal: "${goal}". Self-correct and propose a fix. Do not give up.`);
      setMessages(prev => [...prev, { role: "assistant", content: `Action failed: ${errorMessage}`, timestamp: Date.now() }]);
    } else {
      if (typeof window !== 'undefined') { localStorage.removeItem('flux_autopilot_goal'); localStorage.removeItem('flux_autopilot_active'); localStorage.removeItem('flux_autopilot_pending_checkin'); setAutoPilotActive(false); setAutoPilotGoal(""); }
    }
  }, [requestAutopilotCheckin]);

  const lastNavigatedPath = useRef<string | null>(null);
  const recentNavPaths = useRef<string[]>([]);

  useEffect(() => {
    if (!activeWorkflow?.steps.length) return;
    const { steps, currentStepIndex } = activeWorkflow;
    if (currentStepIndex >= steps.length) { localStorage.removeItem('flux_active_workflow'); setActiveWorkflow(null); return; }

    const step = steps[currentStepIndex];
    let interval: NodeJS.Timeout | null = null;
    const cleanup = () => { if (interval) { clearInterval(interval); interval = null; } };

    if (step.type === 'NAVIGATE' && step.path) {
      let finalPath = step.path;
      if (project?.project_id && !finalPath.includes('projectId')) finalPath += `${finalPath.includes('?') ? '&' : '?'}projectId=${project.project_id}`;
      recentNavPaths.current.push(finalPath.replace(/\?.*$/, ""));
      if (recentNavPaths.current.length > 8) recentNavPaths.current = recentNavPaths.current.slice(-8);
      const pathCounts = recentNavPaths.current.reduce((a: Record<string,number>, p: string) => { a[p] = (a[p] || 0) + 1; return a; }, {} as Record<string,number>);
      if (Object.values(pathCounts).some(c => c >= 3)) { setMessages(prev => [...prev, { role: "assistant", content: "Auto-Pilot stopped - navigation loop detected.", timestamp: Date.now() }]); toggleAutoPilot(); setActiveWorkflow(null); localStorage.removeItem("flux_active_workflow"); return; }
      if (lastNavigatedPath.current === finalPath) { advanceWorkflow(); return; }
      const targetUrl = new URL(finalPath, window.location.origin);
      if (window.location.pathname === targetUrl.pathname) { advanceWorkflow(); return; }
      lastNavigatedPath.current = finalPath;
      const nextIdx = currentStepIndex + 1;
      if (nextIdx >= steps.length) localStorage.removeItem('flux_active_workflow');
      else localStorage.setItem('flux_active_workflow', JSON.stringify({ ...activeWorkflow, currentStepIndex: nextIdx }));
      setActiveWorkflow(null);
      router.push(finalPath);
    }
    else if (step.type === 'CLICK' && step.elementId) {
      const start = Date.now();
      interval = setInterval(() => {
        const els = Array.from(document.querySelectorAll('button, a, [role="button"], [type="submit"]')).reverse();
        const target = els.find(el => (el.textContent || '').trim().toLowerCase().includes(step.elementId!.toLowerCase())) as HTMLElement;
        if (target) { cleanup(); simulateClick(target, advanceWorkflow); }
        else if (Date.now() - start > 10000) { cleanup(); handleWorkflowError(`Element not found: ${step.elementId}`); }
      }, 200);
    }
    else if (step.type === 'TYPE' && step.value && step.locator) {
      const start = Date.now();
      interval = setInterval(() => {
        const isMonaco = /sql|query|editor/i.test(step.locator!);
        const editor = (window as any)._currentMonacoEditor;
        if (isMonaco && editor) { cleanup(); simulateTypeMonaco(editor, step.value!, advanceWorkflow); return; }
        const inputs = Array.from(document.querySelectorAll('input, textarea')) as (HTMLInputElement | HTMLTextAreaElement)[];
        const target = inputs.find(el => {
          const fields = [(el.placeholder || ''), (el.name || ''), (el.id || ''), (el.getAttribute('aria-label') || '')].map(s => s.toLowerCase().replace(/[^a-z0-9]/g, ''));
          const c = step.locator!.toLowerCase().replace(/[^a-z0-9]/g, '');
          return fields.some(f => f && (f.includes(c) || c.includes(f)));
        });
        if (target) { cleanup(); simulateTypeNative(target, step.value!, advanceWorkflow); }
        else if (Date.now() - start > 10000) { cleanup(); handleWorkflowError(`Input not found: ${step.locator}`); }
      }, 200);
    }
    else if (step.type === 'CONFIRM_ACTION') {
      if (step.actionType === 'CREATE_PROJECT' && step.projectName) {
        setMessages(prev => [...prev, { role: "assistant", content: `Creating project **${step.projectName}**...`, timestamp: Date.now() }]);
        const fd = new FormData(); fd.append('projectName', step.projectName); fd.append('dialect', step.dialect || 'postgresql'); fd.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
        createProjectAction(fd).then(result => {
          if (result.success && result.project) { setProject(result.project); setMessages(prev => [...prev.filter(m => typeof m.content === 'string' && !m.content.includes('Creating project')), { role: "assistant", content: `Created and switched to **${step.projectName}**.`, timestamp: Date.now() }]); advanceWorkflow(); }
          else handleWorkflowError(result.error || 'Unknown error');
        }).catch(err => handleWorkflowError(err.message || err));
      }
      else if (step.actionType === 'INJECT_SQL' && step.query) {
        // Navigate to /query page first, then inject SQL into the editor
        const queryPath = `/query${project?.project_id ? `?projectId=${project.project_id}` : ''}`;
        const sql = step.query;

        if (!window.location.pathname.includes('/query')) {
          // Navigate to query page, SQL will be injected after mount via localStorage + event
          try { localStorage.setItem('flux_pending_sql_inject', JSON.stringify({ query: sql, projectId: project?.project_id, timestamp: Date.now() })); } catch {}
          const nextIdx = currentStepIndex + 1;
          if (nextIdx >= steps.length) localStorage.removeItem('flux_active_workflow');
          else localStorage.setItem('flux_active_workflow', JSON.stringify({ ...activeWorkflow, currentStepIndex: nextIdx }));
          setActiveWorkflow(null);
          router.push(queryPath);
        } else {
          // Already on query page - dispatch event directly
          window.dispatchEvent(new CustomEvent('flux:inject-sql', { detail: { query: sql, projectId: project?.project_id } }));
          setMessages(prev => [...prev, { role: "assistant", content: `Query loaded into the SQL editor. Press **Ctrl+Enter** to execute.`, timestamp: Date.now() }]);
          advanceWorkflow();
        }
      }
    }

    else if (step.type === 'EXECUTE_SQL' && step.query) {
      // Run safe SQL directly, display results, and feed observation back into Auto-Pilot
      fetch('/api/ai-chat/execute-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: step.query, projectId: project?.project_id })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const { columns, rows, rowCount, truncated } = data;
          let tableMd = '';
          if (columns && columns.length > 0 && rows && rows.length > 0) {
            const header = '| ' + columns.join(' | ') + ' |';
            const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
            const bodyRows = rows.slice(0, 15).map((r: any) => '| ' + columns.map((c: string) => String(r[c] ?? 'NULL')).join(' | ') + ' |');
            tableMd = header + '\n' + sep + '\n' + bodyRows.join('\n');
          }
          const resultMsg = `**Query results** (${rowCount} row${rowCount === 1 ? '' : 's'}${truncated ? ', showing first 50' : ''}):\n\n${tableMd || 'No rows returned.'}`;
          streamAssistantResponse(resultMsg, {
            onComplete: () => {
              // Feed observation back to Auto-Pilot so agent can take next action towards goal
              if (autoPilotActive) {
                const goal = localStorage.getItem("flux_autopilot_goal") || autoPilotGoal;
                const previewSnippet = rows && rows.length > 0 ? JSON.stringify(rows.slice(0, 10)) : '0 rows';
                const obsMsg = `System: Observation from SQL execution (${rowCount} rows):\n${previewSnippet}\nWhat is the next step towards goal: "${goal}"? If the goal is fully accomplished, conclude with [GOAL_ACCOMPLISHED:<summary>].`;
                requestAutopilotCheckin(obsMsg);
              }
              advanceWorkflow();
            }
          });
        } else {
          streamAssistantResponse(`Query error: ${data.error}`, {
            onComplete: () => {
              if (autoPilotActive) {
                requestAutopilotCheckin(`System: Observation - SQL Query failed: "${data.error}". Please self-correct the query and retry.`);
              }
              advanceWorkflow();
            }
          });
        }
      })
      .catch(err => {
        setMessages(prev => [...prev, { role: 'assistant', content: `Failed to execute: ${err.message || err}`, timestamp: Date.now() }]);
        handleWorkflowError(err.message || err);
      });
    }

    else if (step.type === 'CALL_MCP' && step.mcpTool) {
      // Call Fluxbase MCP Tool Gateway
      fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name: step.mcpTool, arguments: { ...(step.mcpArgs || {}), projectId: project?.project_id } }
        })
      })
      .then(res => res.json())
      .then(data => {
        const content = data.result?.content?.[0]?.text || JSON.stringify(data.result || data.error || 'Done');
        setMessages(prev => [...prev, { role: 'assistant', content: `**MCP [${step.mcpTool}] Response:**\n\`\`\`json\n${content}\n\`\`\``, timestamp: Date.now() }]);
        if (autoPilotActive) {
          const goal = localStorage.getItem("flux_autopilot_goal") || autoPilotGoal;
          requestAutopilotCheckin(`System: Observation from MCP tool "${step.mcpTool}":\n${content.slice(0, 800)}\nNext step towards goal: "${goal}"?`);
        }
        advanceWorkflow();
      })
      .catch(err => {
        handleWorkflowError(`MCP execution error: ${err.message || err}`);
      });
    }

    else if (step.type === 'REQUEST_APPROVAL') {
      // Approval step halts workflow and waits for explicit user decision on the ApprovalCard
      // Workflow advances only when user approves or rejects
    }

    else if (step.type === 'GOAL_ACCOMPLISHED') {
      // Autonomous goal accomplished
      const summary = step.goalSummary || "Goal accomplished successfully.";
      setMessages(prev => [...prev, { role: 'assistant', content: `**Task Complete:** ${summary}`, timestamp: Date.now() }]);
      setAutoPilotActive(false);
      setAutoPilotGoal("");
      localStorage.removeItem("flux_autopilot_active");
      localStorage.removeItem("flux_autopilot_goal");
      localStorage.removeItem("flux_active_workflow");
      advanceWorkflow();
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflow, pathname, project, autoPilotActive, advanceWorkflow, handleWorkflowError]);

  const handleInjectSql = useCallback((sql: string) => {
    const queryPath = `/query${project?.project_id ? `?projectId=${project.project_id}` : ''}`;
    if (!window.location.pathname.includes('/query')) {
      try {
        localStorage.setItem('flux_pending_sql_inject', JSON.stringify({ query: sql, projectId: project?.project_id, timestamp: Date.now() }));
      } catch {}
      router.push(queryPath);
    } else {
      window.dispatchEvent(new CustomEvent('flux:inject-sql', { detail: { query: sql, projectId: project?.project_id } }));
    }
  }, [project?.project_id, router]);

  // --- DOM Simulation Helpers ---

  const simulateClick = (el: HTMLElement, onDone?: () => void) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const origShadow = el.style.boxShadow;
      const origOutline = el.style.outline;
      el.style.outline = '2px solid rgba(249, 115, 22, 0.9)';
      el.style.boxShadow = '0 0 25px 8px rgba(249, 115, 22, 0.6)';
      el.style.transition = 'all 0.25s ease';
      setTimeout(() => {
        el.click();
        setTimeout(() => {
          el.style.boxShadow = origShadow;
          el.style.outline = origOutline;
          if (onDone) onDone();
        }, 250);
      }, 300);
    }, 350);
  };

  const simulateTypeMonaco = (editor: any, value: string, onDone?: () => void) => {
    editor.updateOptions({ quickSuggestions: false, suggestOnTriggerCharacters: false });
    let i = 0;
    const tick = () => { if (i <= value.length) { editor.setValue(value.substring(0, i++)); setTimeout(tick, 25); } else { editor.updateOptions({ quickSuggestions: { other: true, comments: false, strings: true }, suggestOnTriggerCharacters: true }); onDone?.(); } };
    tick();
  };

  const simulateTypeNative = (el: HTMLInputElement | HTMLTextAreaElement, value: string, onDone?: () => void) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      const origShadow = el.style.boxShadow;
      const origOutline = el.style.outline;
      el.style.outline = '2px solid rgba(249, 115, 22, 0.9)';
      el.style.boxShadow = '0 0 25px 8px rgba(249, 115, 22, 0.6)';
      el.style.transition = 'all 0.25s ease';
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const desc = (proto as any)['value'];
      const setter = typeof desc === 'object' && desc !== null && 'set' in desc ? (desc as any).set : undefined;
      let i = 0;
      const tick = () => {
        if (el && i <= value.length) {
          if (setter) setter.call(el, value.substring(0, i)); else el.value = value.substring(0, i);
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
          i++; if (i <= value.length) setTimeout(tick, 25); else setTimeout(() => {
            el.style.boxShadow = origShadow;
            el.style.outline = origOutline;
            onDone?.();
          }, 400);
        } else { onDone?.(); }
      };
      tick();
    }, 350);
  };

  // --- Send Message ---

  const handleSend = useCallback(async (e?: React.FormEvent, overrideMsg?: string) => {
    if (e) e.preventDefault();
    finalizeActiveStream();
    const msg = overrideMsg || input.trim();
    if (!msg.trim() || isTyping) return;

    if (!overrideMsg) {
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      if (autoPilotActive && !localStorage.getItem("flux_autopilot_goal")) {
        localStorage.setItem("flux_autopilot_goal", msg);
        setAutoPilotGoal(msg);
      }
    }

    const isHidden = !!overrideMsg && msg.startsWith("System:");
    setMessages(prev => [...prev, { role: "user", content: msg, hidden: isHidden, timestamp: Date.now() }]);
    setIsTyping(true);
    setTimeout(() => scrollToBottom('smooth'), 20);

    const currentMsgs = [...messages, { role: "user" as const, content: msg, hidden: isHidden }];
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const getScreenContext = () => {
      if (typeof window === 'undefined') return undefined;
      try {
        const params = new URLSearchParams(window.location.search);
        const activeTable = params.get('tableName') || params.get('tableId') || document.querySelector('[data-current-table]')?.getAttribute('data-current-table') || undefined;
        const cols = Array.from(document.querySelectorAll('th, [role="columnheader"]')).map(el => el.textContent?.trim() || '').filter(Boolean).slice(0, 20);
        const rowCount = document.querySelector('[data-total-rows]')?.getAttribute('data-total-rows');
        const activeError = document.querySelector('[role="alert"]')?.textContent?.trim() || undefined;
        return { activeTable, visibleColumns: cols, rowCount: rowCount ? parseInt(rowCount, 10) : undefined, activeError: activeError?.slice(0, 150) };
      } catch { return undefined; }
    };

    try {
      const res = await fetch("/api/ai-chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ messages: currentMsgs, currentPath: pathname, model: selectedModel, activeProject: project ? { project_id: project.project_id, display_name: project.display_name, dialect: project.dialect, timezone: project.timezone } : null, screenContext: getScreenContext() }),
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();

      if (data.success) {
        const { steps, cleanText, approvalRequest } = parseWorkflow(data.text, project?.project_id);
        const hasOnlyNavSteps = steps.length > 0 && steps.every(s => s.type === 'NAVIGATE') && !cleanText.trim();
        if (autoPilotActive && hasOnlyNavSteps) {
          setIsTyping(false);
          setMessages(prev => [...prev, { role: "assistant", content: "Auto-Pilot stopped - AI is looping without making progress.", timestamp: Date.now() }]);
          toggleAutoPilot();
          return;
        }

        setIsTyping(false);

        streamAssistantResponse(cleanText, {
          pendingWorkflow: steps.length > 0 ? { steps } : undefined,
          approvalRequest,
          sources: data.sources,
          onComplete: () => {
            if (steps.length > 0) {
              const wf: ActiveWorkflow = { steps, currentStepIndex: 0 };
              localStorage.setItem('flux_active_workflow', JSON.stringify(wf));
              setActiveWorkflow(wf);
            }
            speak(cleanText);
          }
        });
      } else {
        setIsTyping(false);
        setMessages(prev => [...prev, { role: "assistant", content: data.error || 'Something went wrong. Try again.', timestamp: Date.now() }]);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setIsTyping(false);
      setMessages(prev => [...prev, { role: "assistant", content: 'Connection issue. Try again.', timestamp: Date.now() }]);
    }
  }, [input, isTyping, messages, pathname, selectedModel, project, autoPilotActive, speak, finalizeActiveStream, streamAssistantResponse]);

  // --- Auto-pilot checkin loop ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pending = localStorage.getItem("flux_autopilot_pending_checkin") === "true";
    const active = localStorage.getItem("flux_autopilot_active") === "true";
    const goal = localStorage.getItem("flux_autopilot_goal") || "";
    if (!pending || !active || !goal || isTyping || isStreamingActive) return;
    localStorage.removeItem('flux_autopilot_pending_checkin');

    const customMsg = localStorage.getItem('flux_autopilot_checkin_message');
    localStorage.removeItem('flux_autopilot_checkin_message');
    const msgToSend = customMsg || `System: Previous actions completed. Current page: "${window.location.pathname}". Next step for goal: "${goal}"? If achieved, say [GOAL_ACCOMPLISHED:<summary>].`;

    const timer = setTimeout(() => {
      handleSend(undefined, msgToSend);
    }, 1200);
    return () => clearTimeout(timer);
  }, [pathname, isTyping, isStreamingActive, triggerCheckin, handleSend]);

  // --- Cleanup on unmount ---

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (streamingTimerRef.current) clearInterval(streamingTimerRef.current);
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);


  // --- Render ---

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onOpenChange(false)} className="fixed inset-0 z-40 bg-black/20" />
          <motion.div
            initial={{ opacity: 0, x: 400 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 400 }}
            transition={{ duration: 0.25, type: 'spring', bounce: 0.1 }}
            style={{ width: `${panelWidth}px`, maxWidth: 'calc(100vw - 20px)' }}
            className={cn("fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-card border-l border-border shadow-2xl transition-none", isResizing && "select-none")}
          >
            <div onMouseDown={handleResizeStart} className="absolute left-0 top-0 bottom-0 w-3 -translate-x-1/2 cursor-ew-resize hover:bg-white/10 active:bg-white/20 z-50 transition-colors flex items-center justify-center group" title="Drag to resize">
              <div className="w-1 h-10 rounded-full bg-border/80 group-hover:bg-white/40 transition-colors flex items-center justify-center"><GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" /></div>
            </div>

            <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-border bg-card/95">
              <div className="flex items-center gap-2.5">
                <BorderBeam size="sm" colorVariant="ocean" borderRadius={8} className="rounded-lg">
                  <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-white/[0.12] to-white/[0.04] border border-white/[0.16] shadow-xs">
                    <FluxAiIcon size={15} />
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-2 border-card" />
                  </div>
                </BorderBeam>
                <div><p className="text-sm font-semibold text-foreground leading-none">Flux AI</p><p className="text-[10.5px] text-muted-foreground mt-0.5">Autonomous agent</p></div>
              </div>
              <div className="flex items-center gap-0.5">
                <select value={selectedModel} onChange={(e) => handleModelChange(e.target.value)} className="h-7 px-1.5 mr-1.5 rounded border border-border bg-background text-[10.5px] font-medium text-foreground/80 focus:outline-none focus:ring-1 focus:ring-border cursor-pointer max-w-[130px] truncate shadow-sm opacity-90" title="AI Model"><option value="glm">GLM 5.2</option></select>
                <button onClick={() => setVoiceEnabled(v => !v)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title={voiceEnabled ? 'Mute' : 'Unmute'}>{voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
                <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><X size={15} /></button>
              </div>
            </div>

            {autoPilotActive && autoPilotGoal && (
              <div className="mx-4 mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                <div className="flex items-center gap-2 truncate"><Zap size={13} className="animate-bounce shrink-0 fill-current text-amber-500" /><span className="truncate">Auto-Pilot: &quot;{autoPilotGoal}&quot;</span></div>
                <LiquidButton variant="destructive" size="sm" onClick={toggleAutoPilot} className="h-6 px-2.5 text-[10px] uppercase font-bold shrink-0 ml-2 cursor-pointer">Stop</LiquidButton>
              </div>
            )}

            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar">
              {messages.filter(m => !m.hidden).map((msg, idx) => (
                <motion.div key={idx} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="w-full">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end w-full pl-6">
                      <div className="max-w-[90%] rounded-xl bg-secondary/80 border border-border/80 text-foreground px-3.5 py-2.5 shadow-2xs">
                        <div className="flex items-center gap-1.5 mb-1 opacity-60 text-[10px] font-mono uppercase tracking-wider font-semibold">
                          <span>You</span>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed text-[12.5px] font-normal">{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 w-full pr-1">
                      <div className="flex items-center gap-2 px-1">
                        <div className="flex items-center justify-center w-5.5 h-5.5 rounded-md bg-white/[0.08] border border-white/[0.14] shadow-xs shrink-0">
                          <FluxAiIcon size={13} />
                        </div>
                        <span className="text-[11px] font-semibold text-foreground/80 tracking-tight">Flux AI</span>
                        {msg.isStreaming && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 animate-pulse">
                            Generating
                          </span>
                        )}
                      </div>
                      <BorderBeam
                        size="md"
                        colorVariant="ocean"
                        borderRadius={12}
                        active={Boolean(msg.isStreaming)}
                        className="w-full rounded-xl"
                      >
                        <div
                          onClick={() => { if (msg.isStreaming) finalizeActiveStream(); }}
                          className={cn(
                            "w-full rounded-xl bg-card/75 border border-border/70 text-foreground p-3.5 shadow-2xs transition-all",
                            msg.isStreaming && "cursor-pointer hover:border-primary/40"
                          )}
                          title={msg.isStreaming ? 'Click to show full response' : undefined}
                        >
                          <FluxMarkdownRenderer
                            content={msg.content}
                            onInjectSql={handleInjectSql}
                            projectId={project?.project_id}
                            isStreaming={msg.isStreaming}
                          />

                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-wrap gap-1 items-center">
                            <span className="text-[10px] text-muted-foreground/80 font-mono tracking-wider uppercase font-semibold">RAG:</span>
                            {msg.sources.map((src, si) => (
                              <span key={si} className="text-[9.5px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground border border-border/50 font-mono">
                                {src}
                              </span>
                            ))}
                          </div>
                        )}

                        {msg.approvalRequest && (
                          <FluxAiApprovalCard
                            data={msg.approvalRequest}
                            onDecision={(decision, res) => {
                              if (decision === 'approved') {
                                advanceWorkflow();
                                if (autoPilotActive) {
                                  const goal = localStorage.getItem("flux_autopilot_goal") || autoPilotGoal;
                                  requestAutopilotCheckin(`System: Observation - User approved and executed ${msg.approvalRequest?.actionType}. Result: ${res?.message || 'Done'}. Proceeding with goal: "${goal}".`);
                                }
                              } else {
                                advanceWorkflow();
                                if (autoPilotActive) {
                                  requestAutopilotCheckin(`System: Observation - User rejected this action. Do not run it. Propose an alternative or ask what to do next.`);
                                }
                              }
                            }}
                          />
                        )}

                        {msg.pendingWorkflow && (
                          <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider font-mono">Actions:</p>
                            <div className="space-y-1 pl-1">
                              {msg.pendingWorkflow.steps.map((s, si) => (
                                <div key={si} className="text-xs flex items-center gap-1.5 text-foreground/85">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                  <span className="leading-tight">
                                    {s.type === 'NAVIGATE' && `Go to ${s.path}`}
                                    {s.type === 'CLICK' && `Click "${s.elementId}"`}
                                    {s.type === 'TYPE' && `Type into "${s.locator}"`}
                                    {s.type === 'CONFIRM_ACTION' && s.actionType === 'CREATE_PROJECT' && `Create project "${s.projectName}"`}
                                    {s.type === 'CONFIRM_ACTION' && s.actionType === 'INJECT_SQL' && (
                                      <span className={isDestructiveSql(s.query || '') ? 'text-red-400' : ''}>
                                        {isDestructiveSql(s.query || '') ? '⚠ ' : ''}Load into editor: {(s.query || '').slice(0, 50)}{(s.query || '').length > 50 ? '...' : ''}
                                      </span>
                                    )}
                                    {s.type === 'EXECUTE_SQL' && (
                                      <span className="text-emerald-400 font-mono text-[11.5px]">▸ {(s.query || '').slice(0, 55)}{(s.query || '').length > 55 ? '...' : ''}</span>
                                    )}
                                    {s.type === 'REQUEST_APPROVAL' && (
                                      <span className="text-amber-400">⚠ Review: {s.approvalData?.summary?.slice(0, 45)}</span>
                                    )}
                                    {s.type === 'CALL_MCP' && (
                                      <span className="text-cyan-400 font-mono text-[11.5px]">⚡ MCP: {s.mcpTool}</span>
                                    )}
                                    {s.type === 'GOAL_ACCOMPLISHED' && (
                                      <span className="text-emerald-400 font-semibold">✓ Goal Accomplished</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>
                      </BorderBeam>
                    </div>
                  )}
                </motion.div>
              ))}
              {isTyping && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-center w-5.5 h-5.5 rounded-md bg-white/[0.08] border border-white/[0.14] shadow-xs shrink-0">
                    <FluxAiIcon size={13} />
                  </div>
                  <BorderBeam size="sm" colorVariant="ocean" borderRadius={8} className="rounded-lg">
                    <div className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-secondary/60 border border-border/50">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/90 animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/90 animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400/90 animate-pulse" style={{ animationDelay: '300ms' }} />
                      <span className="text-[10.5px] font-mono text-muted-foreground ml-1">Thinking...</span>
                    </div>
                  </BorderBeam>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 px-3 pt-2.5 pb-3 border-t border-border/80 bg-card/95">
              {/* Quick suggestion prompt chips when conversation is fresh */}
              {messages.filter(m => !m.hidden).length <= 2 && (
                <div className="mb-2 flex flex-wrap gap-1.5 px-0.5">
                  {[
                    { label: "✨ Explain Schema", prompt: "Explain the database schema and table relationships in this project." },
                    { label: "⚡ Analyze Performance", prompt: "What queries or indexes could improve performance in this database?" },
                    { label: "🔍 Show Tables", prompt: "List all user tables in this database with their row counts." }
                  ].map((chip) => (
                    <LiquidButton
                      key={chip.label}
                      type="button"
                      size="sm"
                      onClick={() => handleSend(undefined, chip.prompt)}
                      className="h-7 text-[10.5px] font-medium px-3 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {chip.label}
                    </LiquidButton>
                  ))}
                </div>
              )}

              {/* Modern expanding prompt card */}
              <div className="relative rounded-2xl border border-border/90 bg-background/95 shadow-sm transition-all focus-within:border-white/30 focus-within:ring-2 focus-within:ring-white/10 overflow-hidden">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Flux AI, request SQL execution, or enter a prompt..."
                  rows={1}
                  className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-xs sm:text-[13px] text-foreground placeholder:text-muted-foreground/45 focus:outline-none leading-relaxed max-h-[140px] custom-scrollbar block"
                  disabled={isTyping}
                  autoFocus
                />

                {/* Bottom Toolbar */}
                <div className="flex items-center justify-between px-3 pb-2.5 pt-1 gap-2">
                  <div className="flex items-center gap-2">
                    <LiquidButton
                      type="button"
                      onClick={toggleAutoPilot}
                      size="sm"
                      className={cn(
                        "h-7 px-3 text-[11px] font-medium transition-all select-none cursor-pointer",
                        autoPilotActive
                          ? "text-amber-400 font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Toggle Autonomous Goal Execution"
                    >
                      <Zap className={cn("size-3.5 shrink-0", autoPilotActive && "animate-pulse fill-current text-amber-500")} />
                      <span className="whitespace-nowrap">Auto-Pilot</span>
                    </LiquidButton>

                    <span className="text-[10px] text-muted-foreground/40 font-mono hidden sm:inline select-none">
                      Shift+↵ newline
                    </span>
                  </div>

                  <LiquidButton
                    type="button"
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isTyping}
                    size="icon"
                    className={cn(
                      "h-8 w-8 rounded-xl transition-all shadow-xs cursor-pointer",
                      input.trim()
                        ? "text-white opacity-100 hover:scale-105 active:scale-95"
                        : "opacity-40 cursor-not-allowed text-muted-foreground"
                    )}
                    title="Send message (Enter)"
                  >
                    <ArrowUp size={14} strokeWidth={2.5} />
                  </LiquidButton>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
