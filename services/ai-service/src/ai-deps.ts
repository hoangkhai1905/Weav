import { LlmProvider } from './application/llm-provider';
import { AiConfig } from './config/ai-config';
import { ServiceJwtVerifier } from './infrastructure/auth/service-jwt-verifier';
import type { UserJwtVerifier } from './infrastructure/auth/user-jwt-verifier';
import type { ChatProvider } from './application/assistant/chat-provider';
import type { ConversationStore } from './application/assistant/conversation-store';

export const AI_DEPS = Symbol('AI_DEPS');
export interface AiDeps {
  config: AiConfig;
  provider: LlmProvider | null;
  verifier: ServiceJwtVerifier | null;
  /** Assistant spike; absent unless AI_ASSISTANT_ENABLED. */
  assistant?: {
    provider: ChatProvider | null;
    verifier: UserJwtVerifier | null;
    /** Per-user history and daily usage; without it the assistant answers AI_NOT_CONFIGURED. */
    store?: ConversationStore | null;
    /** Runs on app shutdown (stops the retention purge, closes the store). */
    onShutdown?: () => Promise<void> | void;
  };
}
