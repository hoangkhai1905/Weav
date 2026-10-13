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
  /** Accent: links, active tab, focus, "running". */
  primary: string;
  onPrimary: string;
  /** Main action button: ink fill, not the accent. */
  button: string;
  onButton: string;
  skeleton: string;
  overlay: string;
  headerBg: string;
  tones: Record<StatusTone, ToneColors>;
}

// Warm neutrals, hairline borders, one blue accent for links/selection; main buttons are ink.
// Status tones are flat tints (soft background + coloured text); WCAG AA is locked by palette.contrast.test.cjs.
export const palette: { light: ColorPalette; dark: ColorPalette } = {
  light: {
    bg: '#f6f5f2',
    card: '#ffffff',
    cardSecondary: '#f1efeb',
    border: '#e6e3de',
    borderStrong: '#d3cec6',
    text: '#1d1b18',
    textMuted: '#54504a',
    textSubtle: '#6b655d',
    primary: '#2456c7',
    onPrimary: '#ffffff',
    button: '#1d1b18',
    onButton: '#ffffff',
    skeleton: '#ece9e4',
    overlay: 'rgba(29, 27, 24, 0.4)',
    headerBg: '#ffffff',
    tones: {
      neutral: { fg: '#54504a', bg: '#f1efeb', border: '#e6e3de' },
      info: { fg: '#2456c7', bg: '#e9effb', border: '#c9d7f4' },
      warning: { fg: '#7f5300', bg: '#f6eccf', border: '#e8d59e' },
      success: { fg: '#2b6a37', bg: '#e5f0e3', border: '#c3dcc0' },
      danger: { fg: '#a1302a', bg: '#fae7e5', border: '#efc4bf' },
    },
  },
  dark: {
    bg: '#131211',
    card: '#1a1917',
    cardSecondary: '#211f1d',
    border: '#2c2926',
    borderStrong: '#3a3632',
    text: '#ece9e4',
    textMuted: '#b5afa7',
    textSubtle: '#968f86',
    primary: '#8eaef3',
    onPrimary: '#131211',
    button: '#ece9e4',
    onButton: '#131211',
    skeleton: '#272522',
    overlay: 'rgba(0, 0, 0, 0.6)',
    headerBg: '#1a1917',
    tones: {
      neutral: { fg: '#b5afa7', bg: '#211f1d', border: '#3a3632' },
      info: { fg: '#8eaef3', bg: '#1c2538', border: '#2c3b5c' },
      warning: { fg: '#e3b860', bg: '#2a2214', border: '#4a3d1e' },
      success: { fg: '#86c595', bg: '#18271c', border: '#2a4a33' },
      danger: { fg: '#f2948a', bg: '#2e1a18', border: '#5a2e29' },
    },
  },
};
