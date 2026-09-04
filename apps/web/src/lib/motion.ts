export const MOTION_EASE = [0.16, 1, 0.3, 1] as const;

export const MOTION_DURATION = {
  feedback: 0.12,
  state: 0.2,
  panel: 0.3,
  packet: 0.55,
} as const;

export const MOTION_TRANSITION = {
  duration: MOTION_DURATION.state,
  ease: MOTION_EASE,
} as const;

export const REDUCED_MOTION_TRANSITION = { duration: 0.01 } as const;
