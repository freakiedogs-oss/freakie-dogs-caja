import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatUSD = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatPct = (n: number | null | undefined, decimals = 1) =>
  n == null ? '—' : `${n.toFixed(decimals)}%`;

export const formatDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
};
