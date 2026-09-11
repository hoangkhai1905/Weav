import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import type { ExecutionDetail, WorkflowDefinition, NodeExecutionResult } from '../types/workflow.types';

export const executionApi = {
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
