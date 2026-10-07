/** Replaces `{name}` placeholders: fill('{n} items', { n: 3 }) -> '3 items'. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
