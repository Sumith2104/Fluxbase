import React from 'react';

export type PaymentStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'delivered' | 'exhausted';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const s = status.toLowerCase();

  let dotColor = 'bg-zinc-500';
  let textColor = 'text-zinc-400';
  let bgColor = 'bg-zinc-900 border-zinc-800';

  if (s === 'paid' || s === 'delivered' || s === 'completed' || s === 'active') {
    dotColor = 'bg-emerald-500';
    textColor = 'text-emerald-400';
    bgColor = 'bg-emerald-950/40 border-emerald-800/40';
  } else if (s === 'pending') {
    dotColor = 'bg-amber-500 animate-pulse';
    textColor = 'text-amber-400';
    bgColor = 'bg-amber-950/40 border-amber-800/40';
  } else if (s === 'failed' || s === 'exhausted') {
    dotColor = 'bg-rose-500';
    textColor = 'text-rose-400';
    bgColor = 'bg-rose-950/40 border-rose-800/40';
  } else if (s === 'expired') {
    dotColor = 'bg-zinc-600';
    textColor = 'text-zinc-500';
    bgColor = 'bg-zinc-900/60 border-zinc-800/60';
  }

  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono uppercase tracking-wider border rounded ${padding} ${bgColor} ${textColor}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {s}
    </span>
  );
};
