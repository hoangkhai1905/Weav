import type { Logger } from '@nestjs/common';
import type {
  ConversationStore,
  PurgeOptions,
} from '../../application/assistant/conversation-store';

/** Runs `store.purge` every `intervalMs`; failures are logged, never thrown. Returns a stop function. */
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
        `Assistant retention purge failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  };
  const timer = setInterval(() => void run(), opts.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
