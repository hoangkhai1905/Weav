export type StatusTone = 'ok' | 'run' | 'warn' | 'err' | 'pause';

export const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok',
  run: 'bg-run-bg text-run',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  pause: 'bg-pause-bg text-pause',
};

/** Flat status pill: 22px tall, fully rounded, dot + label, colour carries the meaning. */
export const statusBadgeClass = (tone: StatusTone) =>
  `inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] ${TONE_CLASS[tone]}`;
