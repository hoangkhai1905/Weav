import { delay, getStorage, setStorage, STORAGE_KEYS } from './client';
import type { WorkflowDefinition, ExecutionDetail } from '../types/workflow.types';
import { executionApi } from './execution.api';
import { workflowV1Api, type WorkflowPublication, type WorkflowRunReceipt } from './workflow-v1.api';

export const isWorkflowMockMode = import.meta.env.VITE_API_MODE === 'mock';

const mockWorkflowApi = {
  async getWorkflows(): Promise<WorkflowDefinition[]> {
    await delay(200);
    return getStorage<WorkflowDefinition[]>(STORAGE_KEYS.WORKFLOWS, []);
  },

  async getWorkflow(id: string): Promise<WorkflowDefinition | null> {
    await delay(150);
    const workflows = getStorage<WorkflowDefinition[]>(STORAGE_KEYS.WORKFLOWS, []);
    return workflows.find((w) => w.id === id) || null;
  },

  async createWorkflow(payload: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    await delay(300);
    const workflows = getStorage<WorkflowDefinition[]>(STORAGE_KEYS.WORKFLOWS, []);
    const newWorkflow: WorkflowDefinition = {
      id: 'wf-' + Date.now().toString(36),
      name: payload.name || 'Untitled Workflow',
      description: payload.description || 'New workflow definition',
      status: 'DRAFT',
      version: 1,
      triggerType: payload.triggerType || 'trigger.manual',
      nodes: payload.nodes || [
        {
          id: 'node-manual-1',
          type: 'trigger.manual',
          name: 'Start Trigger',
          config: {},
          position: { x: 250, y: 150 },
        },
      ],
      edges: payload.edges || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerName: 'Nguyễn Anh Xuân Trường',
      workspaceId: 'ws-main',
    };

    workflows.unshift(newWorkflow);
    setStorage(STORAGE_KEYS.WORKFLOWS, workflows);
    return newWorkflow;
  },

  async updateWorkflow(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    await delay(250);
    const workflows = getStorage<WorkflowDefinition[]>(STORAGE_KEYS.WORKFLOWS, []);
    const index = workflows.findIndex((w) => w.id === id);
    if (index === -1) throw new Error('Workflow not found');

    const updated: WorkflowDefinition = {
      ...workflows[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    workflows[index] = updated;
    setStorage(STORAGE_KEYS.WORKFLOWS, workflows);
    return updated;
  },

  async publishWorkflow(id: string): Promise<WorkflowDefinition> {
    const wf = await this.getWorkflow(id);
    if (!wf) throw new Error('Workflow not found');
    return this.updateWorkflow(id, {
      status: 'PUBLISHED',
      version: wf.version + 1,
    });
  },

  async pauseWorkflow(id: string): Promise<WorkflowDefinition> {
    return this.updateWorkflow(id, { status: 'PAUSED' });
  },

  async resumeWorkflow(id: string): Promise<WorkflowDefinition> {
    return this.updateWorkflow(id, { status: 'PUBLISHED' });
  },

  async runWorkflow(id: string): Promise<ExecutionDetail> {
    await delay(400);
    const wf = await this.getWorkflow(id);
    if (!wf) throw new Error('Workflow not found');

    // Update last run time
    const nowIso = new Date().toISOString();
    await this.updateWorkflow(id, { lastRunAt: nowIso });

    // Trigger simulation execution
    return executionApi.createExecutionForWorkflow(wf);
  },

  async duplicateWorkflow(id: string): Promise<WorkflowDefinition> {
    const wf = await this.getWorkflow(id);
    if (!wf) throw new Error('Workflow not found');

    return this.createWorkflow({
      name: `${wf.name} (Copy)`,
      description: wf.description,
      triggerType: wf.triggerType,
      nodes: wf.nodes.map((n) => ({ ...n, id: 'node-' + Math.random().toString(36).substr(2, 6) })),
      edges: [...wf.edges],
    });
  },

  async deleteWorkflow(id: string): Promise<void> {
    await delay(200);
    const workflows = getStorage<WorkflowDefinition[]>(STORAGE_KEYS.WORKFLOWS, []);
    const filtered = workflows.filter((w) => w.id !== id);
    setStorage(STORAGE_KEYS.WORKFLOWS, filtered);
  },
};

export const workflowApi = {
  getWorkflows(): Promise<WorkflowDefinition[]> {
    return isWorkflowMockMode ? mockWorkflowApi.getWorkflows() : workflowV1Api.getWorkflows();
  },

  getWorkflow(id: string): Promise<WorkflowDefinition | null> {
    return isWorkflowMockMode ? mockWorkflowApi.getWorkflow(id) : workflowV1Api.getWorkflow(id);
  },

  createWorkflow(payload: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    if (isWorkflowMockMode) return mockWorkflowApi.createWorkflow(payload);
    return workflowV1Api.createWorkflow({ name: payload.name ?? 'Untitled Workflow', description: payload.description });
  },

  updateWorkflow(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    return isWorkflowMockMode
      ? mockWorkflowApi.updateWorkflow(id, updates)
      : workflowV1Api.updateWorkflow(id, updates);
  },

  async publishWorkflow(id: string): Promise<WorkflowPublication> {
    if (isWorkflowMockMode) {
      return { workflow: await mockWorkflowApi.publishWorkflow(id), webhooks: [] };
    }
    return workflowV1Api.publishWorkflow(id);
  },

  pauseWorkflow(id: string): Promise<WorkflowDefinition> {
    return isWorkflowMockMode ? mockWorkflowApi.pauseWorkflow(id) : workflowV1Api.pauseWorkflow(id);
  },

  resumeWorkflow(id: string): Promise<WorkflowDefinition> {
    return isWorkflowMockMode ? mockWorkflowApi.resumeWorkflow(id) : workflowV1Api.resumeWorkflow(id);
  },

  async runWorkflow(id: string, input: Record<string, unknown> = {}): Promise<WorkflowRunReceipt> {
    if (isWorkflowMockMode) {
      const execution = await mockWorkflowApi.runWorkflow(id);
      return { executionId: execution.id, workflowId: id, workflowVersionId: '', status: 'QUEUED' };
    }
    return workflowV1Api.runWorkflow(id, input);
  },

  duplicateWorkflow(id: string): Promise<WorkflowDefinition> {
    return isWorkflowMockMode ? mockWorkflowApi.duplicateWorkflow(id) : workflowV1Api.duplicateWorkflow(id);
  },

  deleteWorkflow(id: string): Promise<void> {
    return isWorkflowMockMode ? mockWorkflowApi.deleteWorkflow(id) : workflowV1Api.deleteWorkflow();
  },
};
