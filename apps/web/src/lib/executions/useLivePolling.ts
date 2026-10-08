import { useEffect, useRef } from 'react';

/** What a poll tick reports: nothing/true = ok, false = failed (back off), 'stop' = stop polling (for example 401). */
export type TickResult = boolean | 'stop' | void;

const MAX_BACKOFF_MS = 30_000;

/** True for an API error carrying HTTP 401 (the session is gone; polling cannot succeed). */
export function isUnauthorized(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { status?: unknown }).status === 401;
}

/** Tick result for a caught error: stop on 401, otherwise report a failure. */
export const failureOf = (cause: unknown): TickResult => (isUnauthorized(cause) ? 'stop' : false);

/**
 * Calls `tick` every `intervalMs` while `active`, never overlapping two calls (the next one is scheduled after the
 * previous settles) and paused while the tab is hidden (it refreshes right away when the tab is visible again).
 * A failed tick (returns false or throws) doubles the wait up to 30 s; a good one resets it. A 401 stops polling.
 * Stops when `active` turns false and on unmount.
 */
export function useLivePolling(active: boolean, tick: () => Promise<TickResult>, intervalMs = 2000): void {
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let running = false;
    let failures = 0;
    let timer: number | undefined;

    const schedule = () => {
      if (stopped || document.hidden) return;
      timer = window.setTimeout(() => void run(), Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures));
    };
    const run = async () => {
      if (stopped || running) return;
      running = true;
      let result: TickResult;
      try {
        result = await tickRef.current();
      } catch (cause) {
        result = failureOf(cause);
      }
      running = false;
      if (result === 'stop') {
        stopped = true;
        return;
      }
      failures = result === false ? Math.min(failures + 1, 10) : 0;
      schedule();
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) void run();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs]);
}

export const isLiveStatus = (status: string | undefined): boolean => status === 'RUNNING' || status === 'QUEUED';
