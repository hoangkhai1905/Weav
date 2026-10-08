import type {
  AiGenerateRequest,
  AiGenerationResult,
  AiRepository,
} from '../../domain/ai/ai.types';
import { buildGenerateWorkflowRequest } from './ai.http.contract';
import { mapGenerationResult } from './ai.mapper';
import { requestGateway } from './gateway-request';

export class HttpAiRepository implements AiRepository {
  /** Slow route (up to ~80 s): the request config carries its own 85 s timeout. */
  generateWorkflow(workspaceId: string, request: AiGenerateRequest): Promise<AiGenerationResult> {
    return requestGateway(buildGenerateWorkflowRequest(workspaceId, request), mapGenerationResult);
  }
}
