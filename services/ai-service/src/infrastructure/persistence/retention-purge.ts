import type { Logger } from '@nestjs/common';
import type {
  ConversationStore,
  PurgeOptions,
} from '../../application/assistant/conversation-store';

const STARTUP_DELAY_MS = 10_000;

/** Runs `store.purge` 10 s after start and then every `intervalMs`; failures are logged, never thrown. Returns a stop function. */
export function startRetentionPurge(
  store: ConversationStore,
  opts: PurgeOptions & { intervalMs: number },
  logger: Pick<Logger, 'log' | 'error'>,
): () => void {
  const run = async () => {
    try {
      const r = await store.purge(new Date(), opts);
      if (r.conversations > 0 || r.usageRows > 0)
        logger.log(
          `Assistant retention purge removed ${r.conversations} conversations and ${r.usageRows} usage rows`,
        );
    } catch (err) {
      logger.error(
        `Assistant retention purge failed: ${err instanceof Error ? err.constructor.name : 'unknown error'}`,
      );
    }
  };
  // One run shortly after startup, so a restart loop cannot postpone the purge forever.
  const first = setTimeout(() => void run(), STARTUP_DELAY_MS);
  const timer = setInterval(() => void run(), opts.intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
