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
import { AgenticThinkBlock } from "@/components/ai/agentic-think-block";
import { InChatChart } from "@/components/ai/in-chat-chart";

// --- Types ---

type Message = {
  role: "user" | "assistant";
  content: string;
  thought?: string;
  isThinking?: boolean;
  thoughtDuration?: number;
  chart?: any;
  pendingWorkflow?: { steps: WorkflowStep[] };
  approvalRequest?: ApprovalRequestData;
  sources?: string[];
  hidden?: boolean;
  timestamp?: number;
  isStreaming?: boolean;
  taskLabel?: string;
};

export function getTaskLabel(prompt?: string): string {
  if (!prompt) return "Thinking...";
  const p = prompt.toLowerCase().trim();

  // SQL Generation
  if (/generate (?:sql|query)|draft (?:sql|query)|write (?:sql|query)|create table|alter table|insert into|select /i.test(p)) {
    return "Generating SQL...";
  }
  // Schema analysis
  if (/analyz|schema|relationships|foreign key|inspect|structure|database model/i.test(p)) {
    return "Analyzing schema...";
  }
  // Error fixing / diagnosis
  // Auto-Pilot system events
  if (/^system:\s*observation/i.test(p)) {
    if (/failed|error|violat/i.test(p)) return "Auto-fixing query...";
    return "Executing next action...";
  }
  if (/^system:\s*auto-pilot/i.test(p)) {
    if (/sql failed|error|violat/i.test(p)) return "Diagnosing error...";
    return "Continuing auto-pilot...";
  }
  // Schema inspection & drawing
  if (/schema|ddl|structure|columns|types|foreign key|constraint|relationship|erd|draw schema|show schema/i.test(p)) {
    return "Analyzing schema...";
  }
  // Error diagnostic / Auto-fixing
  if (/fix|repair|error|fail|violat|exception|debug|issue|broke/i.test(p)) {
    return "Diagnosing error...";
  }
  // Summary & Architecture
  if (/summary|summarize|overview|architecture|data flow|how does/i.test(p)) {
    return "Synthesizing overview...";
  }
  // Row counts / table inspection
  if (/row count|how many rows|list tables|show tables|tables/i.test(p)) {
    return "Querying tables...";
  }
  // Performance / Optimization
  if (/perf|slow|speed|optimi|index|explain|latency|cache/i.test(p)) {
    return "Analyzing performance...";
  }
  // Mock / Bulk Data Generation
  if (/mock|seed|populate|dummy|generate \d+|insert \d+/i.test(p)) {
    return "Generating data...";
  }
  // Charts & Visualizations
  if (/chart|graph|plot|visualiz|trend|breakdown|pie|bar/i.test(p)) {
    return "Synthesizing chart...";
  }
  // General Query Execution
  if (/run|execute|select|query|fetch/i.test(p)) {
    return "Executing query...";
  }
  // Navigation
  if (/navigate|go to|open page|view/i.test(p)) {
    return "Navigating...";
  }

  return "Thinking...";
}

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

const isValidSql = (q: string): boolean => {
  if (!q) return false;
  const cleaned = q
    .replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))+/g, '')
    .trim();
  return /^(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE|ALTER|DROP|TRUNCATE|WITH|EXPLAIN|SHOW|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|SET)\b/i.test(cleaned);
};

// --- Workflow Parser ---

