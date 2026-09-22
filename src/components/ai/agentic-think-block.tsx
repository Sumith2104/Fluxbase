'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Brain, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AgenticThinkBlockProps {
  thought: string;
  isThinking?: boolean;
  durationMs?: number;
  className?: string;
}

export function AgenticThinkBlock({
  thought,
  isThinking = false,
  durationMs,
  className
}: AgenticThinkBlockProps) {
  const [isOpen, setIsOpen] = useState(isThinking);
  const [elapsed, setElapsed] = useState(durationMs ? Math.round(durationMs / 100) / 10 : 0);

  useEffect(() => {
    if (!isThinking) return;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 100) / 10);
    }, 100);
    return () => clearInterval(timer);
  }, [isThinking]);

  // Keep open while thinking, collapse on finish by default to keep chat clean
  useEffect(() => {
    if (isThinking) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [isThinking]);

  if (!thought && !isThinking) return null;

  return (
    <div className={cn("my-2 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden text-xs", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-muted-foreground select-none cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Brain className={cn("size-3.5 text-cyan-400", isThinking && "animate-pulse text-cyan-300")} />
          <span className="font-mono text-[11px] font-medium text-foreground/80">
            {isThinking ? 'Reasoning Process...' : 'Reasoning Process'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10.5px] font-mono text-muted-foreground/70">
          <div className="flex items-center gap-1">
            <Clock className="size-3 text-muted-foreground/60" />
            <span>{isThinking ? `${elapsed.toFixed(1)}s` : durationMs ? `${(durationMs / 1000).toFixed(1)}s` : `${elapsed.toFixed(1)}s`}</span>
          </div>
          <ChevronRight className={cn("size-3.5 transition-transform duration-200 text-muted-foreground/70", isOpen && "rotate-90")} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3.5 py-2.5 border-t border-white/[0.06] bg-black/20 font-mono text-[11px] leading-relaxed text-muted-foreground/90 whitespace-pre-wrap max-h-64 overflow-y-auto custom-scrollbar">
              {thought}
              {isThinking && (
                <span className="inline-block w-1.5 h-3 ml-1 bg-cyan-400/80 animate-pulse" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
