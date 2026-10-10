import React, { useState } from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import { NODE_SCHEMAS, schemaTypes } from '../../lib/nodeSchemas';
import { toLocalInput, withLocalOffset } from '../../lib/localOffset';
import type { VariableGroup } from '../../lib/variablePaths';
import { idFromGoogleLink } from '../../lib/googleLinks';
import { MappingTextField } from './MappingTextField';

// The executors reject more than this even where the schema has no maximum.
const INTEGER_CAP: Record<string, number> = { maxLength: 5000 };

const inputCls = 'w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

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
export const SchemaField: React.FC<SchemaFieldProps> = ({ nodeType, name, value, onChange, connections, multiline, groups }) => {
  const { t } = useI18nStore();
  // Text that is not a valid whole number is shown with an error but never written to the config.
  const [badInteger, setBadInteger] = useState<string | null>(null);
  const property = NODE_SCHEMAS[nodeType]?.properties[name];
  if (!property) return null;
  const key = `builder.field.${nodeType}.${name}`;
  const label = t(key) === key ? property.title ?? name : t(key);
  const hint = t(`${key}_hint`) === `${key}_hint` ? undefined : t(`${key}_hint`);
  const id = `field-${nodeType}-${name}`.replace(/\./g, '-');
  const types = schemaTypes(property);
  // An object value (for example a file reference) is shown as JSON, never as "[object Object]".
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  // "none" is itself the no-value choice, so the blank default option would be a duplicate (#46).
  const hasNone = Boolean(property.enum?.includes('none'));

  if (types.includes('boolean')) {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-[11px] font-medium text-text-2">
        <input id={id} data-testid={`field-${name}`} type="checkbox" checked={value === true || value === 'true'} onChange={(event) => onChange(event.target.checked || undefined)} className="h-3.5 w-3.5 accent-primary" />
        {label}
        {hint && <span className="font-normal text-muted-foreground">({hint})</span>}
      </label>
    );
  }

  // A text field that can take data from earlier steps (not a number, list, choice or a stored file object).
  const chipText = Boolean(groups) && Boolean(property['x-weav-template']) && types.includes('string')
    && !types.includes('integer') && property.type !== 'array' && !property.enum && !property['x-weav-connection']
    && (typeof value === 'string' || value === undefined || value === null);

  // Drive file and folder ids also take the pasted Drive link; only the id inside it is saved.
  const takesGoogleLink = nodeType.startsWith('google.') && (name === 'fileId' || name === 'folderId');
  const textValue = (next: string) => (takesGoogleLink ? idFromGoogleLink(next) : next);

  let control: React.ReactNode;
  if (chipText && groups) {
    control = (
      <MappingTextField
        id={id}
        labelledBy={`${id}-label`}
        testId={`field-${name}`}
        multiline={multiline}
        value={text}
        groups={groups}
        onChange={(next) => onChange(next === '' ? undefined : textValue(next))}
      />
    );
  } else if (property['x-weav-connection'] || property.enum) {
    // Friendly option names come from `<key>.<value>`; the saved value stays the raw enum.
    const optionLabel = (option: string) => (t(`${key}.${option}`) === `${key}.${option}` ? option : t(`${key}.${option}`));
    const options = property.enum?.map((option) => ({ id: option, name: optionLabel(option) })) ?? connections ?? [];
    control = (
      <select id={id} data-testid={`field-${name}`} value={hasNone && !text ? 'none' : text} onChange={(event) => onChange(hasNone && event.target.value === 'none' ? undefined : event.target.value || undefined)} className={inputCls}>
        {!hasNone && <option value="">{t(property.enum ? 'builder.field.default' : 'builder.field.select_connection')}</option>}
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        {text && !options.some((option) => option.id === text) && <option value={text}>{property.enum ? text : t('builder.cfg.unavailable_connection')}</option>}
      </select>
    );
  } else if (multiline) {
    control = (
      <textarea id={id} data-testid={`field-${name}`} rows={4} value={text} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)} className={`${inputCls} resize-y`} />
    );
  } else if (property.type === 'array') {
    // "a@x.test, b@x.test" is saved as a list; a mapping stays one string resolved at run time.
    control = (
      <input
        id={id}
        data-testid={`field-${name}`}
        type="text"
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
    const isInteger = types.includes('integer');
    const min = property.minimum ?? 0;
    const max = property.maximum ?? INTEGER_CAP[name];
    const shown = badInteger ?? text;
    const invalid = isInteger && badInteger !== null;
    control = (
      <>
        <input
          id={id}
          data-testid={`field-${name}`}
          type="text"
          inputMode={isInteger ? 'numeric' : undefined}
          maxLength={property.maxLength}
          value={shown}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => {
            const next = event.target.value;
            if (!isInteger || next === '' || next.includes('{{')) {
              setBadInteger(null);
              onChange(next === '' ? undefined : textValue(next));
            } else if (/^(0|[1-9]\d{0,8})$/.test(next) && Number(next) >= min && (max === undefined || Number(next) <= max)) {
              setBadInteger(null);
              onChange(Number(next));
            } else {
              setBadInteger(next);
            }
          }}
          className={`${inputCls} ${property['x-weav-template'] ? 'font-mono' : ''}`}
        />
        {invalid && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-[10px] text-err">
            {t('builder.field.int_invalid').replace('{min}', String(min)).replace('{max}', max === undefined ? '∞' : String(max))}
          </p>
        )}
      </>
    );
  }

  const isCalendarTime = nodeType === 'google.calendar' && (name === 'start' || name === 'end');
  return (
    <div>
      <label id={`${id}-label`} htmlFor={id} onClick={chipText ? () => document.getElementById(id)?.focus() : undefined} className="mb-1 block text-[11px] font-medium text-text-2">{label}</label>
      {isCalendarTime ? (
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">{control}</div>
          <input
            type="datetime-local"
            data-testid={`field-${name}-picker`}
            aria-label={t('builder.field.calendar_pick').replace('{field}', label)}
            value={toLocalInput(text)}
            onChange={(event) => onChange(event.target.value ? withLocalOffset(event.target.value) : undefined)}
            className={`${inputCls} w-auto shrink-0`}
          />
        </div>
      ) : control}
      {hint && <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
};
