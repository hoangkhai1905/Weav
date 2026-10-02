import type { ExecutionRepository, Execution } from '../../domain/execution/execution.types';
import { httpClient, normalizeApiError } from './http-client';

export class HttpExecutionRepository implements ExecutionRepository {
  async getExecutions(): Promise<Execution[]> {
    try {
      const res = await httpClient.get<Execution[]>('/api/executions');
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async getExecution(id: string): Promise<Execution | null> {
    try {
      const res = await httpClient.get<Execution>(`/api/executions/${id}`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }

  async retryExecution(id: string): Promise<Execution> {
    try {
      const res = await httpClient.post<Execution>(`/api/executions/${id}/retry`);
      return res.data;
    } catch (err) {
      throw normalizeApiError(err);
    }
  }
}
