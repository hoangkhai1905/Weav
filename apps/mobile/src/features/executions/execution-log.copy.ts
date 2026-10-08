/** Event codes the workflow-service writes into execution logs (ExecutionRunner). */
export const KNOWN_LOG_EVENTS = ['NODE_SUCCEEDED', 'NODE_RETRY_SCHEDULED', 'NODE_FAILED'] as const;

/** i18n key of the friendly sentence for a log event; unknown codes get a generic line. */
export function logEventKey(eventType: string): string {
  return (KNOWN_LOG_EVENTS as readonly string[]).includes(eventType)
    ? `exd.logs.event.${eventType}`
    : 'exd.logs.event.unknown';
}
