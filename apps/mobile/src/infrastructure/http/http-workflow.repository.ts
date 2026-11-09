import type {
  CreateWorkflowInput,
  RunWorkflowOptions,
  SaveDraftInput,
  Workflow,
  WorkflowListQuery,
  WorkflowPage,
  WorkflowPublication,
  WorkflowReadiness,
  WorkflowRepository,
  WorkflowRunAccepted,
  WorkflowStatus,
} from '../../domain/workflow/workflow.types';
import { isUnknownOutcomeTimeout, requestGateway } from './gateway-request';
import {
  buildCreateWorkflowRequest,
  buildDeleteWorkflowRequest,
  buildPauseWorkflowRequest,
  buildPublishWorkflowRequest,
  buildResumeWorkflowRequest,
  buildSaveDraftRequest,
  buildRunWorkflowRequest,
  buildWorkflowDetailRequest,
  buildWorkflowListRequest,
  buildWorkflowReadinessRequest,
  newIdempotencyKey,
} from './workflow.http.contract';
import {
  mapNoContent,
  mapWorkflow,
  mapWorkflowCreated,
  mapWorkflowPage,
  mapWorkflowPublication,
  mapWorkflowReadiness,
  mapWorkflowRunAccepted,
} from './workflow.mapper';

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

  createWorkflow(
    workspaceId: string,
    input: CreateWorkflowInput,
  ): Promise<{ workflowId: string; status: WorkflowStatus }> {
    return requestGateway(buildCreateWorkflowRequest(workspaceId, input), mapWorkflowCreated);
  }

  saveDraft(workspaceId: string, workflowId: string, input: SaveDraftInput): Promise<Workflow> {
    return requestGateway(buildSaveDraftRequest(workspaceId, workflowId, input), mapWorkflow);
  }

  /** The response carries one-time webhook secrets; callers must not cache or log it. */
  publishWorkflow(workspaceId: string, workflowId: string): Promise<WorkflowPublication> {
    return requestGateway(buildPublishWorkflowRequest(workspaceId, workflowId), mapWorkflowPublication);
  }

  getReadiness(workspaceId: string, workflowId: string): Promise<WorkflowReadiness> {
    return requestGateway(buildWorkflowReadinessRequest(workspaceId, workflowId), mapWorkflowReadiness);
  }

  deleteWorkflow(workspaceId: string, workflowId: string): Promise<void> {
    return requestGateway(buildDeleteWorkflowRequest(workspaceId, workflowId), mapNoContent);
  }
}
