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
  labelKey: string;
}

const NOT_CONFIGURED: NodeReadinessBadge = { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };

// Fields the Workflow Service requires before publication (DefinitionValidator), besides connectionId.
const CONNECTION_NODE_FIELDS: Record<string, string[]> = {
  'google.sheets': ['spreadsheetId', 'range'],
  'email.send': ['to', 'subject'],
  'telegram.send_message': ['chatId', 'text'],
};

const isBlank = (value: unknown) => !String(value ?? '').trim();

/** logic.condition: single {left, operator, right} or multi {combinator, conditions[1..10]} (DefinitionValidator). */
export const isConditionComplete = (config: Record<string, unknown>): boolean => {
  if (config.conditions === undefined && config.combinator === undefined) return !isBlank(config.left) && !isBlank(config.right);
  const conditions = config.conditions;
  return (config.combinator === 'and' || config.combinator === 'or')
    && Array.isArray(conditions) && conditions.length >= 1 && conditions.length <= 10
    && conditions.every((item: { left?: unknown; operator?: unknown; right?: unknown }) => !isBlank(item?.left) && !isBlank(item?.operator) && !isBlank(item?.right));
};

/**
 * `attachableConnectionIds`: ids of the workspace's ACTIVE connections the user can attach.
 * Leave it undefined while the list is loading so a step is not flagged before we know.
 */
export const getNodeReadinessBadge = (
  nodeType: string,
  config: Record<string, unknown>,
  attachableConnectionIds?: ReadonlySet<string>,
): NodeReadinessBadge => {
  if (!SUPPORTED_NODE_TYPES.has(nodeType)) return { state: 'unsupported', label: 'Unsupported', labelKey: 'builder.readiness.unsupported' };
  if (nodeType === 'trigger.webhook') return { state: 'draft', label: 'Not published', labelKey: 'builder.readiness.not_published' };
  if (
    nodeType === 'trigger.telegram' ||
    nodeType === 'ocr.extract'
  ) {
    return { state: 'unavailable', label: 'Unavailable', labelKey: 'builder.readiness.unavailable' };
  }
  const connectionFields = CONNECTION_NODE_FIELDS[nodeType];
  if (connectionFields) {
    const connectionId = String(config.connectionId ?? '').trim();
    if (!connectionId || connectionFields.some((field) => !String(config[field] ?? '').trim())) return NOT_CONFIGURED;
    const operation = String(config.operation ?? 'read');
    // Lookup needs a column and a value (DefinitionValidator.validateSheetsLookup).
    if (nodeType === 'google.sheets' && operation === 'lookup' && (isBlank(config.lookupColumn) || isBlank(config.lookupValue))) return NOT_CONFIGURED;
    // Append/update write `values`, a JSON array of rows (GoogleSheetsNodeExecutor.parseValues).
    if (nodeType === 'google.sheets' && (operation === 'append' || operation === 'update')
      && !(Array.isArray(config.values) && config.values.every(Array.isArray)
        && (config.values[0] as unknown[] | undefined)?.some((cell) => String(cell ?? '').trim()))) {
      return NOT_CONFIGURED;
    }
    if (attachableConnectionIds && !attachableConnectionIds.has(connectionId)) {
      return { state: 'authorization-required', label: 'Authorization required', labelKey: 'builder.readiness.authorization_required' };
    }
  }
  if (nodeType === 'logic.condition' && !isConditionComplete(config)) {
    return { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };
  }
  if (nodeType === 'trigger.schedule') {
    const fields = String(config.cron ?? '').trim().split(/\s+/);
    if (fields.length !== 6 || !String(config.timezone ?? '').trim()) {
      return { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };
    }
  }
  if (nodeType === 'http.request' && !String(config.url ?? '').trim()) {
    return { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };
  }
  if (nodeType === 'ai.extract') {
    const schema = config.outputSchema as { type?: unknown; properties?: Record<string, unknown> } | undefined;
    const hasFields = schema?.type === 'object' && Object.keys(schema.properties ?? {}).length > 0;
    if (!hasFields || !String(config.text ?? '').trim()) return { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };
  }
  if (nodeType === 'ai.classify' && (!Array.isArray(config.categories) || config.categories.length < 2 || !String(config.content ?? '').trim())) {
    return { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };
  }
  if (nodeType === 'ai.summarize' && !String(config.inputText ?? '').trim()) {
    return { state: 'not-configured', label: 'Not configured', labelKey: 'builder.readiness.not_configured' };
  }
  return { state: 'ready', label: 'Ready', labelKey: 'builder.readiness.ready' };
};
