/** Small, locale-neutral formatting helpers (Africa-first: no US idioms). */

const numberFmt = new Intl.NumberFormat('en');
const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

export function formatDate(value: Date | string): string {
  return dateFmt.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFmt.format(typeof value === 'string' ? new Date(value) : value);
}

export function truncateMiddle(value: string, max = 60): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - half)}`;
}

export function timeAgo(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}
