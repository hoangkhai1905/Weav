import type {
  RunWorkflowOptions,
  Workflow,
  WorkflowListQuery,
  WorkflowPage,
  WorkflowRepository,
  WorkflowRunAccepted,
} from '../../domain/workflow/workflow.types';
import { isUnknownOutcomeTimeout, requestGateway } from './gateway-request';
import {
  buildPauseWorkflowRequest,
  buildResumeWorkflowRequest,
  buildRunWorkflowRequest,
  buildWorkflowDetailRequest,
  buildWorkflowListRequest,
  newIdempotencyKey,
} from './workflow.http.contract';
import { mapWorkflow, mapWorkflowPage, mapWorkflowRunAccepted } from './workflow.mapper';

export class HttpWorkflowRepository implements WorkflowRepository {
  getWorkflows(workspaceId: string, query: WorkflowListQuery = {}): Promise<WorkflowPage> {
    return requestGateway(buildWorkflowListRequest(workspaceId, query), mapWorkflowPage);
  }

  getWorkflow(workspaceId: string, workflowId: string): Promise<Workflow> {
    return requestGateway(buildWorkflowDetailRequest(workspaceId, workflowId), mapWorkflow);
  }

  /**
   * One new Idempotency-Key per call (per click). If the gateway answers 504 or the
   * request times out the outcome is unknown, so it is retried ONCE with the SAME key:
   * the backend then returns the original execution instead of starting a second one.
   */
  async runWorkflow(
    workspaceId: string,
    workflowId: string,
    options: RunWorkflowOptions = {},
  ): Promise<WorkflowRunAccepted> {
    const request = buildRunWorkflowRequest(workspaceId, workflowId, {
      ...options,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
    });
    try {
      return await requestGateway(request, mapWorkflowRunAccepted);
    } catch (error) {
      if (!isUnknownOutcomeTimeout(error)) throw error;
      return requestGateway(request, mapWorkflowRunAccepted);
    }
  }

  pauseWorkflow(workspaceId: string, workflowId: string): Promise<Workflow> {
    return requestGateway(buildPauseWorkflowRequest(workspaceId, workflowId), mapWorkflow);
  }

  resumeWorkflow(workspaceId: string, workflowId: string): Promise<Workflow> {
    return requestGateway(buildResumeWorkflowRequest(workspaceId, workflowId), mapWorkflow);
  }
}
