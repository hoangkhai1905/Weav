import { LlmProvider } from './application/llm-provider';
import { AiConfig } from './config/ai-config';
import { ServiceJwtVerifier } from './infrastructure/auth/service-jwt-verifier';
import type { UserJwtVerifier } from './infrastructure/auth/user-jwt-verifier';
import type { ChatProvider } from './application/assistant/chat-provider';

export const AI_DEPS = Symbol('AI_DEPS');
export interface AiDeps {
  config: AiConfig;
  provider: LlmProvider | null;
  verifier: ServiceJwtVerifier | null;
  /** Assistant spike; absent unless AI_ASSISTANT_ENABLED. */
  assistant?: {
    provider: ChatProvider | null;
    verifier: UserJwtVerifier | null;
  };
}
