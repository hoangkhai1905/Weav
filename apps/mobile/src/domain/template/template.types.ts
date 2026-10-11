export type TemplateScope = 'public' | 'mine';
export type TemplateVisibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  authorName: string | null;
  /** Step types in the template, e.g. "trigger.gmail". */
  nodeTypes: string[];
  visibility: TemplateVisibility;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  /** True when the signed-in user shared this template. */
  owned: boolean;
}

/** Only id and type of each step are kept: the app shows the steps, it does not edit the definition. */
export interface TemplateNode {
  id: string;
  type: string;
}

export interface TemplateDetail extends TemplateSummary {
  nodes: TemplateNode[];
  /** Only sent to the owner. */
  shareCode: string | null;
}

export interface TemplatePage {
  items: TemplateSummary[];
  page: number;
  size: number;
  totalElements: number;
  hasNext: boolean;
}

export interface TemplateListQuery {
  q?: string;
  page?: number;
  size?: number;
}

export interface TemplateRepository {
  listTemplates(scope: TemplateScope, query?: TemplateListQuery): Promise<TemplatePage>;
  getTemplate(id: string): Promise<TemplateDetail>;
  getTemplateByCode(code: string): Promise<TemplateDetail>;
  /** Creates a draft workflow in the workspace from the template. */
  useTemplate(id: string, workspaceId: string, name?: string): Promise<{ workflowId: string }>;
}
