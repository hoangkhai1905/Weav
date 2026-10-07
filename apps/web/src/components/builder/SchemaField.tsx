import React from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import { NODE_SCHEMAS, schemaTypes } from '../../lib/nodeSchemas';

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
}

/**
 * One node config field rendered from its JSON Schema property (packages/workflow-schema/README.md):
 * enum → select, boolean → checkbox, integer → number-or-mapping text, array of strings → comma list,
 * anything else → text.
 * Labels come from `builder.field.<type>.<name>` (fallback: schema title); `..._hint` adds help text;
 * enum options use `builder.field.<type>.<name>.<value>` (fallback: the raw value).
 */
export const SchemaField: React.FC<SchemaFieldProps> = ({ nodeType, name, value, onChange, connections, multiline }) => {
  const { t } = useI18nStore();
  const property = NODE_SCHEMAS[nodeType]?.properties[name];
  if (!property) return null;
  const key = `builder.field.${nodeType}.${name}`;
  const label = t(key) === key ? property.title ?? name : t(key);
  const hint = t(`${key}_hint`) === `${key}_hint` ? undefined : t(`${key}_hint`);
  const id = `field-${nodeType}-${name}`.replace(/\./g, '-');
  const types = schemaTypes(property);
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');

  if (types.includes('boolean')) {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-[11px] font-medium text-text-2">
        <input id={id} data-testid={`field-${name}`} type="checkbox" checked={value === true || value === 'true'} onChange={(event) => onChange(event.target.checked || undefined)} className="h-3.5 w-3.5 accent-primary" />
        {label}
        {hint && <span className="font-normal text-muted-foreground">({hint})</span>}
      </label>
    );
  }

  let control: React.ReactNode;
  if (property['x-weav-connection'] || property.enum) {
    // Friendly option names come from `<key>.<value>`; the saved value stays the raw enum.
    const optionLabel = (option: string) => (t(`${key}.${option}`) === `${key}.${option}` ? option : t(`${key}.${option}`));
    const options = property.enum?.map((option) => ({ id: option, name: optionLabel(option) })) ?? connections ?? [];
    control = (
      <select id={id} data-testid={`field-${name}`} value={text} onChange={(event) => onChange(event.target.value || undefined)} className={inputCls}>
        <option value="">{t(property.enum ? 'builder.field.default' : 'builder.field.select_connection')}</option>
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
    // Integer fields also take a mapping such as {{ trigger.input.id }}; plain digits are saved as a number.
    const isInteger = types.includes('integer');
    control = (
      <input
        id={id}
        data-testid={`field-${name}`}
        type="text"
        inputMode={isInteger ? 'numeric' : undefined}
        maxLength={property.maxLength}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === '' ? undefined : isInteger && /^\d+$/.test(next) ? Number(next) : next);
        }}
        className={`${inputCls} ${property['x-weav-template'] ? 'font-mono' : ''}`}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-text-2">{label}</label>
      {control}
      {hint && <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
};
