'use client';

import React from 'react';

export function MaintenanceBanner() {
  return (
    <aside
      aria-label="Maintenance Announcement"
      className="relative z-[100] w-full border-b border-red-700/40 bg-gradient-to-r from-red-950/95 via-red-900/90 to-red-950/95 px-3 py-2 text-center text-xs text-red-100 shadow-md backdrop-blur-md sm:text-sm"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 sm:gap-2.5 flex-wrap">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm ring-1 ring-red-400/50 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
          Maintenance
        </span>
        <span className="font-medium text-red-50/95">
          App is under maintenance. Some features may not work, but you can still use as normal.
        </span>
      </div>
    </aside>
  );
}
