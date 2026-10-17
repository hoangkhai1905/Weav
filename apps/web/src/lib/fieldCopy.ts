import { NODE_SCHEMAS } from './nodeSchemas';

export interface FieldCopy { label: string; hint?: string; example?: string }

/** Plain-language copy of a schema field: i18n `builder.field.<type>.<name>[_hint|_example]`, else the schema title. Hints come only from i18n (schema descriptions are English). */
export function fieldCopy(nodeType: string, name: string, t: (key: string) => string): FieldCopy {
  const property = NODE_SCHEMAS[nodeType]?.properties[name];
  const key = `builder.field.${nodeType}.${name}`;
  const find = (suffix: string) => {
    const text = t(`${key}${suffix}`);
    return text === `${key}${suffix}` ? undefined : text;
  };
  return {
    label: find('') ?? property?.title ?? name,
    hint: find('_hint'),
    example: find('_example'),
  };
}

const hasValue = (value: unknown) =>
  !(value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0));

/** True when any of the fields holds a value or has an error, so its collapsed section should start open. */
export function hasValueOrError(names: string[], config: Record<string, unknown>, errors?: Record<string, string | undefined>): boolean {
  return names.some((name) => hasValue(config[name]) || Boolean(errors?.[name]));
}
