import type { ExecutionRepository, Execution } from '../../domain/execution/execution.types';
import { MOCK_EXECUTIONS } from './mock-data';

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockExecutionRepository implements ExecutionRepository {
  async getExecutions(): Promise<Execution[]> {
    await delay(300);
    return [...MOCK_EXECUTIONS];
  }

  async getExecution(id: string): Promise<Execution | null> {
    await delay(250);
    const exec = MOCK_EXECUTIONS.find((e) => e.id === id);
    return exec ? { ...exec } : null;
  }

  async retryExecution(id: string): Promise<Execution> {
    await delay(400);
    const exec = MOCK_EXECUTIONS.find((e) => e.id === id);
    if (!exec) throw new Error('Execution not found');

    const newExec: Execution = {
      ...exec,
      id: 'exec-retry-' + Date.now().toString(36),
      status: 'QUEUED',
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      error: undefined,
    };
    MOCK_EXECUTIONS.unshift(newExec);

    setTimeout(() => {
      newExec.status = 'RUNNING';
    }, 1200);

    setTimeout(() => {
      newExec.status = 'SUCCESS';
      newExec.completedAt = new Date().toISOString();
      newExec.durationMs = 2800;
    }, 3200);

    return newExec;
  }
}
