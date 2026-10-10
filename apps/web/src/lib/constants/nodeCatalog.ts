import type { NodeCatalogItem } from '../../types/workflow.types';
import { isReferenceableName } from '../mappingGrammar';

export const NODE_CATALOG: NodeCatalogItem[] = [
  {
    type: 'trigger.manual',
    title: 'Manual Trigger',
    description: 'Run the workflow manually with JSON input.',
    category: 'trigger',
    iconName: 'Play',
    defaultConfig: { buttonLabel: 'Run Now' },
    inputs: [],
    // Free-form JSON typed at run time: no fixed keys (the picker asks for the key name).
    outputs: [],
  },
  {
    type: 'trigger.schedule',
    title: 'Schedule (Cron)',
    description: 'Run the workflow on a Spring six-field cron schedule.',
    category: 'trigger',
    iconName: 'Clock',
    defaultConfig: { cron: '0 0 9 * * *', timezone: 'Asia/Ho_Chi_Minh' },
    inputs: [],
    outputs: [{ name: 'scheduledAt', type: 'string' }], // keys under trigger.input
  },
  {
    type: 'trigger.webhook',
    title: 'Webhook Trigger',
    description: 'Receive JSON input at a system-provisioned webhook endpoint.',
    category: 'trigger',
    iconName: 'Webhook',
    // The schema has no settings: any key (even method) is UNKNOWN_CONFIG_FIELD.
    defaultConfig: {},
    inputs: [],
    // The JSON body of the request: free-form, no fixed keys.
    outputs: [],
  },
  {
    type: 'trigger.telegram',
    title: 'Telegram Bot Event',
    description: "Starts the workflow when the workspace's Telegram bot receives a text message.",
    category: 'trigger',
    iconName: 'Send',
    defaultConfig: {},
    inputs: [],
    // Keys under trigger.input (TelegramUpdate).
    outputs: [
      { name: 'updateId', type: 'number' },
      { name: 'message.text', type: 'string' },
      { name: 'message.messageId', type: 'number' },
      { name: 'message.date', type: 'number' },
      { name: 'message.chat.id', type: 'number' },
      { name: 'message.chat.type', type: 'string' },
      { name: 'message.from.id', type: 'number' },
      { name: 'message.from.username', type: 'string' },
      { name: 'message.from.firstName', type: 'string' },
      // A photo or document sent to the bot, stored as a workspace file (absent when there is none; `skipped` when it could not be stored).
      { name: 'file', type: 'object' },
      { name: 'file.fileId', type: 'string' },
      { name: 'file.filename', type: 'string' },
      { name: 'file.mimeType', type: 'string' },
      { name: 'file.size', type: 'number' },
    ],
  },
  {
    type: 'http.request',
    title: 'HTTP Request',
    description: 'Send an outbound HTTP request using Workflow V1 controls.',
    category: 'action',
    iconName: 'Globe',
    defaultConfig: { method: 'GET', url: '', headers: {}, query: {}, body: '' },
    inputs: [{ name: 'input', type: 'any' }],
    outputs: [{ name: 'status', type: 'number' }, { name: 'data', type: 'any' }],
  },
  {
    type: 'email.send',
    title: 'Send Email (Gmail)',
    description: 'Send an email (text or HTML, cc/bcc, attachments) from an authorized Gmail connection.',
    category: 'action',
    iconName: 'Mail',
    defaultConfig: { to: '', subject: '', body: '' },
    inputs: [{ name: 'data', type: 'any' }],
    outputs: [{ name: 'messageId', type: 'string' }, { name: 'status', type: 'string' }],
  },
  {
    type: 'google.sheets',
    title: 'Google Sheets',
    description: 'Read, write or look up spreadsheet rows using an authorized Workspace connection.',
    category: 'action',
    iconName: 'FileSpreadsheet',
    // No connectionId until one is picked: an empty string is INVALID_CONNECTION_ID on draft save.
    defaultConfig: {
      operation: 'read',
      spreadsheetId: '',
      // No sheet name: Google uses the first tab, whatever its localized name ("Sheet1", "Trang tính1").
      range: 'A1:Z100',
    },
    inputs: [{ name: 'data', type: 'any' }],
    outputs: [], // depends on the operation: see nodeOutputPaths
  },
  {
    type: 'telegram.send_message',
    title: 'Telegram Send Message',
    description: "Send a message through the workspace's Telegram bot.",
    category: 'action',
    iconName: 'Send',
    defaultConfig: { chatId: '', text: '' },
    inputs: [{ name: 'text', type: 'string' }],
    outputs: [{ name: 'messageId', type: 'number' }, { name: 'chatId', type: 'number' }],
  },
  {
    type: 'logic.condition',
    title: 'If / Condition',
    description: 'Compare values (one condition or several combined with AND/OR) and route through true or false.',
    category: 'logic',
    iconName: 'GitBranch',
    defaultConfig: { left: '', operator: 'eq', right: '' },
    inputs: [{ name: 'value', type: 'any' }],
    outputs: [{ name: 'value', type: 'boolean' }],
    sourcePorts: [
      { id: 'true', label: 'True' },
      { id: 'false', label: 'False' },
    ],
  },
  {
    type: 'ai.extract',
    title: 'AI Structured Extract',
    description: 'Extract structured JSON from text with an output schema.',
    category: 'ai',
    iconName: 'Sparkles',
    defaultConfig: {},
    inputs: [{ name: 'text', type: 'string' }],
    outputs: [], // the keys of the configured output schema: see nodeOutputPaths
  },
  {
    type: 'ai.classify',
    title: 'AI Text Classifier',
    description: 'Pick one of your categories for a text.',
    category: 'ai',
    iconName: 'Tags',
    defaultConfig: { categories: [] },
    inputs: [{ name: 'content', type: 'string' }],
    outputs: [{ name: 'category', type: 'string' }, { name: 'confidence', type: 'number' }],
  },
  {
    type: 'ai.summarize',
    title: 'AI Summarizer',
    description: 'Summarize text within a character limit.',
    category: 'ai',
    iconName: 'FileText',
    defaultConfig: { maxLength: 200 },
    inputs: [{ name: 'inputText', type: 'string' }],
    outputs: [{ name: 'summary', type: 'string' }, { name: 'truncated', type: 'boolean' }],
  },
  {
    type: 'trigger.gmail',
    title: 'New Gmail email',
    description: 'Start the workflow when a Gmail search finds a new email.',
    category: 'trigger',
    iconName: 'Inbox',
    defaultConfig: { pollIntervalMinutes: 5 },
    inputs: [],
    // Keys under trigger.input (GmailMessageParser; fromEmail/fromName are added by W5-D, `from` stays).
    outputs: [
      { name: 'messageId', type: 'string' },
      { name: 'threadId', type: 'string' },
      { name: 'from', type: 'string' },
      { name: 'fromEmail', type: 'string' },
      { name: 'fromName', type: 'string' },
      { name: 'to', type: 'string' },
      { name: 'cc', type: 'string' },
      { name: 'subject', type: 'string' },
      { name: 'date', type: 'string' },
      { name: 'snippet', type: 'string' },
      { name: 'body', type: 'string' },
      { name: 'labelIds', type: 'array' },
      { name: 'attachments', type: 'array' },
      // The whole first attachment is what a file source ({{ trigger.input.attachments[0] }}) takes.
      { name: 'attachments[0]', type: 'object' },
      { name: 'attachments[0].filename', type: 'string' },
      { name: 'attachments[0].mimeType', type: 'string' },
      { name: 'attachments[0].size', type: 'number' },
      { name: 'attachments[0].fileId', type: 'string' },
    ],
  },
  {
    type: 'google.drive',
    title: 'Google Drive',
    description: 'Upload, download or list files in Google Drive.',
    category: 'action',
    iconName: 'HardDrive',
    defaultConfig: { operation: 'upload' },
    inputs: [{ name: 'data', type: 'any' }],
    outputs: [], // depends on the operation: see nodeOutputPaths
  },
  {
    type: 'google.calendar',
    title: 'Google Calendar',
    description: 'Create or list Google Calendar events.',
    category: 'action',
    iconName: 'CalendarDays',
    defaultConfig: { operation: 'create' },
    inputs: [{ name: 'data', type: 'any' }],
    outputs: [], // depends on the operation: see nodeOutputPaths
  },
  {
    type: 'logic.switch',
    title: 'Switch',
    description: 'Route to the branch whose case equals the value, else default.',
    category: 'logic',
    iconName: 'Split',
    defaultConfig: { value: '', cases: [] },
    inputs: [{ name: 'value', type: 'any' }],
    outputs: [{ name: 'value', type: 'string' }, { name: 'port', type: 'string' }],
    // The case ports come from config.cases (nodeSourcePorts); "default" always exists.
    sourcePorts: [{ id: 'default', label: 'Default' }],
  },
  {
    type: 'data.set',
    title: 'Set data',
    description: 'Build named values from literals and mappings for later steps.',
    category: 'logic',
    iconName: 'Braces',
    defaultConfig: { fields: {} },
    inputs: [{ name: 'data', type: 'any' }],
    outputs: [], // the configured field names themselves: see nodeOutputPaths
  },
  {
    type: 'ai.generate',
    title: 'Generate text with AI',
    description: 'Write text from a prompt and optional instructions.',
    category: 'ai',
    iconName: 'WandSparkles',
    defaultConfig: { prompt: '' },
    inputs: [{ name: 'prompt', type: 'string' }],
    outputs: [{ name: 'text', type: 'string' }],
  },
  {
    type: 'ocr.extract',
    title: 'OCR Text Extract',
    description: 'Workflow OCR execution is unavailable until service and artifact prerequisites are verified.',
    category: 'ocr',
    iconName: 'Scan',
    // Table models make CPU OCR ~40x slower: new steps leave them off. A saved config without the key keeps the server default (on).
    defaultConfig: { language: 'vi+en', detectTables: false },
    inputs: [{ name: 'artifactId', type: 'string' }, { name: 'fileUrl', type: 'string' }, { name: 'file', type: 'object' }],
    // The OCR service response as is (OcrClient.validateSuccess): the text lives under text.rawText.
    outputs: [
      { name: 'text.rawText', type: 'string' },
      { name: 'document.pages', type: 'number' },
      { name: 'confidence', type: 'number' },
      { name: 'blocks', type: 'array' },
      { name: 'tables', type: 'array' },
    ],
  },
];

