import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getLocalTimestamp(timezone?: string): string {
  try {
    const tz = timezone || 'Asia/Calcutta';
    const d = new Date();
    // 'sv-SE' outputs 'YYYY-MM-DD HH:mm:ss'
    return d.toLocaleString('sv-SE', { timeZone: tz, hour12: false });
  } catch {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
