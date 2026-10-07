/**
 * Single source of design tokens: colours (light + dark), spacing, radius,
 * typography. Raw colour values live in ./palette.ts (pure, testable).
 */

import { Platform } from 'react-native';

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
    mono: 'var(--font-mono)',
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

export const Radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** No fixed heights on text containers: lineHeight scales with Dynamic Type. */
export const Typography = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  mono: { fontSize: 13, lineHeight: 19 },
} as const;

/** Minimum touch target (points). */
export const MinTouch = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