/** Output ports of a step: logic.switch has one per case plus "default"; others use the catalog. */
export const nodeSourcePorts = (type: string, config: Record<string, unknown>): Array<{ id: string; label: string }> | undefined => {
  if (type === 'logic.switch') {
    const cases = Array.isArray(config.cases) ? config.cases.filter((item): item is string => typeof item === 'string' && item.trim() !== '' && item !== 'default') : [];
    return [...new Set(cases)].map((item) => ({ id: item, label: item })).concat({ id: 'default', label: 'Default' });
  }
  return NODE_CATALOG.find((item) => item.type === type)?.sourcePorts;
};

const OUTPUTS_BY_OPERATION: Record<string, Record<string, string[]>> = {
  'google.sheets': {
    read: ['range', 'majorDimension', 'values'],
    lookup: ['range', 'rows', 'count', 'truncated', 'rows[0].row', 'rows[0].values'],
    append: ['spreadsheetId', 'tableRange', 'updates.updatedRange', 'updates.updatedRows', 'updates.updatedCells'],
    update: ['spreadsheetId', 'updatedRange', 'updatedRows', 'updatedColumns', 'updatedCells'],
  },
  'google.drive': {
    upload: ['id', 'name', 'mimeType', 'webViewLink'],
    list: ['files', 'files[0].id', 'files[0].name', 'files[0].mimeType', 'files[0].webViewLink'],
    // `file` is the whole downloaded file, usable as the file source of a later step (for example OCR).
    download: ['file', 'file.fileId', 'file.filename', 'file.mimeType', 'file.size'],
  },
  'google.calendar': {
    create: ['eventId', 'htmlLink', 'status', 'start', 'end'],
    list: ['events', 'count', 'truncated', 'events[0].id', 'events[0].summary', 'events[0].start', 'events[0].end', 'events[0].htmlLink'],
  },
};
const DEFAULT_OPERATION: Record<string, string> = { 'google.sheets': 'read', 'google.drive': 'upload', 'google.calendar': 'create' };

