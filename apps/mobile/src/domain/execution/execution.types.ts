export type ExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export type NodeExecutionStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface NodeExecutionResult {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryCount?: number;
  output?: Record<string, unknown>;
  input?: Record<string, unknown>;
  error?: string;
}

export interface ExecutionLogItem {
  id: string;
  nodeId?: string;
  nodeName?: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
}

export interface Execution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  triggerType: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  nodeResults?: Record<string, NodeExecutionResult>;
  logs?: ExecutionLogItem[];
  error?: string;
}

export interface ExecutionRepository {
  getExecutions(): Promise<Execution[]>;
  getExecution(id: string): Promise<Execution | null>;
  retryExecution(id: string): Promise<Execution>;
}
