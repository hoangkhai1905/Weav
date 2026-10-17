import React, { useState } from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import { NODE_SCHEMAS, schemaTypes } from '../../lib/nodeSchemas';
import { toLocalInput, withLocalOffset } from '../../lib/localOffset';
import type { VariableGroup } from '../../lib/variablePaths';
import { idFromGoogleLink } from '../../lib/googleLinks';
import { MappingTextField } from './MappingTextField';
import { FieldShell } from './FieldShell';
import { fieldCopy } from '../../lib/fieldCopy';
import type { FormatAction, FormatSyntax } from '../../lib/formatInsert';

// The executors reject more than this even where the schema has no maximum.
const INTEGER_CAP: Record<string, number> = {
  maxLength: 5000,
  'format.text.maxLength': 100000,
  'format.text.decimals': 6,
  'format.datetime.amount': 100000,
};

// Per-type lower bounds where the schema's oneOf hides the minimum from the field itself.
const INTEGER_MIN: Record<string, number> = {
  'format.datetime.amount': -100000,
  'format.text.maxLength': 1,
};

// Chat steps whose text field understands Markdown: the field is edited visually with format buttons (email and Telegram have their own).
const FORMAT_FIELDS: Record<string, { name: string; syntax: FormatSyntax; actions: FormatAction[] }> = {
  'discord.send_message': { name: 'content', syntax: 'markdown', actions: ['bold', 'italic', 'link', 'list'] },
  'slack.send_message': { name: 'text', syntax: 'slack', actions: ['bold', 'italic', 'link'] },
  'teams.send_message': { name: 'text', syntax: 'teams', actions: ['bold', 'italic', 'link', 'list'] },
};

const inputCls = 'w-full rounded-md border border-border-strong bg-card px-3 py-2 text-[13px] text-foreground outline-none hover:border-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring';

interface SchemaFieldProps {
  nodeType: string;
  name: string;
  value: unknown;
  /** `undefined` removes the key, so optional fields stay out of the saved config. */
  onChange: (value: unknown) => void;
  /** Options for an `x-weav-connection` field. */
  connections?: { id: string; name: string }[];
  /** Render a text field as a textarea (prompts, file content, descriptions). */
  multiline?: boolean;
  /** Overrides the schema's required list (the builder passes the readiness rule). */
  required?: boolean;
  /** Data from the steps before: a template text field then shows inserted data as named chips. */
  groups?: VariableGroup[];
}

/**
 * One node config field rendered from its JSON Schema property (packages/workflow-schema/README.md):
 * enum → select, boolean → checkbox, integer → number-or-mapping text, array of strings → comma list,
 * anything else → text.
 * Labels come from `builder.field.<type>.<name>` (fallback: schema title); `..._hint` adds help text;
 * enum options use `builder.field.<type>.<name>.<value>` (fallback: the raw value).
 */
