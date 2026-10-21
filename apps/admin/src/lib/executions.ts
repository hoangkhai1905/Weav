import type { StatusTone } from './ui';

export const MAX_RANGE_DAYS = 90;
const DAY_MS = 86_400_000;

/** Start of the chosen local day as an ISO instant, or undefined for an empty or invalid value. */
export function dayStartIso(value: string): string | undefined {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Exclusive end for an inclusive "to" day: the start of the day after it. */
export function dayEndExclusiveIso(value: string): string | undefined {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d + 1);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Null when the range is fine, otherwise which rule it breaks (the server rejects both with 400). */
export function rangeProblem(from?: string, to?: string): 'order' | 'long' | null {
  if (!from || !to) return null;
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0) return 'order';
  return span > MAX_RANGE_DAYS * DAY_MS ? 'long' : null;
}

/** "420 ms", "1.2 s", "3 min 4 s", "1 h 2 min"; "—" when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toString()} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

export const durationBetween = (start: string | null, end: string | null): number | null =>
  start && end ? Date.parse(end) - Date.parse(start) : null;

const TONES: Record<string, StatusTone> = {
  SUCCESS: 'ok',
  FAILED: 'err',
  RUNNING: 'run',
  QUEUED: 'warn',
  WAITING: 'warn',
  PENDING: 'pause',
  READY: 'pause',
  SKIPPED: 'pause',
};
export const statusTone = (status: string): StatusTone => TONES[status] ?? 'pause';

const NODE_PREFIXES = ['trigger', 'telegram', 'gmail', 'sheets', 'http', 'ocr', 'ai', 'calendar', 'discord', 'transform', 'logic', 'condition'];

/** i18n key for a node type such as "telegram.send_message" by its prefix, or null when unknown (show the raw id). */
export const nodeTypeKey = (nodeType: string): string | null => {
  const prefix = nodeType.split('.')[0];
  return NODE_PREFIXES.includes(prefix) ? `node.${prefix}` : null;
};

/** Translated label for an enum value such as MANUAL, or the raw value when no label exists. */
export const enumLabel = (t: (key: string) => string, prefix: string, value: string): string => {
  const label = t(`${prefix}.${value}`);
  return label === `${prefix}.${value}` ? value : label;
};
