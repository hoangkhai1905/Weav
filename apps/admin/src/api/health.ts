import { ApiError, api } from './client';

export type UpstreamState = 'up' | 'down';

export interface Upstreams {
  status: 'ok' | 'error';
  details: { identity: { status: UpstreamState }; workspace: { status: UpstreamState } };
  requestId?: string;
}

/** The Gateway answers 503 with the same body when a service is down: that is data to show, not an error. */
export async function getUpstreams(): Promise<Upstreams> {
  const response = await api.get<Upstreams>('/ready/upstreams', { validateStatus: (status) => status === 200 || status === 503 });
  if (!response.data?.details?.identity || !response.data.details.workspace) throw new ApiError(response.status, 'Unexpected health response');
  return response.data;
}
