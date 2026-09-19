import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type { GatewayConfig } from '../config/gateway.config';

const READINESS_PATH = '/actuator/health/readiness';
const READINESS_TIMEOUT_MS = 2_000;

export interface GatewayHealthDetails {
  identity: { status: 'up' | 'down' };
  workspace: { status: 'up' | 'down' };
}

export interface GatewayHealthSnapshot {
  status: 'ok' | 'error';
  details: GatewayHealthDetails;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('health probe aborted');
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw abortError(signal);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(abortError(signal));
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    void reader.read().then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error('health probe body read failed'),
        );
      },
    );
  });
}

async function readResponseBody(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    if (signal.aborted) throw abortError(signal);
    return;
  }

  try {
    while (true) {
      const result = await readChunk(reader, signal);
      if (result.done) return;
    }
  } finally {
    if (signal.aborted) {
      try {
        await reader.cancel(signal.reason);
      } catch {
        // The upstream connection is already being discarded.
      }
    }
    reader.releaseLock();
  }
}

@Injectable()
export class GatewayHealthService {
  private readonly gateway: GatewayConfig;

  constructor(
    config: ConfigService,
    private readonly indicators: HealthIndicatorService,
  ) {
    this.gateway = config.getOrThrow<GatewayConfig>('gateway');
  }

  liveness(): { status: 'ok'; details: { gateway: { status: 'up' } } } {
    const gateway = this.indicators.check('gateway').up();
    return {
      status: 'ok',
      details: { gateway: gateway.gateway },
    };
  }

  async readiness(): Promise<GatewayHealthSnapshot> {
    const [identity, workspace] = await Promise.all([
      this.probe('identity', this.gateway.upstreams.identity),
      this.probe('workspace', this.gateway.upstreams.workspace),
    ]);
    const details = {
      identity: identity.identity,
      workspace: workspace.workspace,
    };
    const ready = Object.values(details).every(
      (detail) => detail.status === 'up',
    );
    return { status: ready ? 'ok' : 'error', details };
  }

  private async probe(
    name: 'identity' | 'workspace',
    baseUrl: string,
  ): Promise<HealthIndicatorResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${baseUrl.replace(/\/+$/, '')}${READINESS_PATH}`,
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        },
      );
      await readResponseBody(response, controller.signal);
      if (controller.signal.aborted) {
        throw abortError(controller.signal);
      }
      return response.status === 200
        ? this.indicators.check(name).up()
        : this.indicators.check(name).down();
    } catch {
      return this.indicators.check(name).down();
    } finally {
      clearTimeout(timer);
    }
  }
}
