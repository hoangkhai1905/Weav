export type WorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED';

export interface WorkflowNode {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  version: number;
  triggerType: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  ownerName: string;
  workspaceId: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
}

export interface WorkflowRepository {
  getWorkflows(): Promise<Workflow[]>;
  getWorkflow(id: string): Promise<Workflow | null>;
  runWorkflow(id: string, inputPayload?: Record<string, unknown>): Promise<{ executionId: string }>;
  pauseWorkflow(id: string): Promise<Workflow>;
  resumeWorkflow(id: string): Promise<Workflow>;
}
