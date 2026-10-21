/** Class strings copied from apps/web (ExecutionsOverviewPage, uiClasses, statusBadgeClass). Mirror changes there. */
export const fieldCls = 'h-8 rounded-md border border-border-strong bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring';
export const btnCls = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimaryCls = 'inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-primary bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const inputCls = 'h-10 w-full rounded-md border border-border-strong bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring';
export const iconBtnCls = 'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export const th = 'h-8 whitespace-nowrap border-b border-border bg-subtle px-3 text-left text-xs font-medium text-muted-foreground';
export const td = 'h-10 border-b border-border px-3';
export const CARD = 'rounded-xl border border-border bg-card';

export type StatusTone = 'ok' | 'run' | 'warn' | 'err' | 'pause';

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-ok-bg text-ok',
  run: 'bg-run-bg text-run',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  pause: 'bg-pause-bg text-pause',
};

/** Flat status pill: dot + label, colour carries the meaning. */
export const statusBadgeClass = (tone: StatusTone) =>
  `inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] ${TONE_CLASS[tone]}`;
