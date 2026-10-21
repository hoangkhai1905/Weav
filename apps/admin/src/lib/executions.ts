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
export function rangeProblem(from?: string, to?: string, now = Date.now()): 'order' | 'long' | null {
  if (!from) return null;
  // An empty "to" is open upwards: the server measures the range up to now.
  const span = (to ? Date.parse(to) : now) - Date.parse(from);
  if (!to) return span > MAX_RANGE_DAYS * DAY_MS ? 'long' : null;
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
  CANCELLED: 'pause',
};
export const statusTone = (status: string): StatusTone => TONES[status] ?? 'pause';

// The real node types (packages/workflow-schema). Labels live in the dictionary as node.type.<type> and node.prefix.<prefix>.
const NODE_TYPES = new Set([
  'ai.classify', 'ai.extract', 'ai.generate', 'ai.summarize', 'data.set', 'discord.send_message', 'email.send', 'format.datetime', 'format.text',
  'google.calendar', 'google.drive', 'google.sheets', 'http.request', 'logic.condition', 'logic.switch', 'ocr.extract', 'slack.send_message',
  'teams.send_message', 'telegram.send_message', 'trigger.gmail', 'trigger.manual', 'trigger.schedule', 'trigger.telegram', 'trigger.webhook',
  'trigger.workflow_event', 'weav.workflow',
]);
const NODE_PREFIXES = new Set(['ai', 'data', 'discord', 'email', 'format', 'google', 'http', 'logic', 'ocr', 'slack', 'teams', 'telegram', 'trigger', 'weav']);

/** i18n key for a node type: its own label, else its prefix label, else null (show the raw id). */
export const nodeTypeKey = (nodeType: string): string | null => {
  if (NODE_TYPES.has(nodeType)) return `node.type.${nodeType}`;
  const prefix = nodeType.split('.')[0];
  return NODE_PREFIXES.has(prefix) ? `node.prefix.${prefix}` : null;
};

/** Translated label for an enum value such as MANUAL, or the raw value when no label exists. */
export const enumLabel = (t: (key: string) => string, prefix: string, value: string): string => {
  const label = t(`${prefix}.${value}`);
  return label === `${prefix}.${value}` ? value : label;
};
