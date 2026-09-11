import type { WorkflowRepository, Workflow } from '../../domain/workflow/workflow.types';
import { httpClient, normalizeApiError } from './http-client';

export class HttpWorkflowRepository implements WorkflowRepository {
  async getWorkflows(): Promise<Workflow[]> {
    try {
      const res = await httpClient.get<Workflow[]>('/api/workflows');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    try {
      const res = await httpClient.get<Workflow>(`/api/workflows/${id}`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async runWorkflow(id: string, inputPayload?: Record<string, unknown>): Promise<{ executionId: string }> {
    try {
      const res = await httpClient.post<{ executionId: string }>(`/api/workflows/${id}/run`, { inputPayload });
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async pauseWorkflow(id: string): Promise<Workflow> {
    try {
      const res = await httpClient.post<Workflow>(`/api/workflows/${id}/pause`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async resumeWorkflow(id: string): Promise<Workflow> {
    try {
      const res = await httpClient.post<Workflow>(`/api/workflows/${id}/resume`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }
}
