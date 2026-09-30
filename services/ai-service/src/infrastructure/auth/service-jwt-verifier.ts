import { createPublicKey, KeyObject, verify } from 'node:crypto';
import { AiError, isPlainObject } from '../../domain/errors';

export interface ServiceClaims {
  scope: string;
  workspaceId: string;
  requestId: string;
  mode: 'execution' | 'generation';
}

const SKEW_SECONDS = 30;
const MAX_LIFETIME_SECONDS = 120;
const TOKEN = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export class ServiceJwtVerifier {
  private constructor(
    private readonly keys: Map<string, KeyObject>,
    private readonly now: () => number,
  ) {}

  static fromJwks(
    json: string,
    now: () => number = Date.now,
  ): ServiceJwtVerifier {
    const parsed: unknown = JSON.parse(json);
    const keys = new Map<string, KeyObject>();
    if (isPlainObject(parsed) && Array.isArray(parsed.keys)) {
      for (const jwk of parsed.keys) {
        if (
          isPlainObject(jwk) &&
          jwk.kty === 'RSA' &&
          typeof jwk.kid === 'string'
        ) {
          keys.set(
            jwk.kid,
            createPublicKey({ key: jwk as never, format: 'jwk' }),
          );
        }
      }
    }
    if (keys.size === 0) throw new Error('JWKS contains no RSA signing keys');
    return new ServiceJwtVerifier(keys, now);
  }

  verify(authorization: unknown): ServiceClaims {
    const match =
      typeof authorization === 'string' && authorization.length <= 8192
        ? TOKEN.exec(authorization)
        : null;
    if (!match) throw new AiError('UNAUTHENTICATED');
    const header = decode(match[1]);
    const claims = decode(match[2]);
    const key =
      header && typeof header.kid === 'string'
        ? this.keys.get(header.kid)
        : undefined;
    if (
      !header ||
      !claims ||
      header.alg !== 'RS256' ||
      !key ||
      !verify(
        'RSA-SHA256',
        Buffer.from(`${match[1]}.${match[2]}`),
        key,
        Buffer.from(match[3], 'base64url'),
      )
    ) {
      throw new AiError('UNAUTHENTICATED');
    }
    const nowSeconds = Math.floor(this.now() / 1000);
    const { iss, aud, exp, iat, scope, workspace_id, request_id, mode } =
      claims;
    const audienceOk =
      aud === 'weav-ai' ||
      (Array.isArray(aud) && aud.length === 1 && aud[0] === 'weav-ai');
    if (
      iss !== 'weav-workflow' ||
      !audienceOk ||
      typeof exp !== 'number' ||
      typeof iat !== 'number' ||
      exp <= nowSeconds - SKEW_SECONDS ||
      iat > nowSeconds + SKEW_SECONDS ||
      exp - iat > MAX_LIFETIME_SECONDS ||
      typeof scope !== 'string' ||
      typeof workspace_id !== 'string' ||
      typeof request_id !== 'string' ||
      (mode !== 'execution' && mode !== 'generation') ||
      (mode === 'execution' &&
        (typeof claims.execution_id !== 'string' ||
          typeof claims.node_execution_id !== 'string'))
    ) {
      throw new AiError('UNAUTHENTICATED');
    }
    return { scope, workspaceId: workspace_id, requestId: request_id, mode };
  }
}

function decode(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, 'base64url').toString('utf8'),
    );
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}
