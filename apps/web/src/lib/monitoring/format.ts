import type { StatusTone } from '../../components/common/statusBadgeClass';
import type { RunStatus } from '../../api/monitoring.api';

/** 1500 -> "1,5 s", 125000 -> "2 min 5 s", null -> an em dash. Locale decides the decimal mark. */
export function formatDurationMs(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toLocaleString(locale, { maximumFractionDigits: 1 })} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** 0.857 -> "85,7%"; null (no finished run) -> an em dash. */
export function formatPercent(fraction: number | null | undefined, locale: string): string {
  if (fraction === null || fraction === undefined) return '—';
  return `${(fraction * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

export function runTone(status: RunStatus): StatusTone {
  if (status === 'SUCCESS') return 'ok';
  if (status === 'FAILED') return 'err';
  if (status === 'RUNNING' || status === 'QUEUED' || status === 'WAITING') return 'run';
  return 'pause';
}

export const RUN_STATUSES: RunStatus[] = ['QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'];

/** Start of the UTC day of a yyyy-mm-dd input value, as an ISO instant (undefined when empty/invalid). */
export function dayStartIso(value: string): string | undefined {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/** Exclusive end for an inclusive yyyy-mm-dd "to" date: the start of the next UTC day. */
export function dayEndExclusiveIso(value: string): string | undefined {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? new Date(time + 86_400_000).toISOString() : undefined;
}
