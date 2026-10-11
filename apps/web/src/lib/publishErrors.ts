// Turns the Workflow Service validation details (`field` + "CODE: English message") into Vietnamese
// text tied to a step, so the builder never shows the raw English "Workflow definition is invalid".

export interface WorkflowErrorDetail { field?: string; message?: string }
export interface WorkflowIssue { nodeId?: string; text: string }

const KNOWN_CODES = new Set([
  'TRIGGER_REQUIRED', 'MANUAL_TRIGGER_REQUIRED', 'MULTIPLE_MANUAL_TRIGGERS', 'MAPPING_ERROR', 'INVALID_URL',
  'NUMERIC_OPERAND_REQUIRED', 'REQUIRED_FIELD_MISSING', 'UNKNOWN_CONFIG_FIELD', 'INVALID_FIELD_TYPE',
  'INVALID_CONNECTION_ID', 'CREDENTIAL_FIELD_NOT_ALLOWED', 'CYCLE_DETECTED', 'UNREACHABLE_NODE',
  'TRIGGER_HAS_INCOMING_EDGE', 'INVALID_SOURCE_PORT', 'DANGLING_EDGE', 'OCR_SOURCE_CONFLICT', 'OCR_SOURCE_REQUIRED',
  'INVALID_HTTP_METHOD', 'INVALID_SWITCH_CASES', 'INVALID_DATA_SET_FIELDS', 'INVALID_CONDITIONS',
  'INVALID_CONDITION_OPERATOR', 'INVALID_ENUM_VALUE', 'INVALID_LOOKUP_COLUMN', 'DUPLICATE_NODE_ID',
  'CONDITION_FORM_CONFLICT', 'URL_USERINFO_NOT_ALLOWED', 'INVALID_SHEETS_OPERATION', 'INVALID_CONDITION_COMBINATOR',
  'INVALID_CRON', 'INVALID_TIMEZONE', 'SCHEDULE_VALIDATION_UNAVAILABLE', 'INVALID_DATETIME_PATTERN',
]);

/** Maps each detail to a step id (when it names one) and Vietnamese text (`builder.err.<CODE>`, else generic). */
export function describeIssues(details: WorkflowErrorDetail[], t: (key: string) => string): WorkflowIssue[] {
  return details.map((detail) => {
    const code = /^([A-Z][A-Z_]+):/.exec(detail.message ?? '')?.[1] ?? '';
    const meaning = KNOWN_CODES.has(code) ? t(`builder.err.${code}`) : t('builder.err.generic');
    const match = /^nodes\[(.+?)\]\.(.*)$/.exec(detail.field ?? '');
    if (!match) return { text: meaning };
    const field = match[2].replace(/^config\./, '').replace(/^config$/, '');
    return { nodeId: match[1], text: `${t('builder.err.step').replace('{id}', match[1])}${field ? ` · ${field}` : ''}: ${meaning}` };
  });
}
