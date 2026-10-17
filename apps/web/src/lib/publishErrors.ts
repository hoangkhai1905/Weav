import { fieldCopy } from './fieldCopy';
import { nodeLabel } from './nodeLabels';

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

export interface IssueStep { id: string; type: string; name: string }

const NODE_FIELD = /^nodes\[(.+?)\]\.(.*)$/;
// Top-level config field of a detail path: `nodes[a].config.cases[0].value` -> `cases`.
const topField = (path: string) => /^config\.([^.[]+)/.exec(path)?.[1] ?? '';

/** Maps each detail to a step id (when it names one) and Vietnamese text: the step's name, the field's label, the meaning. */
export function describeIssues(details: WorkflowErrorDetail[], t: (key: string) => string, steps: ReadonlyArray<IssueStep>): WorkflowIssue[] {
  return details.map((detail) => {
    const code = /^([A-Z][A-Z_]+):/.exec(detail.message ?? '')?.[1] ?? '';
    const meaning = KNOWN_CODES.has(code) ? t(`builder.err.${code}`) : t('builder.err.generic');
    const match = NODE_FIELD.exec(detail.field ?? '');
    if (!match) return { text: meaning };
    const step = steps.find((item) => item.id === match[1]);
    const name = topField(match[2]);
    const label = name ? fieldCopy(step?.type ?? '', name, t).label : '';
    const detailText = !label ? meaning
      : code === 'REQUIRED_FIELD_MISSING' ? t('builder.err.required_field').replace('{field}', label)
        : `'${label}' — ${meaning}`;
    return { nodeId: match[1], text: `${t('builder.err.step_named').replace('{step}', step?.name || (step ? nodeLabel(step.type, t) : match[1]))}: ${detailText}` };
  });
}

/** Issue texts by step id and top-level config field, so the inspector can open a section holding a field with an error. */
export function fieldErrorsByStep(details: WorkflowErrorDetail[], issues: WorkflowIssue[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  details.forEach((detail, index) => {
    const match = NODE_FIELD.exec(detail.field ?? '');
    const name = match ? topField(match[2]) : '';
    if (match && name) (out[match[1]] ??= {})[name] = issues[index].text;
  });
  return out;
}
