// Pure (no react-native import) so Node tests can load it. Mirrors apps/web lib/executions/runView.ts.

export interface NodeErrorParts {
  code: string | null;
  message: string | null;
  /** Config field whose value failed (error.details.field), e.g. `to`. */
  field: string | null;
}

/** Reads `{ code, message, details: { field } }`; the gateway may also hand it over as JSON text. */
export function nodeErrorParts(error: unknown): NodeErrorParts {
  let value = error;
  if (typeof error === 'string') {
    try {
      value = JSON.parse(error);
    } catch {
      return { code: null, message: error || null, field: null };
    }
  }
  if (!value || typeof value !== 'object') return { code: null, message: null, field: null };
  const { code, message, details } = value as { code?: unknown; message?: unknown; details?: unknown };
  const field = details && typeof details === 'object' ? (details as { field?: unknown }).field : null;
  return {
    code: typeof code === 'string' && code ? code : null,
    message: typeof message === 'string' && message ? message : null,
    field: typeof field === 'string' && field ? field : null,
  };
}

/**
 * One readable line, e.g. "Người nhận: Cấu hình của bước này chưa hợp lệ...". A localised text by code
 * wins over the raw (English) backend message; null when there is nothing to say.
 */
export function nodeErrorSummary(error: unknown, t: (key: string) => string): string | null {
  const { code, message, field } = nodeErrorParts(error);
  // The engine words a missing reference as "... refers to a value that is missing."
  const name = code === 'MAPPING_ERROR' && message?.includes('is missing') ? 'MAPPING_MISSING' : code;
  const friendlyKey = `runs.err.${name}`;
  const friendly = name && t(friendlyKey) !== friendlyKey ? t(friendlyKey) : null;
  const text = friendly ?? message;
  if (!text) return null;
  if (!field) return text;
  const labelKey = `runs.field.${field}`;
  const label = t(labelKey) === labelKey ? field : t(labelKey);
  return `${label}: ${text}`;
}
