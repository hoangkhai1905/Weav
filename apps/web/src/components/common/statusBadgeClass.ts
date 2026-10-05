export type StatusTone = 'ok' | 'run' | 'warn' | 'err' | 'pause';

export const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok',
  run: 'bg-run-bg text-run',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  pause: 'bg-pause-bg text-pause',
};

/** Flat status pill: 20px tall, dot + label, colour carries the meaning. */
export const statusBadgeClass = (tone: StatusTone) =>
  `inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded px-1.5 text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] ${TONE_CLASS[tone]}`;
