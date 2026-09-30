import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import type { ExecutionDetail, WorkflowDefinition, NodeExecutionResult } from '../types/workflow.types';
import { getActiveWorkflowWorkspaceId, workflowV1Api, type WorkflowExecutionDetailV1, type WorkflowExecutionSummaryV1 } from './workflow-v1.api';

const isWorkflowMockMode = import.meta.env.VITE_API_MODE === 'mock';

const mockExecutionApi = {
  async getExecutions(): Promise<ExecutionDetail[]> {
    await delay(200);
    return getStorage<ExecutionDetail[]>(STORAGE_KEYS.EXECUTIONS, []);
  },

  async getExecution(id: string): Promise<ExecutionDetail | null> {
    await delay(150);
    const executions = getStorage<ExecutionDetail[]>(STORAGE_KEYS.EXECUTIONS, []);
    return executions.find((e) => e.id === id) || null;
  },

  async createExecutionForWorkflow(wf: WorkflowDefinition): Promise<ExecutionDetail> {
    await delay(200);
    const executions = getStorage<ExecutionDetail[]>(STORAGE_KEYS.EXECUTIONS, []);
    const startTime = new Date();
    const nowIso = startTime.toISOString();

    const nodeResults: Record<string, NodeExecutionResult> = {};
    wf.nodes.forEach((node) => {
      nodeResults[node.id] = {
        nodeId: node.id,
        nodeName: node.name,
        status: 'SUCCESS',
        startedAt: nowIso,
        completedAt: new Date(startTime.getTime() + 600).toISOString(),
        durationMs: 600,
        retryCount: 0,
        output: { result: 'Simulated output from ' + node.name, timestamp: nowIso },
      };
    });

    const newExec: ExecutionDetail = {
      id: 'exec-' + Date.now().toString(36),
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType: wf.triggerType,
      status: 'SUCCESS',
      startedAt: nowIso,
      completedAt: new Date(startTime.getTime() + 1800).toISOString(),
      durationMs: 1800,
      nodeResults,
      logs: [
        { id: 'l1', timestamp: '00:00:00', level: 'INFO', message: `Execution triggered manually for ${wf.name}` },
        ...wf.nodes.map((n, i) => ({
          id: `l-${n.id}`,
          nodeId: n.id,
          nodeName: n.name,
          timestamp: `00:00:0${i + 1}`,
          level: 'SUCCESS' as const,
          message: `Executed step "${n.name}" (${n.type}) successfully.`,
        })),
        { id: 'l99', timestamp: '00:00:02', level: 'SUCCESS', message: 'Workflow execution finished.' },
      ],
    };

    executions.unshift(newExec);
    setStorage(STORAGE_KEYS.EXECUTIONS, executions);
    return newExec;
  },
};

function normalizedExecutionStatus(status: WorkflowExecutionSummaryV1['status']): ExecutionDetail['status'] {
  return status === 'WAITING' ? 'RUNNING' : status;
}

