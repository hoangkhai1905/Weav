import { formatDistanceStrict, format } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { vi } from 'date-fns/locale/vi';
import type { Language } from '../../stores/i18n.store';

const LOCALES = { VI: vi, EN: enUS } as const;

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5 phút trước" / "5 minutes ago"; "-" when the value is missing or invalid. */
export function formatRelativeTime(iso: string | null | undefined, language: Language, now?: Date): string {
  const d = parse(iso);
  if (!d) return '-';
  return formatDistanceStrict(d, now ?? new Date(), { locale: LOCALES[language], addSuffix: true });
}

/** "07/10/2026 14:05" in both languages (day first, 24 h). */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? format(d, 'dd/MM/yyyy HH:mm') : '-';
}

/** "14:05:09" for run start times. */
export function formatClock(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? format(d, 'HH:mm:ss') : '-';
}

/** Total run time from two ISO timestamps; null until both exist. */
export function durationBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const a = parse(start);
  const b = parse(end);
  return a && b ? Math.max(0, b.getTime() - a.getTime()) : null;
}
