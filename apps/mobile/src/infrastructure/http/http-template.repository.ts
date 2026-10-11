import type {
  TemplateDetail,
  TemplateListQuery,
  TemplatePage,
  TemplateRepository,
  TemplateScope,
} from '../../domain/template/template.types';
import { requestGateway } from './gateway-request';
import {
  buildTemplateByCodeRequest,
  buildTemplateDetailRequest,
  buildTemplateListRequest,
  buildUseTemplateRequest,
} from './template.http.contract';
import { mapTemplateDetail, mapTemplatePage, mapTemplateUsed } from './template.mapper';

export class HttpTemplateRepository implements TemplateRepository {
  listTemplates(scope: TemplateScope, query: TemplateListQuery = {}): Promise<TemplatePage> {
    return requestGateway(buildTemplateListRequest(scope, query), mapTemplatePage);
  }

  getTemplate(id: string): Promise<TemplateDetail> {
    return requestGateway(buildTemplateDetailRequest(id), mapTemplateDetail);
  }

  getTemplateByCode(code: string): Promise<TemplateDetail> {
    return requestGateway(buildTemplateByCodeRequest(code), mapTemplateDetail);
  }

  useTemplate(id: string, workspaceId: string, name?: string): Promise<{ workflowId: string }> {
    return requestGateway(buildUseTemplateRequest(id, workspaceId, name), mapTemplateUsed);
  }
}
