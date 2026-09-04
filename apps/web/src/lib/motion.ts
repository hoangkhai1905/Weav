import type { Variants, Transition } from 'framer-motion';

// Standard motion timing & easing constants
export const MOTION_DURATION = {
  feedback: 0.15,
  state: 0.25,
  packet: 1.2,
};

export const MOTION_EASE = [0.16, 1, 0.3, 1] as const; // Custom cubic-bezier for snappy industrial UI

export const MOTION_TRANSITION: Transition = {
  duration: MOTION_DURATION.state,
  ease: MOTION_EASE,
};

export const REDUCED_MOTION_TRANSITION: Transition = {
  duration: 0.01,
};

export const springTransition: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
};

export const smoothTransition: Transition = {
  duration: 0.25,
  ease: MOTION_EASE,
};

// Page Entrance Variants
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

// Staggered Container for Lists & Grid Cards
export const staggerContainer: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
};

// Interactive Micro-interactions
export const buttonPress: Variants = {
  initial: { scale: 1 },
  hover: { scale: 1.015, transition: { duration: 0.1 } },
  tap: { scale: 0.97, transition: { duration: 0.05 } },
};

export const cardHover: Variants = {
  initial: { y: 0, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' },
  hover: { y: -2, boxShadow: '0 4px 12px 0 rgba(0,0,0,0.08)', transition: { duration: 0.15 } },
};

// Sliding Panels & Inspector Drawers
export const panelSlideRight: Variants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1, transition: springTransition },
  exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
};

export const panelSlideUp: Variants = {
  initial: { y: '100%', opacity: 0 },
  animate: { y: 0, opacity: 1, transition: springTransition },
  exit: { y: '100%', opacity: 0, transition: { duration: 0.2 } },
};

// Modal Scale & Backdrop
export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalScale: Variants = {
  initial: { opacity: 0, scale: 0.95, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: springTransition },
  exit: { opacity: 0, scale: 0.95, y: 8, transition: { duration: 0.15 } },
};

// Reduced Motion Fallback Variants (instantly visible, zero layout shifts)
export const reducedMotionVariants: Variants = {
  initial: { opacity: 1, y: 0, scale: 1 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0 } },
  exit: { opacity: 1, y: 0, scale: 1, transition: { duration: 0 } },
};
