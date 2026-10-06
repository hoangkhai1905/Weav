import { createPublicKey, KeyObject, verify } from 'node:crypto';
import {
  AiError,
  isPlainObject,
  USER_AUTH_REQUIRED,
} from '../../domain/errors';

export interface UserPrincipal {
  userId: string;
}

export interface UserJwtConfig {
  jwksUri: string;
  issuer: string;
  audience: string;
  clockSkewSeconds: number;
  /** Cached keys may verify this long past their TTL when the JWKS cannot be refreshed (default 1 h). */
  maxStaleMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const JWKS_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_STALE_MS = 3_600_000;
const REFETCH_COOLDOWN_MS = 30_000;
const JWKS_TIMEOUT_MS = 3_000;
const MAX_JWKS_BYTES = 64 * 1024;

/**
 * Verifies identity's RS256 access tokens (same checks as the gateway's AccessTokenService:
 * issuer, audience, algorithm, clock tolerance, required claims) against identity's JWKS.
 * Service JWTs (iss weav-workflow, aud weav-ai) never pass: wrong issuer, audience and key set.
 */
export class UserJwtVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastAttemptAt = 0;

  constructor(
    private readonly config: UserJwtConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(authorization: unknown): Promise<UserPrincipal> {
    const match =
      typeof authorization === 'string' && authorization.length <= 8192
        ? TOKEN.exec(authorization)
        : null;
    if (!match) throw new AiError('UNAUTHENTICATED', USER_AUTH_REQUIRED);
    const header = decode(match[1]);
    const claims = decode(match[2]);
    if (!header || !claims || header.alg !== 'RS256')
      throw new AiError('UNAUTHENTICATED', USER_AUTH_REQUIRED);
    const key =
      typeof header.kid === 'string' ? await this.keyFor(header.kid) : null;
    if (
      !key ||
      !verify(
        'RSA-SHA256',
        Buffer.from(`${match[1]}.${match[2]}`),
        key,
        Buffer.from(match[3], 'base64url'),
      )
    ) {
      throw new AiError('UNAUTHENTICATED', USER_AUTH_REQUIRED);
    }
    const now = this.now() / 1000;
    const skew = this.config.clockSkewSeconds;
    const { iss, aud, sub, sid, jti, iat, nbf, exp } = claims;
    const audienceOk =
      aud === this.config.audience ||
      (Array.isArray(aud) && aud.includes(this.config.audience));
    if (
      iss !== this.config.issuer ||
      !audienceOk ||
      typeof sub !== 'string' ||
      !UUID.test(sub) ||
      typeof sid !== 'string' ||
      !UUID.test(sid) ||
      typeof jti !== 'string' ||
      !UUID.test(jti) ||
      !isFiniteNumber(iat) ||
      !isFiniteNumber(nbf) ||
      !isFiniteNumber(exp) ||
      exp <= iat ||
      exp <= nbf ||
      iat > now + skew ||
      nbf > now + skew ||
      exp + skew <= now ||
      claims.token_use !== 'access' ||
      (claims.system_role !== 'USER' && claims.system_role !== 'ADMIN') ||
      claims.user_status !== 'ACTIVE'
    ) {
      throw new AiError('UNAUTHENTICATED', USER_AUTH_REQUIRED);
    }
    return { userId: sub.toLowerCase() };
  }

  /** Startup probe: true when the JWKS is reachable and holds at least one RSA key. */
  async check(): Promise<boolean> {
    await this.refresh();
    return this.keys.size > 0;
  }

  private async keyFor(kid: string): Promise<KeyObject | null> {
    const stale = this.now() - this.fetchedAt > JWKS_TTL_MS;
    const mayRefetch = this.now() - this.lastAttemptAt > REFETCH_COOLDOWN_MS;
    // An unknown kid triggers at most one refetch per cooldown (key rotation without a DoS path).
    if ((stale || !this.keys.has(kid)) && mayRefetch) await this.refresh();
    // Identity unreachable for too long: stop trusting the cache (fail closed).
    const maxStale = this.config.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
    if (this.now() - this.fetchedAt > JWKS_TTL_MS + maxStale) return null;
    return this.keys.get(kid) ?? null;
  }

  private async refresh(): Promise<void> {
    this.lastAttemptAt = this.now();
    try {
      const response = await this.fetchImpl(this.config.jwksUri, {
        redirect: 'error',
        signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (response.status !== 200) return;
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_JWKS_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      const text = await response.text();
      if (text.length > MAX_JWKS_BYTES) return;
      const parsed: unknown = JSON.parse(text);
      const keys = new Map<string, KeyObject>();
      if (isPlainObject(parsed) && Array.isArray(parsed.keys)) {
        for (const jwk of parsed.keys) {
          if (
            isPlainObject(jwk) &&
            jwk.kty === 'RSA' &&
            typeof jwk.kid === 'string' &&
            (jwk.use === undefined || jwk.use === 'sig')
          ) {
            keys.set(
              jwk.kid,
              createPublicKey({ key: jwk as never, format: 'jwk' }),
            );
          }
        }
      }
      if (keys.size > 0) {
        this.keys = keys;
        this.fetchedAt = this.now();
      }
    } catch {
      // Keep serving the cached keys; an unknown kid then fails closed.
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
