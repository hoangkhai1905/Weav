export interface LlmRequest {
  system: string;
  user: string;
}

/** Outbound port. Implementations make exactly one provider call and throw AiError on any failure. */
export interface LlmProvider {
  completeJson(request: LlmRequest, signal: AbortSignal): Promise<Record<string, unknown>>;
}
