import type {
  TemplateDetail,
  TemplatePage,
  TemplateSummary,
} from '../../domain/template/template.types';
import { arr, bool, int, invalid, oneOf, rec, str, strOrNull } from './mapper-utils';

const VISIBILITIES = ['PRIVATE', 'UNLISTED', 'PUBLIC'] as const;

export function mapTemplateSummary(value: unknown): TemplateSummary {
  const r = rec(value, 'template');
  return {
    id: str(r, 'id', 'template'),
    name: str(r, 'name', 'template'),
    description: strOrNull(r, 'description', 'template'),
    authorName: strOrNull(r, 'authorName', 'template'),
    nodeTypes: arr(r, 'nodeTypes', 'template').map((type) =>
      typeof type === 'string' ? type : invalid('template.nodeTypes'),
    ),
    visibility: oneOf(r, 'visibility', VISIBILITIES, 'template'),
    usageCount: int(r, 'usageCount', 'template'),
    createdAt: str(r, 'createdAt', 'template'),
    updatedAt: str(r, 'updatedAt', 'template'),
    owned: bool(r, 'owned', 'template'),
  };
}

/** The endpoint has no `hasNext`; derived like the workflow list. */
export function mapTemplatePage(value: unknown): TemplatePage {
  const r = rec(value, 'templatePage');
  const page = int(r, 'page', 'templatePage');
  const size = int(r, 'size', 'templatePage');
  const totalElements = int(r, 'totalElements', 'templatePage');
  return {
    items: arr(r, 'items', 'templatePage').map(mapTemplateSummary),
    page,
    size,
    totalElements,
    hasNext: (page + 1) * size < totalElements,
  };
}

/** Summary plus the steps (id and type only, from `definition.nodes`) and the owner's share code. */
export function mapTemplateDetail(value: unknown): TemplateDetail {
  const r = rec(value, 'template');
  const definition = rec(r.definition, 'template.definition');
  return {
    ...mapTemplateSummary(value),
    nodes: arr(definition, 'nodes', 'template.definition').map((node) => {
      const n = rec(node, 'node');
      return { id: str(n, 'id', 'node'), type: str(n, 'type', 'node') };
    }),
    shareCode: strOrNull(r, 'shareCode', 'template'),
  };
}

export function mapTemplateUsed(value: unknown): { workflowId: string } {
  return { workflowId: str(rec(value, 'templateUse'), 'workflowId', 'templateUse') };
}
