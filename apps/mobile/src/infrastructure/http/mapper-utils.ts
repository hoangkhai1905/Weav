/** Small runtime checks shared by the DTO -> domain mappers. Throws on a malformed gateway response. */
export type Rec = Record<string, unknown>;

export function invalid(what: string): never {
  throw new Error(`Invalid response: ${what}.`);
}

export function rec(value: unknown, what: string): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(what);
  return value as Rec;
}

export function str(r: Rec, key: string, what: string): string {
  const value = r[key];
  if (typeof value !== 'string') invalid(`${what}.${key}`);
  return value;
}

export function strOrNull(r: Rec, key: string, what: string): string | null {
  const value = r[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(`${what}.${key}`);
  return value;
}

export function int(r: Rec, key: string, what: string): number {
  const value = r[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(`${what}.${key}`);
  return value;
}

export function bool(r: Rec, key: string, what: string): boolean {
  const value = r[key];
  if (typeof value !== 'boolean') invalid(`${what}.${key}`);
  return value;
}

export function arr(r: Rec, key: string, what: string): unknown[] {
  const value = r[key];
  if (!Array.isArray(value)) invalid(`${what}.${key}`);
  return value;
}

export function oneOf<T extends string>(
  r: Rec,
  key: string,
  allowed: readonly T[],
  what: string,
): T {
  const value = r[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalid(`${what}.${key}`);
  }
  return value as T;
}

export function oneOfOrNull<T extends string>(
  r: Rec,
  key: string,
  allowed: readonly T[],
  what: string,
): T | null {
  return r[key] === null || r[key] === undefined ? null : oneOf(r, key, allowed, what);
}

export function recOrEmpty(value: unknown): Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : {};
}

export function durationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