export const SchemaField: React.FC<SchemaFieldProps> = ({ nodeType, name, value, onChange, connections, multiline, groups, required: requiredProp }) => {
  const { t } = useI18nStore();
  // Text that is not a valid whole number is shown with an error but never written to the config.
  const [badInteger, setBadInteger] = useState<string | null>(null);
  // Whether a number field takes data from an earlier step instead of a typed number; null = follow the stored value.
  const [dataMode, setDataMode] = useState<boolean | null>(null);
  // What the user typed in a list field: the stored list is re-joined with ", ", which would move the caret.
  const [listDraft, setListDraft] = useState<string | null>(null);
  const property = NODE_SCHEMAS[nodeType]?.properties[name];
  if (!property) return null;
  const key = `builder.field.${nodeType}.${name}`;
  const { label, hint, example } = fieldCopy(nodeType, name, t);
  const placeholder = example ? `${t('builder.field.example_prefix')}${example}` : undefined;
  const required = requiredProp ?? NODE_SCHEMAS[nodeType].required.includes(name);
  const id = `field-${nodeType}-${name}`.replace(/\./g, '-');
  const types = schemaTypes(property);
  // An object value (for example a file reference) is shown as JSON, never as "[object Object]".
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  // "none" is itself the no-value choice, so the blank default option would be a duplicate (#46).
  const hasNone = Boolean(property.enum?.includes('none'));

  if (types.includes('boolean')) {
    return (
      // A checkbox keeps its label beside the box, so it does not use FieldShell's label-above layout.
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          <input id={id} data-testid={`field-${name}`} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} checked={value === true || value === 'true'} onChange={(event) => onChange(event.target.checked || undefined)} className="h-3.5 w-3.5 accent-primary" />
          {label}
        </label>
        {hint && <p id={`${id}-hint`} className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
    );
  }

  // A string-or-unbounded-integer field (format.datetime value: a date, or epoch milliseconds) is free text.
  const freeText = Boolean(property.oneOf?.some((branch) => branch.type === 'string'))
    && Boolean(property.oneOf?.some((branch) => branch.type === 'integer' && branch.minimum === undefined && branch.maximum === undefined));
  const isInteger = types.includes('integer') && !freeText;
  const takesData = Boolean(groups) && Boolean(property['x-weav-template']) && !property.enum && !property['x-weav-connection'];
  // A number field keeps a typed number by default; "Dùng dữ liệu từ bước trước" turns it into a data field.
  const numberWithData = takesData && isInteger && property.type !== 'array';
  const useData = numberWithData && (dataMode ?? (typeof value === 'string' && value.includes('{{')));
  // A comma separated list that can take data: shown as text, saved as a list unless it holds a mapping.
  const listText = takesData && types.includes('array') && !types.includes('object');
  // A text field that can take data from earlier steps (not a list, choice or a stored file object).
  const chipText = takesData && !listText && property.type !== 'array'
    && (useData || (types.includes('string') && !isInteger))
    && (useData || typeof value === 'string' || value === undefined || value === null || (freeText && typeof value === 'number'));

  // Drive file and folder ids also take the pasted Drive link; only the id inside it is saved.
  const takesGoogleLink = nodeType.startsWith('google.') && (name === 'fileId' || name === 'folderId');
  const textValue = (next: string) => (takesGoogleLink ? idFromGoogleLink(next) : next);

  let error: string | undefined;
  let control: (a11y: { id: string; describedBy?: string }) => React.ReactNode;
  if (chipText && groups) {
    control = ({ describedBy }) => (
      <MappingTextField
        id={id}
        labelledBy={`${id}-label`}
        describedBy={describedBy}
        required={required}
        placeholder={placeholder}
        testId={`field-${name}`}
        multiline={multiline}
        value={text}
        groups={groups}
        format={FORMAT_FIELDS[nodeType]?.name === name ? { syntax: FORMAT_FIELDS[nodeType].syntax, actions: FORMAT_FIELDS[nodeType].actions, rich: true } : undefined}
        onChange={(next) => onChange(next === '' ? undefined : textValue(next))}
      />
    );
  } else if (listText && groups) {
    control = ({ describedBy }) => (
      <MappingTextField
        id={id}
        labelledBy={`${id}-label`}
        describedBy={describedBy}
        required={required}
        placeholder={placeholder}
        testId={`field-${name}`}
        multiline={multiline}
        value={listDraft ?? text}
        groups={groups}
        onChange={(next) => {
          setListDraft(next);
          // "a@x.test, b@x.test" is saved as a list; a mapping stays one string resolved at run time.
          onChange(next.trim() === '' ? undefined : next.includes('{{') ? next : next.split(',').map((item) => item.trim()));
        }}
      />
    );
  } else if (property['x-weav-connection'] || property.enum) {
    // Friendly option names come from `<key>.<value>`; the saved value stays the raw enum.
    const optionLabel = (option: string) => (t(`${key}.${option}`) === `${key}.${option}` ? option : t(`${key}.${option}`));
    const options = property.enum?.map((option) => ({ id: option, name: optionLabel(option) })) ?? connections ?? [];
    control = ({ describedBy }) => (
      <select id={id} data-testid={`field-${name}`} aria-describedby={describedBy} aria-required={required || undefined} value={hasNone && !text ? 'none' : text} onChange={(event) => onChange(hasNone && event.target.value === 'none' ? undefined : event.target.value || undefined)} className={inputCls}>
        {!hasNone && <option value="">{t(property.enum ? 'builder.field.default' : 'builder.field.select_connection')}</option>}
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        {text && !options.some((option) => option.id === text) && <option value={text}>{property.enum ? text : t('builder.cfg.unavailable_connection')}</option>}
      </select>
    );
  } else if (multiline) {
    control = ({ describedBy }) => (
      <textarea id={id} data-testid={`field-${name}`} aria-describedby={describedBy} aria-required={required || undefined} placeholder={placeholder} rows={4} value={text} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)} className={`${inputCls} resize-y`} />
    );
  } else if (property.type === 'array') {
    // "a@x.test, b@x.test" is saved as a list; a mapping stays one string resolved at run time.
    control = ({ describedBy }) => (
      <input
        id={id}
        data-testid={`field-${name}`}
        type="text"
        aria-describedby={describedBy}
        aria-required={required || undefined}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next.trim() === '' ? undefined : next.includes('{{') ? next : next.split(',').map((item) => item.trim()));
        }}
        className={`${inputCls} font-mono`}
      />
    );
  } else {
    // Integer fields also take a mapping such as {{ trigger.input.id }}. Plain digits within the schema range
    // are saved as a number; a mapping stays text; anything else is flagged and not saved.
    // A string-or-unbounded-integer field (format.datetime value: a date, or epoch milliseconds) is free text.
    const min = property.minimum ?? INTEGER_MIN[`${nodeType}.${name}`] ?? 0;
    const max = property.maximum ?? INTEGER_CAP[`${nodeType}.${name}`] ?? INTEGER_CAP[name];
    const shown = badInteger ?? text;
    const invalid = isInteger && badInteger !== null;
    if (invalid) error = t('builder.field.int_invalid').replace('{min}', String(min)).replace('{max}', max === undefined ? '∞' : String(max));
    control = ({ describedBy }) => (
        <input
          id={id}
          data-testid={`field-${name}`}
          type="text"
          placeholder={placeholder}
          aria-required={required || undefined}
          inputMode={isInteger ? 'numeric' : undefined}
          maxLength={property.maxLength}
          value={shown}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            const next = event.target.value;
            if (!isInteger || next === '' || next.includes('{{')) {
              setBadInteger(null);
              onChange(next === '' ? undefined : textValue(next));
            } else if ((min < 0 ? /^(0|-?[1-9]\d{0,8})$/ : /^(0|[1-9]\d{0,8})$/).test(next) && Number(next) >= min && (max === undefined || Number(next) <= max)) {
              setBadInteger(null);
              onChange(Number(next));
            } else {
              setBadInteger(next);
            }
          }}
          className={`${inputCls} ${property['x-weav-template'] ? 'font-mono' : ''}`}
        />
    );
  }

  const isCalendarTime = nodeType === 'google.calendar' && (name === 'start' || name === 'end');
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      {(a11y) => isCalendarTime ? (
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">{control(a11y)}</div>
          <input
            type="datetime-local"
            data-testid={`field-${name}-picker`}
            aria-label={t('builder.field.calendar_pick').replace('{field}', label)}
            value={toLocalInput(text)}
            onChange={(event) => onChange(event.target.value ? withLocalOffset(event.target.value) : undefined)}
            className={`${inputCls} w-auto shrink-0`}
          />
        </div>
      ) : numberWithData ? (
        <div className="space-y-1.5">
          {control(a11y)}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              data-testid={`field-${name}-use-data`}
              checked={useData}
              onChange={(event) => {
                setBadInteger(null);
                setDataMode(event.target.checked);
                // Leaving data mode drops the mapping: it is not a number.
                if (!event.target.checked && typeof value === 'string') onChange(undefined);
              }}
              className="h-3.5 w-3.5 accent-primary"
            />
            {t('builder.field.use_data')}
          </label>
        </div>
      ) : control(a11y)}
    </FieldShell>
  );
};
