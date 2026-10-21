import { api } from './client';

export interface PublicTemplate {
  id: string;
  name: string;
  description: string | null;
  authorName: string | null;
  nodeTypes: string[];
  visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  owned: boolean;
}

export interface TemplatePage {
  items: PublicTemplate[];
  page: number;
  size: number;
  totalElements: number;
}

export interface ListTemplatesParams {
  q?: string;
  page: number;
  size: number;
}

/** Empty search is left out of the query string. */
export const listPublicTemplates = async ({ q, page, size }: ListTemplatesParams): Promise<TemplatePage> =>
  (await api.get<TemplatePage>('/api/v1/templates', { params: { scope: 'public', q: q || undefined, page, size } })).data;

/** Admin takedown: the backend lets an admin only turn a PUBLIC template PRIVATE. */
export const takeDown = async (id: string): Promise<void> => {
  await api.patch(`/api/v1/templates/${encodeURIComponent(id)}`, { visibility: 'PRIVATE' });
};
