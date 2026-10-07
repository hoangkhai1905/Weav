/** Optional run input typed by the user: empty means `{}`; otherwise it must be a JSON object. */
export type RunInputParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'invalid_json' | 'not_object' | 'too_large' };

const MAX_INPUT_CHARS = 100_000;

export function parseRunInput(text: string): RunInputParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: {} };
  if (trimmed.length > MAX_INPUT_CHARS) return { ok: false, reason: 'too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not_object' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}