function summaryToExecution(
  summary: WorkflowExecutionSummaryV1,
  workflow: WorkflowDefinition,
): ExecutionDetail {
  const startedAt = summary.startedAt ?? summary.createdAt;
  const durationMs = summary.startedAt && summary.finishedAt
    ? Math.max(0, Date.parse(summary.finishedAt) - Date.parse(summary.startedAt))
    : undefined;
  return {
    id: summary.executionId,
    workflowId: summary.workflowId,
    workflowName: workflow.name,
    triggerType: summary.triggerType,
    status: normalizedExecutionStatus(summary.status),
    startedAt,
    ...(summary.finishedAt ? { completedAt: summary.finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    nodeResults: {},
    logs: [],
  };
}

function detailToExecution(
  detail: WorkflowExecutionDetailV1,
  workflow: WorkflowDefinition,
): ExecutionDetail {
  const workflowNodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nodeResults: Record<string, NodeExecutionResult> = {};
  for (const node of detail.nodes) {
    const knownStatus: NodeExecutionResult['status'] =
      node.status === 'SUCCESS' || node.status === 'FAILED' || node.status === 'RUNNING'
        ? node.status
        : 'PENDING';
    const start = node.startedAt ?? undefined;
    const finish = node.finishedAt ?? undefined;
    const durationMs = start && finish ? Math.max(0, Date.parse(finish) - Date.parse(start)) : undefined;
    const error = node.error == null ? undefined : typeof node.error === 'string' ? node.error : JSON.stringify(node.error);
    nodeResults[node.nodeId] = {
      nodeId: node.nodeId,
      nodeName: workflowNodes.get(node.nodeId)?.name ?? node.nodeId,
      status: knownStatus,
      startedAt: start ?? detail.createdAt,
      ...(finish ? { completedAt: finish } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      retryCount: node.attemptCount,
      ...(node.output !== null ? { output: node.output } : {}),
      ...(error ? { error } : {}),
    };
  }

  const logs = detail.logs.items.map((entry) => {
    const nodeId = detail.nodes.find((node) => node.nodeExecutionId === entry.nodeExecutionId)?.nodeId;
    const level = entry.level === 'DEBUG' ? 'INFO' : entry.level;
    return {
      id: entry.id,
      ...(nodeId ? { nodeId, nodeName: workflowNodes.get(nodeId)?.name ?? nodeId } : {}),
      timestamp: entry.createdAt,
      level,
      message: entry.message,
      payload: entry.metadata,
    } as const;
  });

  return {
    ...summaryToExecution(detail, workflow),
    nodeResults,
    logs,
  };
}

async function findWorkflowForExecution(executionId: string, workspaceId: string): Promise<WorkflowDefinition | null> {
  const workflows = await workflowV1Api.getWorkflows(workspaceId);
  for (let index = 0; index < workflows.length; index += 5) {
    const group = workflows.slice(index, index + 5);
    const matches = await Promise.all(group.map(async (workflow) => {
      let page = 0;
      while (page < 100) {
        const result = await workflowV1Api.listExecutions(workflow.id, page, 100, workspaceId);
        if (result.items.some((execution) => execution.executionId === executionId)) return workflow;
        if (result.items.length === 0 || (page + 1) * result.size >= result.totalElements) return null;
        page += 1;
      }
      return null;
    }));
    const match = matches.find((workflow): workflow is WorkflowDefinition => workflow !== null);
    if (match) return match;
  }
  return null;
}

export const executionApi = {
  async getExecutions(workflowId?: string): Promise<ExecutionDetail[]> {
    if (isWorkflowMockMode) return mockExecutionApi.getExecutions();

    const workspaceId = await getActiveWorkflowWorkspaceId();
    const workflows = await workflowV1Api.getWorkflows(workspaceId);
    const selected = workflowId ? workflows.filter((workflow) => workflow.id === workflowId) : workflows;
    const executions: ExecutionDetail[] = [];
    for (let index = 0; index < selected.length; index += 5) {
      const group = selected.slice(index, index + 5);
      const pages = await Promise.all(group.map(async (workflow) => {
        const page = await workflowV1Api.listExecutions(workflow.id, 0, 100, workspaceId);
        return page.items.map((summary) => summaryToExecution(summary, workflow));
      }));
      executions.push(...pages.flat());
    }
    return executions.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  },

  async getExecution(id: string, workflowId?: string): Promise<ExecutionDetail | null> {
    if (isWorkflowMockMode) return mockExecutionApi.getExecution(id);

    const workspaceId = await getActiveWorkflowWorkspaceId();
    const workflow = workflowId
      ? await workflowV1Api.getWorkflow(workflowId, workspaceId)
      : await findWorkflowForExecution(id, workspaceId);
    if (!workflow) return null;
    const detail = await workflowV1Api.getExecution(workflow.id, id, workspaceId);
    return detailToExecution(detail, workflow);
  },

  createExecutionForWorkflow(wf: WorkflowDefinition): Promise<ExecutionDetail> {
    if (isWorkflowMockMode) return mockExecutionApi.createExecutionForWorkflow(wf);
    throw new Error('Use the manual execution endpoint for live workflows.');
  },
};
