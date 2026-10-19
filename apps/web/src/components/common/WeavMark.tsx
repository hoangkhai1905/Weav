/** Weav app-icon mark (docs/brand/weav-app-icon.svg, same as public/icon-192.png). Decorative; pair with a text label. */
export function WeavMark({ className = 'h-[26px] w-[26px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={`shrink-0 ${className}`} aria-hidden="true" data-testid="weav-mark">
      <rect width="256" height="256" rx="57.6" fill="#2b5fd9" />
      <g transform="translate(36 36) scale(0.71875)" fill="#fff">
        <path d="M33.99 82.37L33.99 212A27 27 0 0 0 87.99 212L87.99 113.55Z" />
        <path d="M105.99 215.2L218.25 150.38A27 27 0 0 0 191.25 103.62L105.99 152.84Z" />
        <path d="M185.01 86.43L72.75 21.62A27 27 0 0 0 45.75 68.38L131.01 117.61Z" />
      </g>
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
