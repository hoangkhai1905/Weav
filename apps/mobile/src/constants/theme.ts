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

/** Loaded in app/_layout.tsx. Custom fonts need one family per weight (no weight synthesis on Android). */
export const FontFamily = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
  mono: 'JetBrainsMono_400Regular',
} as const;

export const Fonts = {
  sans: FontFamily.regular,
  serif: Platform.select({ ios: 'ui-serif', web: 'Georgia, serif', default: 'serif' }),
  rounded: FontFamily.regular,
  /** IDs, durations, clock times, JSON. */
  mono: FontFamily.mono,
};

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** 6 for chips, 8 for buttons and inputs, 12 for cards. `pill` is for status pills, dots and avatars. */
export const Radius = { sm: 6, md: 8, lg: 12, pill: 999 } as const;

/** No fixed heights on text containers: lineHeight scales with Dynamic Type. */
export const Typography = {
  caption: { fontSize: 13, lineHeight: 18, fontFamily: FontFamily.regular },
  body: { fontSize: 15, lineHeight: 22, fontFamily: FontFamily.regular },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const, fontFamily: FontFamily.semibold },
  /** Small muted heading above a group of rows; render with textTransform: 'uppercase'. */
  section: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.6, fontFamily: FontFamily.semibold },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const, fontFamily: FontFamily.semibold },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const, letterSpacing: -0.2, fontFamily: FontFamily.semibold },
  /** Stats and durations: digits keep one width so columns line up. */
  number: { fontSize: 24, lineHeight: 30, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as FontVariant[], fontFamily: FontFamily.mono },
  mono: { fontSize: 13, lineHeight: 19, fontFamily: FontFamily.mono },
} as const;

/** Minimum touch target (points). */
export const MinTouch = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
