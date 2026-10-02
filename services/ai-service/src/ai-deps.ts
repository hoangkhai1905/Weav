import { LlmProvider } from './application/llm-provider';
import { AiConfig } from './config/ai-config';
import { ServiceJwtVerifier } from './infrastructure/auth/service-jwt-verifier';

export const AI_DEPS = Symbol('AI_DEPS');
export interface AiDeps {
  config: AiConfig;
  provider: LlmProvider | null;
  verifier: ServiceJwtVerifier | null;
}
