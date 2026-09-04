export type WorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED';

export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export type NodeCategory = 'trigger' | 'action' | 'ai' | 'ocr';

export interface WorkflowPosition {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: string; // e.g. 'trigger.manual', 'email.send', 'ai.extract'
  name: string;
  config: Record<string, unknown>;
  position?: WorkflowPosition;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  version: number;
  triggerType: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  ownerName: string;
  workspaceId: string;
}

export interface NodeCatalogItem {
  type: string;
  title: string;
  description: string;
  category: NodeCategory;
  iconName: string;
  defaultConfig: Record<string, unknown>;
  inputs: Array<{ name: string; type: string }>;
  outputs: Array<{ name: string; type: string }>;
}

export interface ExecutionLog {
  id: string;
  nodeId?: string;
  nodeName?: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  payload?: unknown;
}

export interface NodeExecutionResult {
  nodeId: string;
  nodeName: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface ExecutionDetail {
  id: string;
  workflowId: string;
  workflowName: string;
  triggerType: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  nodeResults: Record<string, NodeExecutionResult>;
  logs: ExecutionLog[];
}

export interface ConnectionItem {
  id: string;
  provider: 'gmail' | 'sheets' | 'telegram' | 'http';
  name: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string;
  lastRunAt?: string;
}

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'MEMBER';
  canPublishWorkflow: boolean;
  avatar?: string;
  joinedAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export interface NotificationItem {
  id: string;
  type: 'WORKFLOW_COMPLETED' | 'WORKFLOW_FAILED' | 'WORKFLOW_PAUSED' | 'WORKFLOW_RESUMED' | 'TELEGRAM_LINKED' | 'CONNECTION_ERROR';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  link?: string;
}
