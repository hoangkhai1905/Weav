import type { FastifyRequest } from 'fastify';
import type { AiDeps } from '../../ai-deps';
import { AiError, USER_AUTH_REQUIRED } from '../../domain/errors';

/** Verifies the caller's user access token; without a verifier nobody can authenticate. */
export async function authenticateUser(
  deps: AiDeps,
  request: FastifyRequest,
): Promise<string> {
  const verifier = deps.assistant?.verifier;
  if (!verifier) throw new AiError('UNAUTHENTICATED', USER_AUTH_REQUIRED);
  return (await verifier.verify(request.headers.authorization)).userId;
}
