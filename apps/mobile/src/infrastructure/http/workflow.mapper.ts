import type {
  Workflow,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowPage,
  WorkflowPublication,
  WorkflowRunAccepted,
  WorkflowStatus,
  WorkflowSummary,
  WorkflowTrigger,
} from '../../domain/workflow/workflow.types';
import { arr, int, invalid, oneOf, oneOfOrNull, rec, recOrEmpty, str, strOrNull } from './mapper-utils';
import type { Rec } from './mapper-utils';

const STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED'] as const;
const TRIGGER_TYPES = ['SCHEDULE', 'WEBHOOK', 'TELEGRAM', 'GMAIL'] as const;
const TRIGGER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
const REASON_CODES = [
  'DEPENDENCY_NOT_CONFIGURED',
  'SCHEDULE_ADMISSION_FAILED',
  'CONNECTION_RECONNECT_REQUIRED',
  'AUTHENTICATION_REJECTED',
  'CONNECTION_FORBIDDEN',
  'CONNECTION_UNAVAILABLE',
  'GMAIL_POLL_FAILED',
  'GMAIL_MESSAGE_SKIPPED',
  'GMAIL_BACKLOG_TRUNCATED',
] as const;

export function mapWorkflowSummary(value: unknown): WorkflowSummary {
  const r = rec(value, 'workflow');
  return {
    workflowId: str(r, 'workflowId', 'workflow'),
    name: str(r, 'name', 'workflow'),
    description: strOrNull(r, 'description', 'workflow'),
    status: oneOf(r, 'status', STATUSES, 'workflow'),
    schemaVersion: str(r, 'schemaVersion', 'workflow'),
    currentVersionId: strOrNull(r, 'currentVersionId', 'workflow'),
    createdAt: str(r, 'createdAt', 'workflow'),
    updatedAt: str(r, 'updatedAt', 'workflow'),
    publishedAt: strOrNull(r, 'publishedAt', 'workflow'),
  };
}

/** The endpoint has no `hasNext`; it is derived exactly as the backend does for executions. */
export function mapWorkflowPage(value: unknown): WorkflowPage {
  const r = rec(value, 'workflowPage');
  const page = int(r, 'page', 'workflowPage');
  const size = int(r, 'size', 'workflowPage');
  const totalElements = int(r, 'totalElements', 'workflowPage');
  return {
    items: arr(r, 'items', 'workflowPage').map(mapWorkflowSummary),
    page,
    size,
    totalElements,
    hasNext: (page + 1) * size < totalElements,
  };
}

export function mapWorkflowEdge(value: unknown): WorkflowEdge {
  const r = rec(value, 'edge');
  const sourcePort = strOrNull(r, 'sourcePort', 'edge');
  return {
    id: str(r, 'id', 'edge'),
    source: str(r, 'source', 'edge'),
    target: str(r, 'target', 'edge'),
    ...(sourcePort ? { sourcePort } : {}),
  };
}

/** Copies the wire definition ({schemaVersion, nodes:[{id,type,config}], edges, variables?}). */
export function mapWorkflowDefinition(value: unknown): WorkflowDefinition {
  const r = rec(value, 'definition');
  const variables = r.variables === undefined || r.variables === null ? undefined : rec(r.variables, 'definition.variables');
  return {
    schemaVersion: str(r, 'schemaVersion', 'definition'),
    nodes: arr(r, 'nodes', 'definition').map((node) => {
      const n = rec(node, 'node');
      return { id: str(n, 'id', 'node'), type: str(n, 'type', 'node'), config: recOrEmpty(n.config) };
    }),
    edges: arr(r, 'edges', 'definition').map(mapWorkflowEdge),
    ...(variables ? { variables } : {}),
  };
}

function position(value: unknown): { x: number; y: number } | null {
  const r = recOrEmpty(value);
  return typeof r.x === 'number' && typeof r.y === 'number' ? { x: r.x, y: r.y } : null;
}

/**
 * Node labels are not in `definition`: the web editor stores them in
 * `editorState.nodes[id].name`. Missing for AI generated workflows (name stays null).
 */
export function mapWorkflowNodes(
  definition: WorkflowDefinition,
  editorState: unknown,
  layout?: Record<string, unknown>,
): WorkflowNode[] {
  const editorNodes = recOrEmpty(recOrEmpty(editorState).nodes);
  return definition.nodes.map((node) => {
    const editor = recOrEmpty(editorNodes[node.id]);
    const name = typeof editor.name === 'string' && editor.name.trim() ? editor.name : null;
    return {
      id: node.id,
      type: node.type,
      config: node.config,
      name,
      position: position(editor.position) ?? position(layout?.[node.id]),
    };
  });
}

function mapTrigger(value: unknown): WorkflowTrigger {
  const r: Rec = rec(value, 'trigger');
  return {
    triggerId: str(r, 'triggerId', 'trigger'),
    type: oneOf(r, 'type', TRIGGER_TYPES, 'trigger'),
    status: oneOf(r, 'status', TRIGGER_STATUSES, 'trigger'),
    reasonCode: oneOfOrNull(r, 'reasonCode', REASON_CODES, 'trigger'),
    nextRunAt: strOrNull(r, 'nextRunAt', 'trigger'),
    lastTriggeredAt: strOrNull(r, 'lastTriggeredAt', 'trigger'),
  };
}

export function mapWorkflow(value: unknown): Workflow {
  const r = rec(value, 'workflow');
  const summary = mapWorkflowSummary(value);
  const definition = mapWorkflowDefinition(r.definition);
  return {
    ...summary,
    nodes: mapWorkflowNodes(definition, r.editorState),
    edges: definition.edges,
    revision: int(r, 'revision', 'workflow'),
    triggers: arr(r, 'triggers', 'workflow').map(mapTrigger),
  };
}

export function mapWorkflowRunAccepted(value: unknown): WorkflowRunAccepted {
  const r = rec(value, 'run');
  if (r.status !== 'QUEUED') invalid('run.status');
  return {
    executionId: str(r, 'executionId', 'run'),
    workflowId: str(r, 'workflowId', 'run'),
    workflowVersionId: str(r, 'workflowVersionId', 'run'),
    status: 'QUEUED',
  };
}

export function mapWorkflowCreated(value: unknown): { workflowId: string; status: WorkflowStatus } {
  const r = rec(value, 'created');
  return { workflowId: str(r, 'workflowId', 'created'), status: oneOf(r, 'status', STATUSES, 'created') };
}

export function mapWorkflowPublication(value: unknown): WorkflowPublication {
  const r = rec(value, 'publication');
  if (r.status !== 'PUBLISHED') invalid('publication.status');
  return {
    workflowId: str(r, 'workflowId', 'publication'),
    versionId: str(r, 'versionId', 'publication'),
    version: int(r, 'version', 'publication'),
    status: 'PUBLISHED',
    webhooks: arr(r, 'webhooks', 'publication').map((w) => {
      const x = rec(w, 'webhook');
      return {
        triggerId: str(x, 'triggerId', 'webhook'),
        endpointKey: str(x, 'endpointKey', 'webhook'),
        secret: str(x, 'secret', 'webhook'),
      };
    }),
  };
}

/** DELETE answers 204 with no body. */
export function mapNoContent(): void {}
