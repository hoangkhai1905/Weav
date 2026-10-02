import type { WorkflowRepository, Workflow } from '../../domain/workflow/workflow.types';
import { MOCK_WORKFLOWS, MOCK_EXECUTIONS } from './mock-data';

const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

let workflowsStore = [...MOCK_WORKFLOWS];

export class MockWorkflowRepository implements WorkflowRepository {
  async getWorkflows(): Promise<Workflow[]> {
    await delay(300);
    return [...workflowsStore];
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    await delay(250);
    const wf = workflowsStore.find((w) => w.id === id);
    return wf ? { ...wf } : null;
  }

  async runWorkflow(id: string, inputPayload?: Record<string, unknown>): Promise<{ executionId: string }> {
    await delay(400);
    const wf = workflowsStore.find((w) => w.id === id);
    if (!wf) throw new Error('Workflow not found');

    const newExecId = 'exec-' + Date.now().toString(36);
    const nowIso = new Date().toISOString();

    // Create execution record in mock store
    MOCK_EXECUTIONS.unshift({
      id: newExecId,
      workflowId: wf.id,
      workflowName: wf.name,
      status: 'QUEUED',
      triggerType: 'trigger.manual',
      startedAt: nowIso,
      durationMs: 0,
      nodeResults: {
        'step-1': { nodeId: 'step-1', nodeName: 'Manual Trigger', status: 'RUNNING', startedAt: nowIso, input: inputPayload },
        'step-2': { nodeId: 'step-2', nodeName: 'AI Node Process', status: 'PENDING' },
        'step-3': { nodeId: 'step-3', nodeName: 'Final Action Output', status: 'PENDING' },
      },
      logs: [
        { id: 'l-' + Date.now(), nodeId: 'step-1', nodeName: 'Manual Trigger', timestamp: nowIso, level: 'INFO', message: 'Manual execution triggered from Mobile.' },
      ],
    });

    // Simulate async status progression
    setTimeout(() => {
      const exec = MOCK_EXECUTIONS.find((e) => e.id === newExecId);
      if (exec) {
        exec.status = 'RUNNING';
        if (exec.nodeResults) {
          exec.nodeResults['step-1'].status = 'SUCCESS';
          exec.nodeResults['step-1'].completedAt = new Date().toISOString();
          exec.nodeResults['step-1'].durationMs = 120;
          exec.nodeResults['step-2'].status = 'RUNNING';
          exec.nodeResults['step-2'].startedAt = new Date().toISOString();
        }
      }
    }, 1500);

    setTimeout(() => {
      const exec = MOCK_EXECUTIONS.find((e) => e.id === newExecId);
      if (exec) {
        exec.status = 'SUCCESS';
        exec.completedAt = new Date().toISOString();
        exec.durationMs = 3200;
        if (exec.nodeResults) {
          exec.nodeResults['step-2'].status = 'SUCCESS';
          exec.nodeResults['step-2'].completedAt = new Date().toISOString();
          exec.nodeResults['step-2'].durationMs = 1800;
          exec.nodeResults['step-3'].status = 'SUCCESS';
          exec.nodeResults['step-3'].startedAt = new Date().toISOString();
          exec.nodeResults['step-3'].completedAt = new Date().toISOString();
          exec.nodeResults['step-3'].durationMs = 450;
        }
        exec.logs?.push({
          id: 'l-end-' + Date.now(),
          timestamp: new Date().toISOString(),
          level: 'SUCCESS',
          message: 'Execution completed successfully.',
        });
      }
    }, 3500);

    // Update workflow last run time
    wf.lastRunAt = nowIso;

    return { executionId: newExecId };
  }

  async pauseWorkflow(id: string): Promise<Workflow> {
    await delay(300);
    const index = workflowsStore.findIndex((w) => w.id === id);
    if (index === -1) throw new Error('Workflow not found');
    workflowsStore[index] = { ...workflowsStore[index], status: 'PAUSED', updatedAt: new Date().toISOString() };
    return workflowsStore[index];
  }

  async resumeWorkflow(id: string): Promise<Workflow> {
    await delay(300);
    const index = workflowsStore.findIndex((w) => w.id === id);
    if (index === -1) throw new Error('Workflow not found');
    workflowsStore[index] = { ...workflowsStore[index], status: 'PUBLISHED', updatedAt: new Date().toISOString() };
    return workflowsStore[index];
  }
}
