import { AiError } from '../../domain/errors';

const ERROR_BODY_BYTES = 4096;

/** Reads the whole body, failing with AI_OUTPUT_INVALID once it exceeds maxBytes. */
export async function readCapped(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) throw new AiError('AI_OUTPUT_INVALID');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AiError('AI_OUTPUT_INVALID');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(
      signal.aborted ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
    );
  }
  return Buffer.concat(chunks);
}

/** First 4 KiB of an error body, lower-cased; the rest is dropped. */
async function readErrorHead(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // an unreadable error body just means no hint
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks)
    .subarray(0, ERROR_BODY_BYTES)
    .toString('utf8')
    .toLowerCase();
}

/**
 * Maps a non-200 provider response to an AiError. userKey=false is the
 * service-owned DeepSeek key (429 counts as unavailable); userKey=true is a
 * workspace's own key (429 = rate limit/credit, 404 or a 400 naming the model
 * = unknown model). Never put provider text or the key in the error.
 */
export async function failOnStatus(
  response: Response,
  userKey: boolean,
): Promise<never> {
  const { status } = response;
  const head =
    userKey && status === 400 ? await readErrorHead(response) : undefined;
  if (head === undefined) await response.body?.cancel().catch(() => undefined);
  if ([401, 402, 403].includes(status)) throw new AiError('AI_PROVIDER_AUTH');
  if (userKey && status === 429) throw new AiError('AI_PROVIDER_RATE_LIMITED');
  if (status === 429 || status >= 500)
    throw new AiError('AI_PROVIDER_UNAVAILABLE');
  if (userKey && (status === 404 || head?.includes('model')))
    throw new AiError('AI_MODEL_NOT_FOUND');
  throw new AiError('AI_OUTPUT_INVALID');
}
