/** Weav "W" tile: ink square with the page colour for the mark. Decorative; pair with a text label. */
export function WeavMark({ className = 'h-[26px] w-[26px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="28" height="28" rx="7" className="fill-foreground" />
      <path d="M6 9l4 11 4-8 4 8 4-11" fill="none" className="stroke-background" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The assistant robot: antenna dot is the accent blue, the mouth is the W of the logo. Uses currentColor for strokes. */
export function WeavBotMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d="M16 8V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="16" cy="4" r="2.2" className="fill-run" />
      <rect x="5" y="9" width="22" height="17" rx="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="16" r="1.9" fill="currentColor" />
      <circle cx="20" cy="16" r="1.9" fill="currentColor" />
      <path d="M11.5 20.5l2.2 2.2 2.3-2.2 2.3 2.2 2.2-2.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
