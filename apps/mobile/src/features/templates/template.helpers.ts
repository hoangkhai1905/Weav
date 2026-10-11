// Pure (no react-native import) so Node tests can load it.

/** Steps that need a connection the user must pick again after copying a template. */
const NEEDS_CONNECTION = new Set([
  'email.send',
  'telegram.send_message',
  'discord.send_message',
  'slack.send_message',
  'teams.send_message',
  'trigger.gmail',
  'trigger.telegram',
]);

export function reconnectCount(nodes: readonly { type: string }[]): number {
  return nodes.filter((n) => NEEDS_CONNECTION.has(n.type) || n.type.startsWith('google.')).length;
}

export type TemplateErrorPhase = 'lookup' | 'use' | 'load';

/** i18n key of the friendly sentence for a failed template call; the raw backend message is never shown. */
export function templateErrorKey(error: unknown, phase: TemplateErrorPhase): string {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  // A malformed body (INVALID_RESPONSE) also has no status, but it is not a connection problem.
  if (typeof status !== 'number') return code === 'INVALID_RESPONSE' ? GENERIC[phase] : 'au.err.network';
  if (status === 404) return phase === 'lookup' ? 'tpl.err.codeNotFound' : 'tpl.err.notFound';
  if (status === 403 && phase === 'use') return 'tpl.err.useForbidden';
  if (status === 429) return 'tpl.err.tooMany';
  return GENERIC[phase];
}

const GENERIC: Record<TemplateErrorPhase, string> = {
  lookup: 'tpl.err.lookupFailed',
  use: 'tpl.err.useFailed',
  load: 'tpl.err.loadFailed',
};
