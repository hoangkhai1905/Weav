/** Default cap for small upstream JSON bodies (1 MiB). */
export const MAX_UPSTREAM_JSON_BYTES = 1_048_576;

/**
 * Reads at most `max` bytes of the response body as UTF-8 text. Returns null
 * (and cancels the body) when the upstream declares or sends more than `max`.
 */
export async function readCapped(
  response: Response,
  max: number,
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
