/** Shared class strings for the v2 look (Claude Design): ink primary button, outlined secondary, flat cards. */
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const BTN_BASE = `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;

export const BTN_PRIMARY = `${BTN_BASE} h-9 border-primary bg-primary px-3.5 text-primary-foreground hover:bg-primary-hover`;
export const BTN_SECONDARY = `${BTN_BASE} h-9 border-border-strong bg-card px-3.5 text-foreground hover:bg-subtle`;
export const BTN_SM = 'h-[30px] px-2.5 text-[13px]';
export const ICON_BTN = `relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-muted hover:text-foreground ${FOCUS}`;
export const CARD = 'rounded-xl border border-border bg-card';
export const LINK = `rounded-sm font-medium text-accent-ink hover:underline ${FOCUS}`;
export const FOCUS_RING = FOCUS;
