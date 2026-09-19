import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { GatewayConfig } from '../config/gateway.config';

export interface AccessPrincipal {
  sub: string;
  sid: string;
  jti: string;
  system_role: 'USER' | 'ADMIN';
  user_status: 'ACTIVE';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AccessTokenService {
  constructor(private readonly config: ConfigService) {}

  async verify(token: string): Promise<AccessPrincipal> {
    const { jwt } = this.config.getOrThrow<GatewayConfig>('gateway');
    try {
      const now = Date.now() / 1000;
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(jwt.accessSecret),
        {
          algorithms: ['HS256'],
          issuer: jwt.issuer,
          audience: jwt.audience,
          clockTolerance: jwt.clockSkewSeconds,
          currentDate: new Date(now * 1000),
          requiredClaims: [
            'sub',
            'sid',
            'jti',
            'iat',
            'nbf',
            'exp',
            'token_use',
            'system_role',
            'user_status',
          ],
        },
      );
      const { sub, sid, jti, iat, nbf, exp, system_role, user_status } =
        payload;
      if (
        typeof sub !== 'string' ||
        !UUID.test(sub) ||
        typeof sid !== 'string' ||
        !UUID.test(sid) ||
        typeof jti !== 'string' ||
        !UUID.test(jti) ||
        typeof iat !== 'number' ||
        !Number.isFinite(iat) ||
        typeof nbf !== 'number' ||
        !Number.isFinite(nbf) ||
        typeof exp !== 'number' ||
        !Number.isFinite(exp) ||
        exp <= iat ||
        exp <= nbf ||
        iat > now + jwt.clockSkewSeconds ||
        nbf > now + jwt.clockSkewSeconds ||
        exp + jwt.clockSkewSeconds <= now ||
        payload.token_use !== 'access' ||
        (system_role !== 'USER' && system_role !== 'ADMIN') ||
        user_status !== 'ACTIVE'
      ) {
        throw new UnauthorizedException();
      }
      return { sub, sid, jti, system_role, user_status };
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
