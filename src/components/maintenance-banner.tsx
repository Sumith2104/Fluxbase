'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, ExternalLink } from 'lucide-react';

interface Announcement {
  id: string;
  content: string;
  badge_text: string;
  bg_color: string;
  text_color: string;
  badge_color?: string;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  dismissible: boolean;
  link_url?: string | null;
  link_text?: string | null;
  priority: number;
}

export function MaintenanceBanner() {
  const [banner, setBanner] = useState<Announcement | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const expireTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scheduleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimers = useCallback(() => {
    if (expireTimerRef.current) {
      clearTimeout(expireTimerRef.current);
      expireTimerRef.current = null;
    }
    if (scheduleTimerRef.current) {
      clearTimeout(scheduleTimerRef.current);
      scheduleTimerRef.current = null;
    }
  }, []);

  const evaluateBannerTiming = useCallback((announcement: Announcement | null) => {
    clearTimers();

    if (!announcement || !announcement.is_active) {
      setBanner(null);
      return;
    }

    // Check if dismissed in this session
    try {
      if (typeof window !== 'undefined' && announcement.dismissible) {
        const dismissedKey = `fluxbase_banner_dismissed_${announcement.id}`;
        if (sessionStorage.getItem(dismissedKey) === 'true') {
          setIsDismissed(true);
          return;
        }
      }
    } catch {}

    const now = Date.now();

    // Check end_time (should end automatically)
    if (announcement.end_time) {
      const endMs = new Date(announcement.end_time).getTime();
      const msUntilEnd = endMs - now;

      if (msUntilEnd <= 0) {
        // Already expired
        setBanner(null);
        return;
      }

      // Schedule auto-expiration (clamped to max 32-bit int ~24.8 days)
      const safeExpireTimeout = Math.min(msUntilEnd, 2147483647);
      expireTimerRef.current = setTimeout(() => {
        setBanner(null);
      }, safeExpireTimeout);
    }

    // Check start_time (scheduler support)
    if (announcement.start_time) {
      const startMs = new Date(announcement.start_time).getTime();
      const msUntilStart = startMs - now;

      if (msUntilStart > 0) {
        // Scheduled for future: hide now, schedule reveal
        setBanner(null);
        const safeStartTimeout = Math.min(msUntilStart, 2147483647);
        scheduleTimerRef.current = setTimeout(() => {
          setBanner(announcement);
        }, safeStartTimeout);
        return;
      }
    }

    // Active right now
    setBanner(announcement);
    setIsDismissed(false);
  }, [clearTimers]);

  const fetchAnnouncement = useCallback(async () => {
    try {
      const res = await fetch('/api/system/maintenance', {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.success) {
        evaluateBannerTiming(data.banner || null);
      }
    } catch {
      // Fallback silently without breaking UI
    }
  }, [evaluateBannerTiming]);

  useEffect(() => {
    fetchAnnouncement();

    // Background poll every 60 seconds to detect new scheduled announcements or updates
    const pollInterval = setInterval(fetchAnnouncement, 60_000);

    // Re-check when window gains focus
    const handleFocus = () => fetchAnnouncement();
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleFocus);
      clearTimers();
    };
  }, [fetchAnnouncement, clearTimers]);

  const handleDismiss = () => {
    if (!banner) return;
    setIsDismissed(true);
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`fluxbase_banner_dismissed_${banner.id}`, 'true');
      }
    } catch {}
  };

  if (!banner || isDismissed) {
    return null;
  }

  const bgColor = banner.bg_color || '#dc2626';
  const textColor = banner.text_color || '#ffffff';
  const badgeColor = banner.badge_color || 'rgba(0, 0, 0, 0.25)';
  const badgeText = banner.badge_text || 'Maintenance';

  return (
    <aside
      aria-label="System Announcement"
      className="relative z-[100] w-full px-3 py-2 text-center text-xs font-medium shadow-md backdrop-blur-md transition-all duration-300 sm:text-sm"
      style={{
        backgroundColor: bgColor,
        color: textColor,
        borderBottom: '1px solid rgba(255, 255, 255, 0.15)'
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 sm:gap-3 flex-wrap pr-6">
        {/* Dynamic Badge */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider shadow-sm shrink-0 border border-white/20"
          style={{ backgroundColor: badgeColor, color: textColor }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          {badgeText}
        </span>

        {/* Message Content */}
        <span className="font-medium tracking-wide">
          {banner.content}
        </span>

        {/* Optional Action Link */}
        {banner.link_url && (
          <a
            href={banner.link_url}
            target={banner.link_url.startsWith('http') ? '_blank' : '_self'}
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity ml-1"
            style={{ color: textColor }}
          >
            {banner.link_text || 'Learn more'}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Dismiss Button */}
      {banner.dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-75 hover:opacity-100 hover:bg-black/10 focus:outline-none focus:ring-1 focus:ring-white/40 transition-all"
          style={{ color: textColor }}
        >
          <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </button>
      )}
    </aside>
  );
}
