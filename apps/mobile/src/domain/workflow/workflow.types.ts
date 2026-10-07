export type WorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED';

export type WorkflowTriggerType = 'SCHEDULE' | 'WEBHOOK' | 'TELEGRAM' | 'GMAIL';
export type WorkflowTriggerStatus = 'ACTIVE' | 'DISABLED';
export type WorkflowTriggerReasonCode =
  | 'DEPENDENCY_NOT_CONFIGURED'
  | 'SCHEDULE_ADMISSION_FAILED'
  | 'CONNECTION_RECONNECT_REQUIRED'
  | 'AUTHENTICATION_REJECTED'
  | 'CONNECTION_FORBIDDEN'
  | 'CONNECTION_UNAVAILABLE'
  | 'GMAIL_POLL_FAILED'
  | 'GMAIL_MESSAGE_SKIPPED'
  | 'GMAIL_BACKLOG_TRUNCATED';

/**
 * A node of the stored definition. `name` and `position` are not part of the
 * definition: they come from `editorState.nodes[id]` and are null when the
 * workflow was not authored in the web editor (for example AI generated).
 * The UI falls back to a translated `type` when `name` is null.
 */
export interface WorkflowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  name: string | null;
  position: { x: number; y: number } | null;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
}

/** The wire shape of `definition` (see packages/contracts/http/workflow/definition.schema.json). */
export interface WorkflowDefinition {
  schemaVersion: string;
  nodes: { id: string; type: string; config: Record<string, unknown> }[];
  edges: WorkflowEdge[];
  variables?: Record<string, unknown>;
}

export interface WorkflowTrigger {
  triggerId: string;
  type: WorkflowTriggerType;
  status: WorkflowTriggerStatus;
  reasonCode: WorkflowTriggerReasonCode | null;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
}

export interface WorkflowSummary {
  workflowId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  schemaVersion: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface Workflow extends WorkflowSummary {
  /** Draft definition, which can differ from the published version that actually runs. */
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  revision: number;
  /** Empty after pause/resume: the gateway does not return registrations for those calls. */
  triggers: WorkflowTrigger[];
}

export interface WorkflowPage {
  items: WorkflowSummary[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface WorkflowListQuery {
  page?: number;
  size?: number;
}

export interface WorkflowRunAccepted {
  executionId: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'QUEUED';
}

export interface RunWorkflowOptions {
  input?: Record<string, unknown>;
  /** Reused on retry after 504/timeout. Generated per call when omitted. */
  idempotencyKey?: string;
}

/** Every call is scoped to a workspace (`workspaceId` comes from `workspace.store`). */
export interface WorkflowRepository {
  getWorkflows(workspaceId: string, query?: WorkflowListQuery): Promise<WorkflowPage>;
  getWorkflow(workspaceId: string, workflowId: string): Promise<Workflow>;
  runWorkflow(
    workspaceId: string,
    workflowId: string,
    options?: RunWorkflowOptions,
  ): Promise<WorkflowRunAccepted>;
  /** Backend returns triggers: [] here. Refetch the detail instead of trusting it. */
  pauseWorkflow(workspaceId: string, workflowId: string): Promise<Workflow>;
  resumeWorkflow(workspaceId: string, workflowId: string): Promise<Workflow>;
}
