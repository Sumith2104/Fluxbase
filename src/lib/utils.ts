import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const IST_TIMEZONE = 'Asia/Kolkata';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function getLocalTimestamp(timezone?: string): string {
  try {
    const tz = timezone || IST_TIMEZONE;
    const d = new Date();
    // 'sv-SE' outputs 'YYYY-MM-DD HH:mm:ss'
    return d.toLocaleString('sv-SE', { timeZone: tz, hour12: false });
  } catch {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

/**
 * Format any date/timestamp into Indian Standard Time (IST) date string
 * Example: "16 Oct 2026"
 */
export function formatISTDate(
  date: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return '—';
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options
  });
}

/**
 * Format any date/timestamp into Indian Standard Time (IST) date & time string
 * Example: "16 Oct 2026, 12:35 am IST"
 */
export function formatISTDateTime(
  date: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return '—';
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  const formatted = d.toLocaleString('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options
  });
  return `${formatted} IST`;
}

/**
 * Format any date/timestamp into Indian Standard Time (IST) time string
 * Example: "12:35:10 am"
 */
export function formatISTTime(
  date: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return '—';
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options
  });
}
