// Pure helpers (no react-native import) so Node tests can load them.

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** lucide icon component names; StatusBadge maps them to components. */
export type StatusIconName =
  | 'Clock'
  | 'Loader'
  | 'Hourglass'
  | 'CircleCheck'
  | 'CircleX'
  | 'Ban'
  | 'SkipForward'
  | 'Circle'
  | 'CircleDot'
  | 'FilePen'
  | 'Pause'
  | 'TriangleAlert';

export interface StatusInfo {
  tone: StatusTone;
  icon: StatusIconName;
  /** i18n key, e.g. 'status.SUCCESS'. */
  labelKey: string;
}

const STATUS: Record<string, { tone: StatusTone; icon: StatusIconName }> = {
  // execution (+ node)
  QUEUED: { tone: 'neutral', icon: 'Clock' },
  RUNNING: { tone: 'info', icon: 'Loader' },
  WAITING: { tone: 'warning', icon: 'Hourglass' },
  SUCCESS: { tone: 'success', icon: 'CircleCheck' },
  FAILED: { tone: 'danger', icon: 'CircleX' },
  CANCELLED: { tone: 'neutral', icon: 'Ban' },
  SKIPPED: { tone: 'neutral', icon: 'SkipForward' },
  PENDING: { tone: 'neutral', icon: 'Circle' },
  READY: { tone: 'info', icon: 'CircleDot' },
  // workflow
  DRAFT: { tone: 'neutral', icon: 'FilePen' },
  PUBLISHED: { tone: 'success', icon: 'CircleCheck' },
  PAUSED: { tone: 'warning', icon: 'Pause' },
  // connection / trigger
  ACTIVE: { tone: 'success', icon: 'CircleCheck' },
  INVALID: { tone: 'danger', icon: 'TriangleAlert' },
  DISABLED: { tone: 'neutral', icon: 'Ban' },
};

export const KNOWN_STATUSES = Object.keys(STATUS);

export function statusInfo(status: string | null | undefined): StatusInfo {
  const key = (status ?? '').toUpperCase();
  const hit = STATUS[key];
  return hit
    ? { ...hit, labelKey: `status.${key}` }
    : { tone: 'neutral', icon: 'Circle', labelKey: 'status.UNKNOWN' };
}

/** 850 -> "850 ms", 4200 -> "4.2 s", 125000 -> "2m 05s", 3780000 -> "1h 03m"; null -> "-". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  const total = Math.round(s);
  if (total < 60) return `${total} s`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(total % 60)}s`;
}

/** Shortens long IDs for display: "0f3a9c1e-..." -> "0f3a9c1e". */
export function shortId(id: string, len = 8): string {
  return id.length <= len ? id : id.slice(0, len);
}

/** Pretty JSON, truncated to maxChars with an ellipsis marker. */
export function truncateJson(value: unknown, maxChars = 600): { text: string; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > maxChars
    ? { text: `${text.slice(0, maxChars)}…`, truncated: true }
    : { text, truncated: false };
}

/**
 * i18n key of the friendly sentence for an API error: by `code` when a message exists for it,
 * else by HTTP status (so an unmapped backend code such as RESOURCE_NOT_FOUND still reads well).
 */
export function errorMessageKey(
  error: { code?: string; status?: number } | null | undefined,
  has: (key: string) => boolean,
): string {
  const byCode = `ui.error.${error?.code ?? ''}`;
  if (error?.code && has(byCode)) return byCode;
  const status = error?.status ?? 0;
  if (status === 401) return 'ui.error.UNAUTHORIZED';
  if (status === 403) return 'ui.error.FORBIDDEN';
  if (status === 404) return 'ui.error.NOT_FOUND';
  if (status === 429) return 'ui.error.TOO_MANY_REQUESTS';
  if (status >= 500) return 'ui.error.INTERNAL_ERROR';
  return 'ui.error.UNKNOWN';
}

export function isForbiddenError(error: { code?: string; status?: number } | null | undefined): boolean {
  return error?.code === 'FORBIDDEN' || error?.status === 403;
}
