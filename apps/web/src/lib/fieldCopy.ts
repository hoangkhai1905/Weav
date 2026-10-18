import { NODE_CATALOG } from './constants/nodeCatalog';
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

/** The value a new step starts with for this field: the builder's seeded config, else the schema default. */
const defaultOf = (nodeType: string, name: string): unknown => {
  const seeded = NODE_CATALOG.find((item) => item.type === nodeType)?.defaultConfig ?? {};
  return name in seeded ? seeded[name] : NODE_SCHEMAS[nodeType]?.properties[name]?.default;
};

/** True when any of the fields holds a value other than its default or has an error, so its collapsed section should start open. */
export function hasValueOrError(names: string[], config: Record<string, unknown>, errors: Record<string, string | undefined> | undefined, nodeType: string): boolean {
  return names.some((name) => (hasValue(config[name]) && JSON.stringify(config[name]) !== JSON.stringify(defaultOf(nodeType, name))) || Boolean(errors?.[name]));
}
