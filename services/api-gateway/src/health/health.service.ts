import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../config/gateway.config';

type ProbeStatus = { status: 'up' | 'down' };

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

  constructor(config: ConfigService) {
    this.gateway = config.getOrThrow<GatewayConfig>('gateway');
  }

  liveness(): { status: 'ok'; details: { gateway: { status: 'up' } } } {
    return { status: 'ok', details: { gateway: { status: 'up' } } };
  }

  // Readiness is the gateway's own state only; an upstream outage yields 503
  // per proxied route, not a failed probe (X-10).
  readiness(): { status: 'ok'; details: { gateway: { status: 'up' } } } {
    return this.liveness();
  }

  // Diagnostic fan-out to upstream readiness; not used as a probe.
  async upstreams(): Promise<GatewayHealthSnapshot> {
    const [identity, workspace] = await Promise.all([
      this.probe(this.gateway.upstreams.identity),
      this.probe(this.gateway.upstreams.workspace),
    ]);
    const details = { identity, workspace };
    const ready = Object.values(details).every(
      (detail) => detail.status === 'up',
    );
    return { status: ready ? 'ok' : 'error', details };
  }

  private async probe(baseUrl: string): Promise<ProbeStatus> {
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
      return { status: response.status === 200 ? 'up' : 'down' };
    } catch {
      return { status: 'down' };
    } finally {
      clearTimeout(timer);
    }
  }
}
