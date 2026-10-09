import { NODE_SCHEMAS } from '../../lib/nodeSchemas';

export const dialogBtn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const dialogPrimaryBtn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const dialogField = 'w-full rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';

export const nodeDot = (type: string) => {
  if (type.startsWith('trigger.')) return 'bg-t-trigger';
  if (type.startsWith('ai.')) return 'bg-t-ai';
  if (type.startsWith('logic.') || type.startsWith('data.')) return 'bg-t-logic';
  return 'bg-t-action';
};

/** How many of these node types need a connection picked again after the copy. */
export const connectionCount = (types: string[]) =>
  types.filter((type) => NODE_SCHEMAS[type]?.required.includes('connectionId')).length;