/**
 * Paths a later step can read under `nodes.<id>.output.` (steps) or `trigger.input.` (triggers), taken
 * from what each executor really returns. data.set and ai.extract expose their configured keys.
 */
export const nodeOutputPaths = (type: string, config: Record<string, unknown>): string[] => {
  const byOperation = OUTPUTS_BY_OPERATION[type];
  if (byOperation) return byOperation[String(config.operation ?? DEFAULT_OPERATION[type])] ?? [];
  if (type === 'data.set') {
    const fields = config.fields;
    return typeof fields === 'object' && fields !== null && !Array.isArray(fields) ? Object.keys(fields).filter(isReferenceableName) : [];
  }
  if (type === 'ai.extract') {
    const schema = config.outputSchema as { properties?: Record<string, unknown> } | undefined;
    return Object.keys(schema?.properties ?? {}).filter(isReferenceableName);
  }
  return NODE_CATALOG.find((item) => item.type === type)?.outputs.map((output) => output.name) ?? [];
};

const NODE_ID_PREFIX: Record<string, string> = {
  'trigger.manual': 'manual',
  'trigger.schedule': 'schedule',
  'trigger.webhook': 'webhook',
  'trigger.telegram': 'telegram_trigger',
  'trigger.gmail': 'gmail_trigger',
  'http.request': 'http',
  'email.send': 'send_email',
  'google.sheets': 'sheets',
  'google.drive': 'drive',
  'google.calendar': 'calendar',
  'telegram.send_message': 'telegram_send',
  'logic.condition': 'condition',
  'logic.switch': 'switch',
  'data.set': 'data',
  'ai.extract': 'extract',
  'ai.classify': 'classify',
  'ai.summarize': 'summarize',
  'ai.generate': 'generate',
  'ocr.extract': 'ocr',
};

/**
 * A readable unique id for a new step (`http_1`, `send_email_2`). Existing ids are never changed, and a number
 * is never handed out twice in a session (`marks`), so a mapping left behind by a deleted step cannot
 * silently bind to a new one. `marks` is seeded from the ids already present.
 */
export const nextNodeId = (type: string, usedIds: ReadonlySet<string>, marks: Record<string, number> = {}): string => {
  const prefix = NODE_ID_PREFIX[type] ?? type.replace(/[^a-zA-Z0-9]+/g, '_');
  let n = marks[prefix] ?? 0;
  usedIds.forEach((id) => {
    const match = id.startsWith(`${prefix}_`) ? /^\d+$/.exec(id.slice(prefix.length + 1)) : null;
    if (match) n = Math.max(n, Number(match[0]));
  });
  n += 1;
  while (usedIds.has(`${prefix}_${n}`)) n += 1;
  marks[prefix] = n;
  return `${prefix}_${n}`;
};
