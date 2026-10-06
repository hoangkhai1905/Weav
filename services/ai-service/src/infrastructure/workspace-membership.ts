import { AiError, USER_AUTH_REQUIRED } from '../domain/errors';

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const TIMEOUT_MS = 3_000;

/**
 * Proves the caller belongs to a workspace by reading it from workspace-service with the caller's own
 * token (a member gets 200). Positive results are cached per (user, workspace) for a minute, bounded.
 */
export class WorkspaceMembership {
  private readonly cache = new Map<string, number>();

  constructor(
    private readonly workspaceApiUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws AiError: 401 UNAUTHENTICATED, 404 NOT_FOUND (not a member), 503 AI_UNAVAILABLE. */
  async assertMember(
    userId: string,
    workspaceId: string,
    authorization: string,
  ): Promise<void> {
    const key = `${userId}:${workspaceId}`;
    const expires = this.cache.get(key);
    if (expires !== undefined && expires > this.now()) return;
    this.cache.delete(key);
    let status: number;
    try {
      const response = await this.fetchImpl(
        `${this.workspaceApiUrl}/workspaces/${workspaceId}`,
        {
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { authorization, accept: 'application/json' },
        },
      );
      status = response.status;
      await response.body?.cancel().catch(() => undefined);
    } catch {
      throw new AiError('AI_UNAVAILABLE');
    }
    if (status === 200) {
      if (this.cache.size >= MAX_ENTRIES)
        this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, this.now() + TTL_MS);
      return;
    }
    if (status === 401)
      throw new AiError('UNAUTHENTICATED', USER_AUTH_REQUIRED);
    if (status === 403 || status === 404) throw new AiError('NOT_FOUND');
    throw new AiError('AI_UNAVAILABLE');
  }
}
