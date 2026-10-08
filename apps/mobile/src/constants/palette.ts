// Pure colour data (no react-native import) so Node tests can load it.
// Consumers should import from '@/constants/theme', which re-exports this.

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export interface ToneColors {
  fg: string;
  bg: string;
  border: string;
}

export interface ColorPalette {
  bg: string;
  card: string;
  cardSecondary: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  onPrimary: string;
  skeleton: string;
  overlay: string;
  headerBg: string;
  tones: Record<StatusTone, ToneColors>;
}

// Minimal direction: neutral grays, hairline borders, one deep-blue accent.
// Status tones are flat tints (soft background + coloured text); WCAG AA is locked by palette.contrast.test.cjs.
export const palette: { light: ColorPalette; dark: ColorPalette } = {
  light: {
    bg: '#fafafa',
    card: '#ffffff',
    cardSecondary: '#f4f4f5',
    border: '#e5e7eb',
    borderStrong: '#d1d5db',
    text: '#0a0a0a',
    textMuted: '#52525b',
    textSubtle: '#686873',
    primary: '#2563eb',
    onPrimary: '#ffffff',
    skeleton: '#ececee',
    overlay: 'rgba(10, 10, 10, 0.4)',
    headerBg: '#ffffff',
    tones: {
      neutral: { fg: '#52525b', bg: '#f4f4f5', border: '#e5e7eb' },
      info: { fg: '#1d4ed8', bg: '#eff4ff', border: '#cddcfb' },
      warning: { fg: '#92400e', bg: '#fdf6e7', border: '#f3dfb0' },
      success: { fg: '#166534', bg: '#edf8f1', border: '#c3e6d0' },
      danger: { fg: '#b91c1c', bg: '#fdf1f1', border: '#f4cccc' },
    },
  },
  dark: {
    bg: '#0b0b0c',
    card: '#131314',
    cardSecondary: '#1b1b1d',
    border: '#27272a',
    borderStrong: '#3f3f46',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    textSubtle: '#8e8e98',
    primary: '#6b9bff',
    onPrimary: '#0a0a0a',
    skeleton: '#232326',
    overlay: 'rgba(0, 0, 0, 0.6)',
    headerBg: '#131314',
    tones: {
      neutral: { fg: '#b4b4bd', bg: '#1b1b1d', border: '#2f2f33' },
      info: { fg: '#8db0ff', bg: '#161d30', border: '#26335a' },
      warning: { fg: '#e8b75a', bg: '#26200f', border: '#4a3d18' },
      success: { fg: '#6fcf97', bg: '#102319', border: '#1f4a31' },
      danger: { fg: '#f28b8b', bg: '#2a1414', border: '#552424' },
    },
  },
};