const parseWorkflow = (text: string, currentProjectId?: string): { steps: WorkflowStep[]; cleanText: string; approvalRequest?: ApprovalRequestData; chart?: any; thought?: string } => {
  const steps: WorkflowStep[] = [];
  let approvalRequest: ApprovalRequestData | undefined = undefined;
  let chart: any = undefined;
  let thought: string | undefined = undefined;

  let workingText = text;
  const thinkMatch = workingText.match(/<think>([\s\S]*?)<\/think>/i) || workingText.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thinkMatch) {
    thought = thinkMatch[1].trim();
    workingText = workingText.replace(thinkMatch[0], '').trim();
  }

  const codeBlockRanges: [number, number][] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(workingText)) !== null) {
    codeBlockRanges.push([cbMatch.index, cbMatch.index + cbMatch[0].length]);
  }

  const tagRegex = /\[(NAVIGATE|CLICK|TYPE|CONFIRM_ACTION|EXECUTE_SQL|REQUEST_APPROVAL|CALL_MCP|GOAL_ACCOMPLISHED|RENDER_CHART)(?::([^\]]*?))?\]/g;
  let match;
  while ((match = tagRegex.exec(workingText)) !== null) {
    const inCode = codeBlockRanges.some(([start, end]) => match!.index >= start && match!.index < end);
    if (inCode) continue;

    const type = match[1].toUpperCase();
    const argsStr = match[2] || '';

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
        const sqlBlock = workingText.match(/```(?:sql|pgsql)\s*([\s\S]*?)```/i);
        if (sqlBlock?.[1]?.trim()) query = sqlBlock[1].trim().replace(/;+$/, '');
      }
      if (query && !query.startsWith('<') && !query.toLowerCase().includes('rawsqlquery') && query !== '<query>' && isValidSql(query)) {
        steps.push({ type: 'EXECUTE_SQL', query });
      }
    } else if (type === 'RENDER_CHART') {
      try {
        chart = JSON.parse(argsStr.trim());
      } catch {}
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
          const sqlBlock = workingText.match(/```(?:sql|pgsql)\s*([\s\S]*?)```/i);
          if (sqlBlock?.[1]?.trim()) query = sqlBlock[1].trim().replace(/;+$/, '');
        }
        if (query && !query.startsWith('<') && !query.toLowerCase().includes('rawsqlquery') && query !== '<query>' && isValidSql(query)) {
          steps.push({ type: 'CONFIRM_ACTION', actionType: 'INJECT_SQL', query });
        }
      }
    }
  }

  // Fallback: ONLY when in AutoPilot mode (never in normal conversational chat)
  if (steps.length === 0 && !approvalRequest) {
    const isAutoPilot = typeof window !== 'undefined' && localStorage.getItem('flux_autopilot_active') === 'true';
    if (isAutoPilot) {
      const hasExecuteIntent = /\b(will now execute|executing|execute (?:this|the|corrected)|running (?:this|the)|run (?:this|the)|corrected (?:sql|query|insert|update|statement)|action tag|here is the (?:fixed|corrected)|here is the query|ACTIONS:)/i.test(workingText);
      const sqlBlock = workingText.match(/```(?:sql|pgsql)\s*([\s\S]*?)```/i);
      if (hasExecuteIntent && sqlBlock?.[1]?.trim()) {
        const extractedQuery = sqlBlock[1].trim().replace(/;+$/, '');
        if (extractedQuery && !extractedQuery.toLowerCase().includes('rawsqlquery') && isValidSql(extractedQuery)) {
          steps.push({ type: 'EXECUTE_SQL', query: extractedQuery });
        }
      } else {
        // Check for raw SQL query line after ACTIONS: or Action Tag:
        const actionMatch = workingText.match(/(?:ACTIONS:|Action Tag:?)\s*(?:[•\-*]|\>)?\s*(INSERT\s+INTO|SELECT|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b([\s\S]+?)(?:(?:\n\s*\n)|$)/i);
        if (actionMatch) {
          const extracted = (actionMatch[1] + actionMatch[2]).trim().replace(/;+$/, '');
          if (extracted && extracted.length > 10 && !extracted.toLowerCase().includes('rawsqlquery') && isValidSql(extracted)) {
            steps.push({ type: 'EXECUTE_SQL', query: extracted });
          }
        }
      }
    }

    // Trailing unbracketed or unclosed [EXECUTE_SQL:...
    if (steps.length === 0) {
      const trailingSqlMatch = workingText.match(/\[EXECUTE_SQL:\s*([\s\S]+?)(?:\]|$)/i);
      if (trailingSqlMatch?.[1]?.trim()) {
        const q = trailingSqlMatch[1].trim().replace(/;+$/, '');
        if (q && !q.toLowerCase().includes('rawsqlquery') && isValidSql(q)) {
          steps.push({ type: 'EXECUTE_SQL', query: q });
        }
      }
    }
  }

  const cleanText = workingText.replace(/\[(?:NAVIGATE|CLICK|TYPE|CONFIRM_ACTION|EXECUTE_SQL|REQUEST_APPROVAL|CALL_MCP|GOAL_ACCOMPLISHED|RENDER_CHART)[^\]]*?(?:\]|$)/g, '').trim();
  return { steps, cleanText, approvalRequest, chart, thought };
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
  const autoPilotTurnsRef = useRef(0);

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
  const [selectedModel, setSelectedModel] = useState("flux-fast");
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
    autoPilotTurnsRef.current = 0;
    if (typeof window === 'undefined') return;
    localStorage.setItem("flux_autopilot_active", next ? "true" : "false");
    if (!next) {
      abortRef.current?.abort();
      setIsTyping(false);
      setIsStreamingActive(false);
      setActiveWorkflow(null);
      localStorage.removeItem('flux_autopilot_goal');
      localStorage.removeItem('flux_autopilot_pending_checkin');
      localStorage.removeItem('flux_autopilot_checkin_message');
      localStorage.removeItem('flux_active_workflow');
      setAutoPilotGoal("");
    }
  };

  // --- Model selection ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem("flux_ai_selected_model");
    if (saved) {
      if (saved === 'glm' || saved === 'glm-4-flash' || saved === 'flux') setSelectedModel('flux-fast');
      else if (saved === 'glm-4-air') setSelectedModel('flux-pro');
      else if (saved === 'glm-4-plus' || saved === 'glm-5.2') setSelectedModel('flux-ultra');
      else if (saved === 'groq' || saved === 'groq-llama') setSelectedModel('flux-turbo');
      else if (saved === 'gemini' || saved === 'gemini-2.0-flash' || saved === 'gemini-1.5-flash') setSelectedModel('flux-omni');
      else setSelectedModel(saved);
    }
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
      thought?: string;
      chart?: any;
      pendingWorkflow?: { steps: WorkflowStep[] };
      approvalRequest?: ApprovalRequestData;
      sources?: string[];
      taskLabel?: string;
      onComplete?: () => void;
    }
  ) => {
    finalizeActiveStream();

    const clean = (fullText || '').trim();
    if (!clean) {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant' && !last.content) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: "",
            isThinking: false,
            isStreaming: false,
            pendingWorkflow: options?.pendingWorkflow,
            approvalRequest: options?.approvalRequest,
            sources: options?.sources,
            taskLabel: options?.taskLabel || last.taskLabel
          };
          return updated;
        }
        return [...prev, {
          role: "assistant",
          content: "",
          isThinking: false,
          isStreaming: false,
          pendingWorkflow: options?.pendingWorkflow,
          approvalRequest: options?.approvalRequest,
          sources: options?.sources,
          taskLabel: options?.taskLabel,
          timestamp: Date.now()
        }];
      });
      options?.onComplete?.();
      return;
    }

    // Split text into tokens preserving words, whitespace, and punctuation
    const tokens = clean.match(/\S+|\s+/g) || [clean];

    setIsStreamingActive(true);

    // Ensure the last assistant placeholder is ready
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && !last.content) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          isStreaming: true,
          isThinking: false,
          taskLabel: options?.taskLabel || last.taskLabel
        };
        return updated;
      }
      return [...prev, {
        role: "assistant",
        content: "",
        isStreaming: true,
        isThinking: false,
        taskLabel: options?.taskLabel,
        timestamp: Date.now()
      }];
    });

    let currentIndex = 0;

    const finalize = () => {
      if (streamingTimerRef.current) {
        clearTimeout(streamingTimerRef.current);
        streamingTimerRef.current = null;
      }
      activeStreamFinalizeRef.current = null;
      setMessages(prev => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0) return prev;
        const updated = [...prev];
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: clean,
          thought: (options as any)?.thought,
          chart: (options as any)?.chart,
          isStreaming: false,
          isThinking: false,
          pendingWorkflow: options?.pendingWorkflow,
          approvalRequest: options?.approvalRequest,
          sources: options?.sources,
          taskLabel: options?.taskLabel || updated[lastIdx].taskLabel
        };
        return updated;
      });
      setIsStreamingActive(false);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      options?.onComplete?.();
    };

    activeStreamFinalizeRef.current = finalize;

    const streamNextBurst = () => {
      if (currentIndex >= tokens.length) {
        finalize();
        return;
      }

      // Dynamic burst generation:
      // Randomly output 3 to 9 words per burst, and grab whole sentences if boundary (. ? ! \n ;) is nearby
      let burstSize = Math.floor(Math.random() * 7) + 3;

      const lookaheadMax = Math.min(tokens.length, currentIndex + 22);
      for (let i = currentIndex + 2; i < lookaheadMax; i++) {
        const t = tokens[i];
        if (/[.!?;\n]/.test(t)) {
          burstSize = (i - currentIndex) + 1;
          break;
        }
      }

      currentIndex = Math.min(tokens.length, currentIndex + burstSize);
      const partial = tokens.slice(0, currentIndex).join('');

      setMessages(prev => {
        const lastIdx = prev.length - 1;
        if (lastIdx < 0) return prev;
        const updated = [...prev];
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: partial,
          isStreaming: true,
          isThinking: false
        };
        return updated;
      });
      scrollToBottom('auto');

      if (currentIndex < tokens.length) {
        const delayMs = Math.floor(Math.random() * 16) + 16;
        streamingTimerRef.current = setTimeout(streamNextBurst, delayMs);
      } else {
        finalize();
      }
    };

    streamNextBurst();
  }, [finalizeActiveStream, scrollToBottom]);

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
          const { columns, rows, rowCount, rowsAffected, message, truncated } = data;
          let tableMd = '';
          if (columns && columns.length > 0 && rows && rows.length > 0) {
            const header = '| ' + columns.join(' | ') + ' |';
            const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
            const bodyRows = rows.slice(0, 15).map((r: any) => '| ' + columns.map((c: string) => String(r[c] ?? 'NULL')).join(' | ') + ' |');
            tableMd = header + '\n' + sep + '\n' + bodyRows.join('\n');
          }

          let summaryMsg = '';
          if (rowsAffected !== undefined && rowsAffected > 0) {
            summaryMsg = `**Query executed successfully:** ${rowsAffected.toLocaleString()} row${rowsAffected === 1 ? '' : 's'} affected.`;
          } else if (rowCount !== undefined && rowCount > 0) {
            summaryMsg = `**Query returned ${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'}**${truncated ? ' (showing first 50)' : ''}:`;
          } else if (message) {
            summaryMsg = `**${message}**`;
          } else {
            summaryMsg = `**Query executed successfully.**`;
          }

          const resultMsg = `${summaryMsg}${tableMd ? '\n\n' + tableMd : ''}`;

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('flux:schema-change'));
            window.dispatchEvent(new CustomEvent('flux:table-data-updated'));
          }
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
                let diagnosticHint = '';
                const errStr = data.error || '';
                const fkMatch = errStr.match(/violates foreign key constraint ["']?([^"'\s]+)["']?/i) || errStr.match(/foreign key constraint/i);
                if (fkMatch) {
                  diagnosticHint = `\n[ROOT CAUSE]: Foreign Key violation (${fkMatch[1] || 'constraint'}). The referenced foreign ID does not exist in the parent table.\n[AUTOPILOT AUTO-FIX MANDATE]: DO NOT ask the user or dump schemas. Autonomously fix the query NOW: either set the foreign key column to NULL (e.g., col = NULL), OR use a subquery like (SELECT id FROM <parent_table> LIMIT 1), OR insert the parent record first. Emit [EXECUTE_SQL:<corrected_query>] immediately.`;
                } else if (/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i.test(errStr)) {
                  const colMatch = errStr.match(/column ["']?([^"'\s]+)["']?/i);
                  diagnosticHint = `\n[ROOT CAUSE]: Column "${colMatch?.[1] || 'unknown'}" does not exist in the table.\n[AUTOPILOT AUTO-FIX MANDATE]: Remove the hallucinated column or rename it to match the live schema. Emit [EXECUTE_SQL:<corrected_query>] immediately.`;
                } else if (/null value in column ["']?([^"'\s]+)["']? .*violates not-null constraint/i.test(errStr)) {
                  const colMatch = errStr.match(/column ["']?([^"'\s]+)["']?/i);
                  diagnosticHint = `\n[ROOT CAUSE]: Column "${colMatch?.[1] || 'unknown'}" violates NOT NULL constraint.\n[AUTOPILOT AUTO-FIX MANDATE]: Provide a valid default value for the column. Emit [EXECUTE_SQL:<corrected_query>] immediately.`;
                } else if (/duplicate key value violates unique constraint/i.test(errStr)) {
                  diagnosticHint = `\n[ROOT CAUSE]: Unique constraint violation on primary or unique key.\n[AUTOPILOT AUTO-FIX MANDATE]: Use ON CONFLICT DO NOTHING / UPDATE or a new distinct key. Emit [EXECUTE_SQL:<corrected_query>] immediately.`;
                } else {
                  diagnosticHint = `\n[AUTOPILOT AUTO-FIX MANDATE]: Autonomously diagnose root cause, fix the SQL query, and emit [EXECUTE_SQL:<corrected_query>] immediately. DO NOT ask the user to fix it.`;
                }
                requestAutopilotCheckin(`System: Observation - SQL Query failed: "${data.error}".${diagnosticHint}`);
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
      autoPilotTurnsRef.current = 0;
      if (typeof window !== 'undefined') {
        localStorage.removeItem("flux_autopilot_active");
        localStorage.removeItem("flux_autopilot_goal");
        localStorage.removeItem("flux_autopilot_pending_checkin");
        localStorage.removeItem("flux_autopilot_checkin_message");
        localStorage.removeItem("flux_active_workflow");
      }
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
        autoPilotTurnsRef.current = 0;
      }
    }

    const isHidden = !!overrideMsg && msg.startsWith("System:");
    const taskLabel = getTaskLabel(msg);
    setMessages(prev => [
      ...prev,
      { role: "user", content: msg, hidden: isHidden, timestamp: Date.now() },
      {
        role: "assistant",
        content: "",
        thought: "",
        isThinking: true,
        isStreaming: true,
        taskLabel,
        timestamp: Date.now()
      }
    ]);
    setIsTyping(true);
    setIsStreamingActive(true);
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

        let lastSqlError: { query: string; error: string } | undefined = undefined;
        const lastErrRaw = localStorage.getItem('flux_last_sql_error');
        if (lastErrRaw) {
          try {
            const parsed = JSON.parse(lastErrRaw);
            if (Date.now() - (parsed.timestamp || 0) < 600000 && parsed.error) {
              lastSqlError = { query: parsed.query, error: parsed.error };
            }
          } catch {}
        }

        return {
          activeTable,
          visibleColumns: cols,
          rowCount: rowCount ? parseInt(rowCount, 10) : undefined,
          activeError: activeError?.slice(0, 300),
          lastSqlError
        };
      } catch { return undefined; }
    };

    try {
      const startTime = Date.now();
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: currentMsgs,
          currentPath: pathname,
          model: selectedModel,
          stream: true,
          activeProject: project ? { project_id: project.project_id, display_name: project.display_name, dialect: project.dialect, timezone: project.timezone } : null,
          screenContext: getScreenContext()
        }),
      });

      if (!res.ok) {
        setAutoPilotActive(false);
        setAutoPilotGoal("");
        autoPilotTurnsRef.current = 0;
        if (typeof window !== 'undefined') {
          localStorage.removeItem('flux_autopilot_active');
          localStorage.removeItem('flux_autopilot_goal');
          localStorage.removeItem('flux_autopilot_pending_checkin');
          localStorage.removeItem('flux_autopilot_checkin_message');
          localStorage.removeItem('flux_active_workflow');
        }
        throw new Error('Request failed with status ' + res.status);
      }

      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream') && res.body) {
        // SSE Real-time Streaming Mode
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';
        let accumulatedText = '';
        let accumulatedThought = '';
        let streamSources: string[] = [];

        setIsTyping(false);
        setIsStreamingActive(true);

        // Ensure assistant message placeholder is ready
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return prev;
          }
          return [...prev, {
            role: "assistant",
            content: "",
            thought: "",
            isThinking: true,
            isStreaming: true,
            taskLabel,
            timestamp: Date.now()
          }];
        });

        let streamAborted = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamBuffer += decoder.decode(value, { stream: true });
            const lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;
              const jsonStr = trimmed.slice(6);
              if (jsonStr === '[DONE]') continue;
              try {
                const event = JSON.parse(jsonStr);
                if (event.type === 'thought') {
                  accumulatedThought += event.token;
                  setMessages(prev => {
                    const lastIdx = prev.length - 1;
                    if (lastIdx < 0) return prev;
                    const updated = [...prev];
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      thought: accumulatedThought,
                      isThinking: true
                    };
                    return updated;
                  });
                } else if (event.type === 'text') {
                  accumulatedText += event.token;
                  setMessages(prev => {
                    const lastIdx = prev.length - 1;
                    if (lastIdx < 0) return prev;
                    const updated = [...prev];
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: accumulatedText,
                      isThinking: false
                    };
                    return updated;
                  });
                  scrollToBottom('auto');
                } else if (event.type === 'sources') {
                  streamSources = event.sources || [];
                } else if (event.type === 'done') {
                  if (event.fullText) accumulatedText = event.fullText;
                  if (event.thought) accumulatedThought = event.thought;
                }
              } catch {}
            }
          }
        } catch (streamErr: any) {
          if (streamErr.name === 'AbortError') return;
          console.warn('[Flux AI] SSE stream read disconnected/interrupted:', streamErr);
          streamAborted = true;
        }

        const duration = Date.now() - startTime;

        // If the stream was interrupted and zero content was accumulated, then show connection issue
        if (streamAborted && !accumulatedText.trim() && !accumulatedThought.trim()) {
          setIsStreamingActive(false);
          setMessages(prev => {
            const lastIdx = prev.length - 1;
            if (lastIdx < 0) return prev;
            const updated = [...prev];
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: 'Connection issue. Try again.',
              isThinking: false,
              isStreaming: false
            };
            return updated;
          });
          return;
        }

        const { steps, cleanText, approvalRequest, chart } = parseWorkflow(accumulatedText, project?.project_id);

        setMessages(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const updated = [...prev];
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: cleanText || (accumulatedThought ? 'Done.' : ''),
            thought: accumulatedThought || undefined,
            isThinking: false,
            thoughtDuration: duration,
            chart,
            pendingWorkflow: steps.length > 0 ? { steps } : undefined,
            approvalRequest,
            sources: streamSources,
            isStreaming: false
          };
          return updated;
        });

        setIsStreamingActive(false);

        const handleAutoPilotStepCompletion = (fullText: string, cleaned: string) => {
          if (typeof window === 'undefined' || localStorage.getItem('flux_autopilot_active') !== 'true') return;
          const goal = localStorage.getItem('flux_autopilot_goal') || autoPilotGoal;
          if (!goal) return;

          const isAccomplished = /\[GOAL_ACCOMPLISHED/i.test(fullText);
          if (isAccomplished) {
            const summaryMatch = fullText.match(/\[GOAL_ACCOMPLISHED(?::\s*([^\]]*))?\]/i);
            const summary = summaryMatch?.[1]?.trim() || "Goal accomplished successfully.";
            setMessages(prev => [...prev, { role: 'assistant', content: `**Task Complete:** ${summary}`, timestamp: Date.now() }]);
            setAutoPilotActive(false);
            setAutoPilotGoal("");
            autoPilotTurnsRef.current = 0;
            localStorage.removeItem("flux_autopilot_active");
            localStorage.removeItem("flux_autopilot_goal");
            localStorage.removeItem("flux_autopilot_pending_checkin");
            localStorage.removeItem("flux_autopilot_checkin_message");
            localStorage.removeItem("flux_active_workflow");
            return;
          }

          // Check if goal was informational, explanatory, architectural, or summary
          const isInformationalGoal = /^(summary|summarize|schema|draw|diagram|erd|overview|explain|how|what|show|list|help|info|describe|architecture|can you)/i.test(goal.trim());
          const hasSubstantialAnswer = Boolean(cleaned && cleaned.length > 90);
          const reachedTurnLimit = autoPilotTurnsRef.current >= 4;

          if (isInformationalGoal || hasSubstantialAnswer || reachedTurnLimit) {
            const summarySnippet = cleaned.slice(0, 100).replace(/[\r\n]+/g, ' ').trim() || `Goal "${goal}" accomplished.`;
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `**Auto-Pilot Task Complete:** ${summarySnippet}`,
              timestamp: Date.now()
            }]);
            setAutoPilotActive(false);
            setAutoPilotGoal("");
            autoPilotTurnsRef.current = 0;
            localStorage.removeItem("flux_autopilot_active");
            localStorage.removeItem("flux_autopilot_goal");
            localStorage.removeItem("flux_autopilot_pending_checkin");
            localStorage.removeItem("flux_autopilot_checkin_message");
            localStorage.removeItem("flux_active_workflow");
          } else {
            autoPilotTurnsRef.current += 1;
            requestAutopilotCheckin(`System: Auto-Pilot is active for goal: "${goal}". If all tasks are completed, conclude with [GOAL_ACCOMPLISHED:<summary>]. Otherwise proceed with the next concrete step.`);
          }
        };

        if (steps.length > 0) {
          const wf: ActiveWorkflow = { steps, currentStepIndex: 0 };
          localStorage.setItem('flux_active_workflow', JSON.stringify(wf));
          setActiveWorkflow(wf);
        } else if (typeof window !== 'undefined' && localStorage.getItem('flux_autopilot_active') === 'true' && !approvalRequest) {
          handleAutoPilotStepCompletion(accumulatedText, cleanText);
        }
        speak(cleanText);

      } else {
        // Fallback: Non-Streaming JSON Response
        const data = await res.json();
        if (data.success) {
          const { steps, cleanText, approvalRequest, chart, thought } = parseWorkflow(data.text, project?.project_id);
          setIsTyping(false);
          streamAssistantResponse(cleanText, {
            thought: data.thought || thought,
            chart,
            pendingWorkflow: steps.length > 0 ? { steps } : undefined,
            approvalRequest,
            sources: data.sources,
            onComplete: () => {
              const handleAutoPilotStepCompletion = (fullText: string, cleaned: string) => {
                if (typeof window === 'undefined' || localStorage.getItem('flux_autopilot_active') !== 'true') return;
                const goal = localStorage.getItem('flux_autopilot_goal') || autoPilotGoal;
                if (!goal) return;

                const isAccomplished = /\[GOAL_ACCOMPLISHED/i.test(fullText);
                if (isAccomplished) {
                  const summaryMatch = fullText.match(/\[GOAL_ACCOMPLISHED(?::\s*([^\]]*))?\]/i);
                  const summary = summaryMatch?.[1]?.trim() || "Goal accomplished successfully.";
                  setMessages(prev => [...prev, { role: 'assistant', content: `**Task Complete:** ${summary}`, timestamp: Date.now() }]);
                  setAutoPilotActive(false);
                  setAutoPilotGoal("");
                  autoPilotTurnsRef.current = 0;
                  localStorage.removeItem("flux_autopilot_active");
                  localStorage.removeItem("flux_autopilot_goal");
                  localStorage.removeItem("flux_autopilot_pending_checkin");
                  localStorage.removeItem("flux_autopilot_checkin_message");
                  localStorage.removeItem("flux_active_workflow");
                  return;
                }

                const isInformationalGoal = /^(summary|summarize|schema|draw|diagram|erd|overview|explain|how|what|show|list|help|info|describe|architecture|can you)/i.test(goal.trim());
                const hasSubstantialAnswer = Boolean(cleaned && cleaned.length > 90);
                const reachedTurnLimit = autoPilotTurnsRef.current >= 4;

                if (isInformationalGoal || hasSubstantialAnswer || reachedTurnLimit) {
                  const summarySnippet = cleaned.slice(0, 100).replace(/[\r\n]+/g, ' ').trim() || `Goal "${goal}" accomplished.`;
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `**Auto-Pilot Task Complete:** ${summarySnippet}`,
                    timestamp: Date.now()
                  }]);
                  setAutoPilotActive(false);
                  setAutoPilotGoal("");
                  autoPilotTurnsRef.current = 0;
                  localStorage.removeItem("flux_autopilot_active");
                  localStorage.removeItem("flux_autopilot_goal");
                  localStorage.removeItem("flux_autopilot_pending_checkin");
                  localStorage.removeItem("flux_autopilot_checkin_message");
                  localStorage.removeItem("flux_active_workflow");
                } else {
                  autoPilotTurnsRef.current += 1;
                  requestAutopilotCheckin(`System: Auto-Pilot is active for goal: "${goal}". If all tasks are completed, conclude with [GOAL_ACCOMPLISHED:<summary>]. Otherwise proceed with the next concrete step.`);
                }
              };

              if (steps.length > 0) {
                const wf: ActiveWorkflow = { steps, currentStepIndex: 0 };
                localStorage.setItem('flux_active_workflow', JSON.stringify(wf));
                setActiveWorkflow(wf);
              } else if (typeof window !== 'undefined' && localStorage.getItem('flux_autopilot_active') === 'true' && !approvalRequest) {
                handleAutoPilotStepCompletion(data.text, cleanText);
              }
              speak(cleanText);
            }
          });
        } else {
          setIsTyping(false);
          setAutoPilotActive(false);
          setAutoPilotGoal("");
          autoPilotTurnsRef.current = 0;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('flux_autopilot_active');
            localStorage.removeItem('flux_autopilot_goal');
            localStorage.removeItem('flux_autopilot_pending_checkin');
            localStorage.removeItem('flux_autopilot_checkin_message');
            localStorage.removeItem('flux_active_workflow');
          }
          setMessages(prev => [...prev, { role: "assistant", content: data.error || 'Something went wrong. Try again.', timestamp: Date.now() }]);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setIsTyping(false);
      setIsStreamingActive(false);
      setAutoPilotActive(false);
      setAutoPilotGoal("");
      autoPilotTurnsRef.current = 0;
      if (typeof window !== 'undefined') {
        localStorage.removeItem('flux_autopilot_active');
        localStorage.removeItem('flux_autopilot_goal');
        localStorage.removeItem('flux_autopilot_pending_checkin');
        localStorage.removeItem('flux_autopilot_checkin_message');
        localStorage.removeItem('flux_active_workflow');
      }
      setMessages(prev => [...prev, { role: "assistant", content: 'Connection issue. Try again.', timestamp: Date.now() }]);
    }
  }, [input, isTyping, messages, pathname, selectedModel, project, autoPilotActive, speak, finalizeActiveStream, streamAssistantResponse]);

  // Listen for global flux:open-ai event to prefill prompt and open Flux AI
  useEffect(() => {
    const handleOpenAi = (e: any) => {
      onOpenChange(true);
      const prompt = e.detail?.prompt;
      if (prompt) {
        setInput(prompt);
        if (textareaRef.current) {
          textareaRef.current.value = prompt;
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
        }
        if (e.detail?.autoSend) {
          setTimeout(() => {
            handleSend(undefined, prompt);
          }, 200);
        }
      }
    };
    window.addEventListener('flux:open-ai', handleOpenAi);
    return () => window.removeEventListener('flux:open-ai', handleOpenAi);
  }, [onOpenChange, handleSend]);

  // --- Auto-pilot checkin loop ---

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pending = localStorage.getItem("flux_autopilot_pending_checkin") === "true";
    const active = localStorage.getItem("flux_autopilot_active") === "true";
    const goal = localStorage.getItem("flux_autopilot_goal") || "";
    if (!pending || !active || !goal || isTyping || isStreamingActive) return;

    if (autoPilotTurnsRef.current >= 5) {
      localStorage.removeItem('flux_autopilot_pending_checkin');
      localStorage.removeItem('flux_autopilot_checkin_message');
      localStorage.removeItem('flux_autopilot_active');
      localStorage.removeItem('flux_autopilot_goal');
      localStorage.removeItem('flux_active_workflow');
      setAutoPilotActive(false);
      setAutoPilotGoal("");
      autoPilotTurnsRef.current = 0;
      setMessages(prev => [...prev, { role: "assistant", content: `**Auto-Pilot Completed:** Reached iteration limit (5) for goal: "${goal}".`, timestamp: Date.now() }]);
      return;
    }

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
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="h-7 px-2 mr-1.5 rounded border border-border bg-background text-[11px] font-medium text-foreground/85 focus:outline-none focus:ring-1 focus:ring-border cursor-pointer max-w-[125px] truncate shadow-xs opacity-95"
                  title="AI Model"
                >
                  <option value="flux-fast">Flux Fast</option>
                  <option value="flux-pro">Flux Pro</option>
                  <option value="flux-ultra">Flux Ultra</option>
                  <option value="flux-turbo">Flux Turbo</option>
                  <option value="flux-omni">Flux Omni</option>
                </select>
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
                      {(() => {
                        const isPill = (msg.isThinking || msg.isStreaming) && (!msg.content || msg.content.trim().length === 0) && (!msg.thought || msg.thought.trim().length === 0);

                        return (
                          <div className="flex items-start gap-2 w-full">
                            {/* Avatar */}
                            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white/[0.08] border border-white/[0.14] shadow-xs shrink-0 mt-0.5">
                              <FluxAiIcon size={14} />
                            </div>

                            {/* The Box: starts as the exact pill from user's image, then smoothly expands (smooth like iPhone) */}
                            <motion.div
                              layout
                              initial={{ opacity: 0, scale: 0.94 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{
                                layout: { type: "spring", stiffness: 320, damping: 28, mass: 0.8 },
                                opacity: { duration: 0.2 }
                              }}
                              className={cn(
                                "relative overflow-hidden transition-[border-radius,background-color,border-color] duration-300",
                                isPill ? "max-w-fit cursor-default" : "w-full"
                              )}
                            >
                              <BorderBeam
                                size={isPill ? "sm" : "md"}
                                colorVariant="ocean"
                                borderRadius={isPill ? 9999 : 16}
                                active={Boolean(msg.isStreaming)}
                                className={cn(isPill ? "rounded-full" : "w-full rounded-2xl")}
                              >
                                <div
                                  className={cn(
                                    "transition-[border-radius,background-color,border-color] duration-300",
                                    isPill
                                      ? "flex items-center gap-1.5 py-1 px-3 rounded-full bg-secondary/80 border border-border/70 backdrop-blur-md shadow-xs"
                                      : "w-full rounded-2xl bg-card/85 border border-border/75 text-foreground p-3.5 shadow-sm"
                                  )}
                                >
                                  {isPill ? (
                                    /* Compact Thinking / Task Pill (Exact visual match from user's image) */
                                    <div className="flex items-center gap-1.5 py-0.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                                      <span className="text-[11px] font-mono text-muted-foreground font-medium ml-1 select-none">
                                        {msg.taskLabel || "Thinking..."}
                                      </span>
                                    </div>
                                  ) : (
                                    /* Expanded Full Response Card */
                                    <motion.div
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      transition={{ duration: 0.25 }}
                                      onClick={() => { if (msg.isStreaming) finalizeActiveStream(); }}
                                      className={cn("w-full space-y-2", msg.isStreaming && "cursor-pointer")}
                                      title={msg.isStreaming ? 'Click to show full response' : undefined}
                                    >
                                      {/* Task Status Header */}
                                      <div className="flex items-center justify-between pb-2 border-b border-border/40 text-[11px] text-muted-foreground font-mono">
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                          <span className="font-semibold text-foreground/85 tracking-tight">
                                            {msg.taskLabel?.replace(/\.\.\.$/, '') || "Flux AI"}
                                          </span>
                                        </div>
                                        {msg.isStreaming && (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 animate-pulse">
                                            Generating
                                          </span>
                                        )}
                                      </div>

                                      {(msg.thought || msg.isThinking) && (
                                        <AgenticThinkBlock
                                          thought={msg.thought || ''}
                                          isThinking={Boolean(msg.isThinking)}
                                          durationMs={msg.thoughtDuration}
                                        />
                                      )}

                                      <FluxMarkdownRenderer
                                        content={msg.content}
                                        onInjectSql={handleInjectSql}
                                        projectId={project?.project_id}
                                        isStreaming={msg.isStreaming}
                                      />

                                      {msg.chart && (
                                        <InChatChart chart={msg.chart} projectId={project?.project_id} />
                                      )}

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
                                    </motion.div>
                                  )}
                                </div>
                              </BorderBeam>
                            </motion.div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </motion.div>
              ))}
              {isTyping && !messages.some(m => m.role === 'assistant' && (m.isThinking || m.isStreaming)) && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white/[0.08] border border-white/[0.14] shadow-xs shrink-0">
                    <FluxAiIcon size={14} />
                  </div>
                  <BorderBeam size="sm" colorVariant="ocean" borderRadius={9999} className="rounded-full">
                    <div className="flex items-center gap-1.5 py-1 px-3 rounded-full bg-secondary/80 border border-border/70 backdrop-blur-md shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                      <span className="text-[11px] font-mono text-muted-foreground font-medium ml-1">Thinking...</span>
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
