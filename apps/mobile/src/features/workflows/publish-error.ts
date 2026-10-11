// Pure (no react-native import) so Node tests can load it.

/** Publish validation codes the app explains; everything else asks the user to fix it on the web builder. */
const KNOWN = new Set(['TRIGGER_REQUIRED', 'MULTIPLE_MANUAL_TRIGGERS']);

/**
 * i18n key for a failed publish, or null to fall back to the generic error. Workflow Service puts each
 * validation issue in `details[]` as `{ field, message: "CODE: English text" }` (see apps/web publishErrors.ts).
 */
export function publishErrorKey(error: unknown): string | null {
  const { status, details } = (error ?? {}) as { status?: number; details?: unknown };
  if (status !== 400 || !Array.isArray(details) || details.length === 0) return null;
  for (const detail of details) {
    const message = (detail as { message?: unknown } | null)?.message;
    const code = typeof message === 'string' ? /^([A-Z][A-Z_]+):/.exec(message)?.[1] : undefined;
    if (code && KNOWN.has(code)) return `pub.err.${code}`;
  }
  return 'pub.err.invalid';
}
