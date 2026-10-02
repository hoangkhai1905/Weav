import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { ServiceJwtVerifier } from './service-jwt-verifier';

/** AI-6: a missing/invalid JWKS leaves readiness at 503 but is logged (error class + path only, never key material). */
export function loadVerifier(
  file: string | undefined,
  logger: Pick<Logger, 'error'> = new Logger('bootstrap'),
): ServiceJwtVerifier | null {
  if (!file) return null;
  try {
    return ServiceJwtVerifier.fromJwks(readFileSync(file, 'utf8'));
  } catch (error) {
    logger.error({
      msg: 'JWKS load failed',
      errorClass: (error as Error)?.constructor?.name,
      file,
    });
    return null;
  }
}
