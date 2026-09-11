'use client';

import React, { useState } from 'react';
import { Copy, Check, Play, Table, Terminal, ExternalLink, ChevronDown } from 'lucide-react';
import { FluxAiIcon } from '@/components/ui/flux-ai-icon';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface FluxMarkdownRendererProps {
  content: string;
  onInjectSql?: (sql: string) => void;
  projectId?: string;
  isStreaming?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripActionTags(text: string): string {
  return text
    .replace(/\[(?:NAVIGATE|CLICK|TYPE|CONFIRM_ACTION|EXECUTE_SQL|REQUEST_APPROVAL|CALL_MCP|GOAL_ACCOMPLISHED)[^\]]*\]/g, '')
    .replace(/^ACTIONS:\s*$/mi, '')
    .replace(/^\s*[-•]\s*(?:Go to|Click|Type|Create|Head to|Load|Run)\s+.*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractThinking(text: string): { thinking: string[]; cleanedContent: string } {
  const thinking: string[] = [];
  let cleaned = text;

  // 1. Extract closed <think>...</think> tags FIRST
  cleaned = cleaned.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thought) => {
    if (thought.trim()) thinking.push(thought.trim());
    return '';
  });

  // 2. Extract closed <thought>...</thought> tags
  cleaned = cleaned.replace(/<thought>([\s\S]*?)<\/thought>/gi, (_, thought) => {
    if (thought.trim()) thinking.push(thought.trim());
    return '';
  });

  // 3. Extract THOUGHT: ... blocks
  cleaned = cleaned.replace(/^THOUGHT:\s*([\s\S]*?)(?=\n\n|\n[A-Z_]+:|$)/gim, (_, thought) => {
    if (thought.trim()) thinking.push(thought.trim());
    return '';
  });

  // 4. Handle streaming in-progress unclosed <think>... tag
  const unclosedThink = cleaned.match(/<think>([\s\S]*)$/i);
  if (unclosedThink) {
    if (unclosedThink[1].trim()) thinking.push(unclosedThink[1].trim());
    cleaned = cleaned.replace(/<think>[\s\S]*$/i, '');
  }

  // 5. Strip leading or mid-text hallucinated ASSISTANT: turn transitions
  cleaned = cleaned.trim();
  if (/(?:^|\n+)(?:ASSISTANT|Assistant):\s*/i.test(cleaned)) {
    const parts = cleaned.split(/(?:^|\n+)(?:ASSISTANT|Assistant):\s*/i).filter(Boolean);
    if (parts.length > 0) {
      cleaned = parts[parts.length - 1].trim();
    }
  }

  // 6. Clean orphan "Query results: ```sql..." if followed by conversational answer with code
  if (/^Query results:\s*```[\s\S]*?```/i.test(cleaned)) {
    const afterQueryResults = cleaned.replace(/^Query results:\s*```[\s\S]*?```\s*/i, '').trim();
    if (afterQueryResults.includes('```')) {
      cleaned = afterQueryResults;
    }
  }

  // 4. Extract Action: ... meta-narration blocks
  cleaned = cleaned.replace(/^Action:\s*([^\n]+(?:\n[^\n]+)?)/gim, (_, act) => {
    const actTrimmed = act.trim();
    if (actTrimmed && !actTrimmed.startsWith('[') && !thinking.includes(actTrimmed)) {
      thinking.push(actTrimmed);
    }
    return '';
  });

  // 5. Extract transitional filler meta-narration before queries
  // e.g. "To provide the row count for each table, I will execute another SQL query to retrieve the table names along with their respective row counts. Here's the query:"
  const metaFillerMatch = cleaned.match(/^((?:To\s+\w+|I\s+will|Let\s+me|I'm\s+going\s+to|I'll|Allow\s+me\s+to)\s+[^.\n]+(?:execute|query|retrieve|run|fetch|check|inspect)[^.\n]*[.:]?)(?:\s*(?:Here(?:'s|\s+is)\s+the\s+(?:query|result|code):?|```.*))?/i);
  if (metaFillerMatch && (cleaned.length < 400 || !cleaned.includes('|'))) {
    const filler = metaFillerMatch[1].trim();
    if (filler && !thinking.includes(filler)) {
      thinking.push(filler);
      cleaned = cleaned.replace(metaFillerMatch[0], '').trim();
    }
  }

  return { thinking, cleanedContent: cleaned };
}

function parseTableAlignment(delimiterRow: string): ('left' | 'center' | 'right')[] {
  const parts = delimiterRow.split('|').slice(1, -1);
  return parts.map(part => {
    const trimmed = part.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
}

function parseTableRow(row: string): string[] {
  const cells = row.split('|');
  if (cells.length > 2) {
    return cells.slice(1, -1).map(c => c.trim());
  }
  return cells.map(c => c.trim()).filter(Boolean);
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ThinkingBlock({ thought }: { thought: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thought.trim()) return null;

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-muted/20 overflow-hidden text-xs transition-all shadow-2xs">
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors text-left font-medium select-none"
      >
        <div className="flex items-center gap-1.5">
          <FluxAiIcon size={13} className="shrink-0" />
          <span className="text-[11px] font-medium tracking-tight text-foreground/80">Thought process</span>
        </div>
        <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground/70 font-mono">
          <span>{isExpanded ? 'Hide' : 'Show'}</span>
          <ChevronDown
            size={12}
            className={cn("transition-transform duration-200", isExpanded && "rotate-180")}
          />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="px-3 py-2 bg-muted/10 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words border-l-2 border-amber-500/50 ml-2 my-1.5">
              {thought.trim()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InlineFormatted({ text }: { text: string }) {
  if (!text) return null;

  // Split on inline code, bold, italic, and links
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);

  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code
              key={i}
              className="px-1.5 py-0.5 rounded bg-muted/80 font-mono text-[11px] text-foreground border border-border/70 mx-0.5"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return (
            <em key={i} className="italic text-foreground/85">
              {part.slice(1, -1)}
            </em>
          );
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a
              key={i}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-0.5 mx-0.5 font-medium"
            >
              {linkMatch[1]}
              <ExternalLink size={10} className="inline opacity-70" />
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function CodeBlock({
  code,
  language,
  onInjectSql
}: {
  code: string;
  language: string;
  onInjectSql?: (sql: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const isSql = language.toLowerCase() === 'sql';

  return (
    <div className="my-2.5 rounded-lg border border-border/70 overflow-hidden bg-background/90 shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <Terminal size={12} className="text-muted-foreground" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {language || 'code'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isSql && onInjectSql && (
            <button
              onClick={() => onInjectSql(code)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium text-primary hover:bg-primary/10 border border-primary/20 transition-colors"
              title="Open query in Monaco SQL Editor"
            >
              <Play size={10} className="fill-current" />
              <span>Run in Editor</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy code to clipboard"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-500" />
                <span className="text-emerald-500">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words bg-muted/20 custom-scrollbar">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownTable({ lines }: { lines: string[] }) {
  if (lines.length < 2) return null;

  const headerCells = parseTableRow(lines[0]);
  const alignments = lines[1] ? parseTableAlignment(lines[1]) : [];
  const dataRows = lines.slice(2).map(r => parseTableRow(r));

  return (
    <div className="my-2.5 rounded-xl border border-border/70 overflow-hidden bg-card/80 shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-b border-border/60 text-[10.5px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Table size={12} className="text-primary/90" />
          <span className="font-semibold text-foreground/80 tracking-tight">Table Data</span>
        </div>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 text-muted-foreground/80">
          {dataRows.length} row{dataRows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="overflow-x-auto custom-scrollbar max-h-[320px]">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="sticky top-0 bg-muted/90 backdrop-blur-sm border-b border-border/70 z-10">
              {headerCells.map((header, ci) => (
                <th
                  key={ci}
                  style={{ textAlign: alignments[ci] || 'left' }}
                  className="px-3 py-2 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider font-mono whitespace-nowrap"
                >
                  <InlineFormatted text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {dataRows.map((row, ri) => (
              <tr
                key={ri}
                className="hover:bg-muted/30 transition-colors odd:bg-transparent even:bg-muted/10 font-mono text-[11.5px]"
              >
                {headerCells.map((_, ci) => {
                  const val = row[ci] || '';
                  return (
                    <td
                      key={ci}
                      style={{ textAlign: alignments[ci] || 'left' }}
                      className="px-3 py-1.5 text-[11.5px] text-foreground/90 font-mono whitespace-nowrap"
                    >
                      <InlineFormatted text={val} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Markdown Renderer ───────────────────────────────────────────────────

export function FluxMarkdownRenderer({
  content,
  onInjectSql,
  isStreaming
}: FluxMarkdownRendererProps) {
  if (typeof content !== 'string') return <span />;

  const rawCleaned = stripActionTags(content);
  const { thinking, cleanedContent } = extractThinking(rawCleaned);
  const lines = cleanedContent.split('\n');

  const blocks: React.ReactNode[] = [];

  // Render Antigravity-style collapsible thinking blocks at the top
  if (thinking.length > 0) {
    thinking.forEach((thoughtText, ti) => {
      blocks.push(<ThinkingBlock key={`think-${ti}`} thought={thoughtText} />);
    });
  }

  // If no remaining content after thinking extraction, render thinking blocks or cursor if streaming
  if (!cleanedContent.trim()) {
    return (
      <div className="space-y-0.5">
        {blocks}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-primary rounded-[1px] animate-pulse align-middle" />
        )}
      </div>
    );
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced Code Block
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      blocks.push(
        <CodeBlock
          key={`code-${i}`}
          code={codeLines.join('\n')}
          language={language}
          onInjectSql={onInjectSql}
        />
      );
      continue;
    }

    // 2. Markdown Table Detection
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // Verify second line is delimiter (e.g. |---| or |:---:|)
      if (tableLines.length >= 2 && tableLines[1].includes('-')) {
        blocks.push(<MarkdownTable key={`table-${i}`} lines={tableLines} />);
      } else {
        tableLines.forEach((tl, tli) => {
          blocks.push(
            <p key={`tline-${i}-${tli}`} className="mb-1 leading-relaxed font-mono text-xs">
              <InlineFormatted text={tl} />
            </p>
          );
        });
      }
      continue;
    }

    // 3. Headings (#, ##, ###)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        blocks.push(
          <h2 key={`h1-${i}`} className="mt-2 mb-1.5 text-sm font-bold text-foreground tracking-tight">
            <InlineFormatted text={text} />
          </h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h3 key={`h2-${i}`} className="mt-2 mb-1 text-xs font-semibold text-foreground tracking-tight">
            <InlineFormatted text={text} />
          </h3>
        );
      } else {
        blocks.push(
          <h4 key={`h3-${i}`} className="mt-1.5 mb-1 text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wider">
            <InlineFormatted text={text} />
          </h4>
        );
      }
      i++;
      continue;
    }

    // 4. Query Results Observation Header (Special badge styling)
    const queryResultMatch = line.match(/^(Query results|Observation|Result)\s*\((.+)\):?/i);
    if (queryResultMatch) {
      blocks.push(
        <div key={`qr-${i}`} className="my-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>{queryResultMatch[1]}</span>
          <span className="px-1.5 py-0.5 rounded bg-muted/80 text-[10.5px] font-mono text-muted-foreground border border-border/50">
            {queryResultMatch[2]}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // 5. Unordered List Items (- or * or •)
    if (line.match(/^[-*•]\s+/)) {
      const itemText = line.replace(/^[-*•]\s+/, '');
      blocks.push(
        <div key={`ul-${i}`} className="flex items-start gap-2 mb-1 pl-0.5 leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0 mt-1.5 ring-2 ring-primary/20" />
          <span className="text-foreground/90">
            <InlineFormatted text={itemText} />
          </span>
        </div>
      );
      i++;
      continue;
    }

    // 6. Ordered List Items (1., 2., etc.)
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      blocks.push(
        <div key={`ol-${i}`} className="flex items-start gap-2 mb-1 pl-0.5 leading-relaxed">
          <span className="text-[10px] font-mono text-muted-foreground font-semibold px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 shrink-0 mt-0.5">
            {numMatch[1]}
          </span>
          <span className="text-foreground/90">
            <InlineFormatted text={numMatch[2]} />
          </span>
        </div>
      );
      i++;
      continue;
    }

    // 7. Blockquotes (> ...)
    if (line.startsWith('>')) {
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          className="my-1.5 pl-3 border-l-2 border-primary/50 text-muted-foreground italic text-xs leading-relaxed bg-muted/20 py-1 rounded-r"
        >
          <InlineFormatted text={line.replace(/^>\s*/, '')} />
        </blockquote>
      );
      i++;
      continue;
    }

    // 8. Empty lines (spacing)
    if (!line.trim()) {
      blocks.push(<div key={`sp-${i}`} className="h-1.5" />);
      i++;
      continue;
    }

    // 9. Standard Paragraph
    blocks.push(
      <p key={`p-${i}`} className="mb-1 last:mb-0 break-words leading-relaxed text-foreground/90">
        <InlineFormatted text={line} />
      </p>
    );
    i++;
  }

  return (
    <div className="space-y-0.5">
      {blocks}
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 ml-1 bg-primary rounded-[1px] animate-pulse align-middle" />
      )}
    </div>
  );
}
