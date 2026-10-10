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

const isBlank = (value: unknown) => !String(value ?? '').trim();

// Fields the Workflow Service requires before publication (DefinitionValidator and the executors),
// besides connectionId, for the steps that use a workspace connection.
const CONNECTION_NODE_FIELDS: Record<string, (config: Record<string, unknown>) => string[]> = {
  'google.sheets': () => ['spreadsheetId', 'range'],
  // A reply keeps the original subject, so the subject is optional when replying to a message (#57).
  'email.send': (config) => ['to', ...(isBlank(config.replyToMessageId) ? ['subject'] : [])],
  'telegram.send_message': () => ['chatId', 'text'],
  'trigger.telegram': () => [],
  'trigger.gmail': () => [],
  // Upload with `content` (or nothing) needs a name; with `file` the name defaults to the file's own (S10).
  'google.drive': (config) => ['operation',
    ...(config.operation === 'upload' && isBlank(config.file) ? ['name'] : []),
    // Download needs the id of the Drive file to fetch.
    ...(config.operation === 'download' ? ['fileId'] : [])],
  'google.calendar': (config) => (isBlank(config.operation) || config.operation === 'create' ? ['summary', 'start', 'end'] : []),
};

// logic.switch and data.set mirror DefinitionValidator.validateSwitchCases / validateDataSetFields.
const isSwitchComplete = (config: Record<string, unknown>): boolean => {
  const cases = config.cases;
  return config.value !== undefined && !isBlank(config.value) && Array.isArray(cases) && cases.length >= 1 && cases.length <= 20
    && cases.every((item) => typeof item === 'string' && item.trim() !== '' && item !== 'default' && item.length <= 64 && !item.includes('{{'))
    && new Set(cases).size === cases.length;
};

const isDataSetComplete = (config: Record<string, unknown>): boolean => {
  const fields = config.fields;
  if (typeof fields === 'string') return fields.includes('{{');
  return typeof fields === 'object' && fields !== null && !Array.isArray(fields) && Object.keys(fields).length > 0 && Object.keys(fields).length <= 100
    && Object.keys(fields).every((key) => key.trim() !== '');
};

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
 * `ocrSources`: OCR sources the Workflow Service has enabled ("url", "artifact", "file"); absent or empty
 * means OCR cannot run in a workflow yet.
 */
export const getNodeReadinessBadge = (
  nodeType: string,
  config: Record<string, unknown>,
  attachableConnectionIds?: ReadonlySet<string>,
  ocrSources?: readonly string[],
): NodeReadinessBadge => {
  if (!SUPPORTED_NODE_TYPES.has(nodeType)) return { state: 'unsupported', label: 'Unsupported', labelKey: 'builder.readiness.unsupported' };
  if (nodeType === 'trigger.webhook') return { state: 'draft', label: 'Not published', labelKey: 'builder.readiness.not_published' };
  if (nodeType === 'ocr.extract') {
    const unavailable: NodeReadinessBadge = { state: 'unavailable', label: 'Unavailable', labelKey: 'builder.readiness.unavailable' };
    if (!ocrSources?.length) return unavailable;
    // Exactly one source (DefinitionValidator OCR_SOURCE_REQUIRED / OCR_SOURCE_CONFLICT), and it must be enabled.
    const used = ([['url', config.fileUrl], ['artifact', config.artifactId], ['file', config.file]] as const)
      .filter(([, value]) => !isBlank(value)).map(([source]) => source);
    if (used.length !== 1) return NOT_CONFIGURED;
    if (!ocrSources.includes(used[0])) return unavailable;
  }
  const connectionFields = CONNECTION_NODE_FIELDS[nodeType]?.(config);
  if (connectionFields) {
    const connectionId = String(config.connectionId ?? '').trim();
    if (!connectionId || connectionFields.some((field) => isBlank(config[field]))) return NOT_CONFIGURED;
    // Drive uploads take `content` or `file`, never both (CONFIGURATION_ERROR).
    if (nodeType === 'google.drive' && !isBlank(config.content) && !isBlank(config.file)) return NOT_CONFIGURED;
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
  if ((nodeType === 'logic.switch' && !isSwitchComplete(config))
    || (nodeType === 'data.set' && !isDataSetComplete(config))
    || (nodeType === 'ai.generate' && isBlank(config.prompt))) {
    return NOT_CONFIGURED;
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
