/**
 * Single source of design tokens: colours (light + dark), spacing, radius,
 * typography. Raw colour values live in ./palette.ts (pure, testable).
 */

import { Platform, type FontVariant } from 'react-native';

import { palette, type ColorPalette, type StatusTone, type ToneColors } from './palette';

export { palette };
export type { ColorPalette, StatusTone, ToneColors };

/** Keys used by the template components (themed-text, app-tabs, ...). */
function templateColors(p: ColorPalette) {
  return {
    text: p.text,
    background: p.bg,
    backgroundElement: p.cardSecondary,
    backgroundSelected: p.border,
    textSecondary: p.textMuted,
  } as const;
}

export const Colors = {
  light: templateColors(palette.light),
  dark: templateColors(palette.dark),
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    /** IDs, durations, JSON. */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    // global.css is not loaded by the app, so the var() form never resolved (serif fallback).
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Small, restrained corners: 6 for controls and chips, 8 for surfaces. `pill` is only for dots and avatars. */
export const Radius = { sm: 6, md: 8, lg: 8, pill: 999 } as const;

/** No fixed heights on text containers: lineHeight scales with Dynamic Type. */
export const Typography = {
  caption: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  /** Small muted heading above a group of rows; render with textTransform: 'uppercase'. */
  section: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.6 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const, letterSpacing: -0.2 },
  /** Stats and durations: digits keep one width so columns line up. */
  number: { fontSize: 24, lineHeight: 30, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as FontVariant[] },
  mono: { fontSize: 13, lineHeight: 19 },
} as const;

/** Minimum touch target (points). */
export const MinTouch = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
