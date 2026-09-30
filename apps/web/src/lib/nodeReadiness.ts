import { NODE_CATALOG } from './constants/nodeCatalog';

const SUPPORTED_NODE_TYPES = new Set(NODE_CATALOG.map((item) => item.type));

export type NodeReadinessState =
  | 'ready'
  | 'draft'
  | 'not-configured'
  | 'authorization-required'
  | 'unavailable'
  | 'unsupported';

export interface NodeReadinessBadge {
  state: NodeReadinessState;
  label: string;
}

export const getNodeReadinessBadge = (nodeType: string, config: Record<string, unknown>): NodeReadinessBadge => {
  if (!SUPPORTED_NODE_TYPES.has(nodeType)) return { state: 'unsupported', label: 'Unsupported' };
  if (nodeType === 'trigger.webhook') return { state: 'draft', label: 'Not published' };
  if (
    nodeType === 'trigger.telegram' ||
    nodeType === 'telegram.send_message' ||
    nodeType === 'ocr.extract'
  ) {
    return { state: 'unavailable', label: 'Unavailable' };
  }
  if (nodeType === 'google.sheets') {
    return String(config.connectionId ?? '').trim()
      ? { state: 'authorization-required', label: 'Authorization required' }
      : { state: 'not-configured', label: 'Not configured' };
  }
  if (
    nodeType === 'email.send' &&
    (!String(config.connectionId ?? '').trim() || !String(config.to ?? '').trim() || !String(config.subject ?? '').trim())
  ) {
    return { state: 'not-configured', label: 'Not configured' };
  }
  if (nodeType === 'logic.condition' && (!String(config.left ?? '').trim() || !String(config.right ?? '').trim())) {
    return { state: 'not-configured', label: 'Not configured' };
  }
  if (nodeType === 'trigger.schedule') {
    const fields = String(config.cron ?? '').trim().split(/\s+/);
    if (fields.length !== 6 || !String(config.timezone ?? '').trim()) {
      return { state: 'not-configured', label: 'Not configured' };
    }
  }
  if (nodeType === 'http.request' && !String(config.url ?? '').trim()) {
    return { state: 'not-configured', label: 'Not configured' };
  }
  if (nodeType === 'ai.extract') {
    const schema = config.outputSchema as { type?: unknown; properties?: Record<string, unknown> } | undefined;
    const hasFields = schema?.type === 'object' && Object.keys(schema.properties ?? {}).length > 0;
    if (!hasFields || !String(config.text ?? '').trim()) return { state: 'not-configured', label: 'Not configured' };
  }
  if (nodeType === 'ai.classify' && (!Array.isArray(config.categories) || config.categories.length < 2 || !String(config.content ?? '').trim())) {
    return { state: 'not-configured', label: 'Not configured' };
  }
  if (nodeType === 'ai.summarize' && !String(config.inputText ?? '').trim()) {
    return { state: 'not-configured', label: 'Not configured' };
  }
  return { state: 'ready', label: 'Ready' };
};
