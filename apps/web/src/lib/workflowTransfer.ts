/** Pure helpers for the workflow JSON export/import file (format "weav.workflow", version 1). */

export const WORKFLOW_FILE_FORMAT = 'weav.workflow';
export const WORKFLOW_FILE_VERSION = 1;
export const WORKFLOW_FILE_MAX_BYTES = 1024 * 1024;

export interface WorkflowFile {
  format: typeof WORKFLOW_FILE_FORMAT;
  version: typeof WORKFLOW_FILE_VERSION;
  exportedAt: string;
  name: string;
  description: string | null;
  definition: { nodes: unknown[]; edges: unknown[]; [key: string]: unknown };
  editorState: Record<string, unknown> | null;
}

export type WorkflowFileErrorKey =
  | 'workflows.transfer.err.too_large'
  | 'workflows.transfer.err.not_json'
  | 'workflows.transfer.err.format'
  | 'workflows.transfer.err.version'
  | 'workflows.transfer.err.definition'
  | 'workflows.transfer.err.name';

export const WORKFLOW_DESCRIPTION_MAX = 2000;

export type ParsedWorkflowFile = { ok: true; file: WorkflowFile } | { ok: false; error: WorkflowFileErrorKey };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function buildWorkflowFile(
  workflow: { name: string; description?: string | null },
  preview: { definition: unknown; editorState: unknown },
  exportedAt = new Date(),
): WorkflowFile {
  return {
    format: WORKFLOW_FILE_FORMAT,
    version: WORKFLOW_FILE_VERSION,
    exportedAt: exportedAt.toISOString(),
    name: workflow.name,
    description: workflow.description || null,
    definition: preview.definition as WorkflowFile['definition'],
    editorState: (preview.editorState as WorkflowFile['editorState']) ?? null,
  };
}

export function workflowFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `weav-${slug || 'workflow'}.json`;
}

export function parseWorkflowFile(text: string, sizeBytes = text.length): ParsedWorkflowFile {
  if (sizeBytes > WORKFLOW_FILE_MAX_BYTES) return { ok: false, error: 'workflows.transfer.err.too_large' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'workflows.transfer.err.not_json' };
  }
  if (!isRecord(data) || data.format !== WORKFLOW_FILE_FORMAT) return { ok: false, error: 'workflows.transfer.err.format' };
  if (data.version !== WORKFLOW_FILE_VERSION) return { ok: false, error: 'workflows.transfer.err.version' };
  const { definition } = data;
  if (!isRecord(definition) || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    return { ok: false, error: 'workflows.transfer.err.definition' };
  }
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name.length < 1 || name.length > 255) return { ok: false, error: 'workflows.transfer.err.name' };
  return {
    ok: true,
    file: {
      format: WORKFLOW_FILE_FORMAT,
      version: WORKFLOW_FILE_VERSION,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      name,
      description: typeof data.description === 'string' && data.description.trim() ? data.description : null,
      definition: definition as WorkflowFile['definition'],
      editorState: isRecord(data.editorState) ? data.editorState : null,
    },
  };
}

/** Name of the created copy: "<name> (imported)" trimmed to the 255-char workflow name limit. */
export function importedWorkflowName(name: string, suffix: string): string {
  const tail = ` ${suffix}`;
  return `${name.slice(0, 255 - tail.length)}${tail}`;
}

/**
 * PUT .../draft body from a parsed file. Only what the contract allows is forwarded: the top-level definition
 * properties of definition.schema.json (schemaVersion, nodes, edges, variables) and the editorState shape the builder
 * itself saves ({ nodes: { [id]: { name, position: { x, y } } } }).
 */
export function buildDraftBody(name: string, file: WorkflowFile): Record<string, unknown> {
  const { definition, editorState } = file;
  const body: Record<string, unknown> = {
    name,
    definition: {
      schemaVersion: typeof definition.schemaVersion === 'string' ? definition.schemaVersion : '1.0',
      nodes: definition.nodes,
      edges: definition.edges,
      variables: isRecord(definition.variables) ? definition.variables : {},
    },
  };
  const description = file.description?.trim().slice(0, WORKFLOW_DESCRIPTION_MAX);
  if (description) body.description = description;
  const rawNodes = editorState && isRecord(editorState.nodes) ? editorState.nodes : null;
  if (rawNodes) {
    const nodes: Record<string, { name: string; position: { x: number; y: number } }> = {};
    for (const [id, value] of Object.entries(rawNodes)) {
      if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.position)) continue;
      const { x, y } = value.position;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      nodes[id] = { name: value.name, position: { x, y } };
    }
    body.editorState = { nodes };
  }
  return body;
}
