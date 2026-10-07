// Node config schemas shared with workflow-service (packages/workflow-schema/nodes/<type>.json).
// The inspector renders the newer, simpler fields from these instead of hand-writing each one.

export interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  oneOf?: SchemaProperty[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  'x-weav-template'?: boolean;
  'x-weav-connection'?: { provider: string };
}

export interface NodeSchema {
  title: string;
  properties: Record<string, SchemaProperty>;
  required: string[];
}

const modules = import.meta.glob<NodeSchema>('../../../../packages/workflow-schema/nodes/*.json', { eager: true, import: 'default' });

export const NODE_SCHEMAS: Record<string, NodeSchema> = Object.fromEntries(
  Object.entries(modules).map(([path, schema]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), schema]),
);

/** The JSON types a property accepts, flattening `oneOf`. */
export const schemaTypes = (property: SchemaProperty): string[] =>
  property.oneOf ? property.oneOf.flatMap(schemaTypes) : property.type ? [property.type] : [];
