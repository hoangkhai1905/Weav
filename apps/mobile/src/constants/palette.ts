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

export const palette: { light: ColorPalette; dark: ColorPalette } = {
  light: {
    bg: '#f6f8fa',
    card: '#ffffff',
    cardSecondary: '#eef1f5',
    border: '#d8dee6',
    borderStrong: '#b8c2cf',
    text: '#0f1720',
    textMuted: '#465363',
    textSubtle: '#5d6a7a',
    primary: '#0a6c9c',
    onPrimary: '#ffffff',
    skeleton: '#e3e8ee',
    overlay: 'rgba(15, 23, 32, 0.5)',
    headerBg: 'rgba(255, 255, 255, 0.95)',
    tones: {
      neutral: { fg: '#465363', bg: '#eef1f5', border: '#c9d1db' },
      info: { fg: '#0b5f8a', bg: '#e1f1fa', border: '#a9d3ea' },
      warning: { fg: '#7d4400', bg: '#fdf0d5', border: '#ebca85' },
      success: { fg: '#136c43', bg: '#dff4e7', border: '#9fd6b6' },
      danger: { fg: '#b4162c', bg: '#fde4e7', border: '#f0a9b3' },
    },
  },
  dark: {
    bg: '#0d1117',
    card: '#161b22',
    cardSecondary: '#1f2630',
    border: '#2a323d',
    borderStrong: '#3d4857',
    text: '#e6edf3',
    textMuted: '#a7b3c2',
    textSubtle: '#8794a5',
    primary: '#4cb3e6',
    onPrimary: '#06222f',
    skeleton: '#232b36',
    overlay: 'rgba(0, 0, 0, 0.6)',
    headerBg: 'rgba(22, 27, 34, 0.95)',
    tones: {
      neutral: { fg: '#c5cfdb', bg: '#1f2630', border: '#3d4857' },
      info: { fg: '#7cc4ec', bg: '#10303f', border: '#1f5a78' },
      warning: { fg: '#f0b95a', bg: '#3a2a0c', border: '#6e5116' },
      success: { fg: '#6fd49b', bg: '#0f3321', border: '#1e6a42' },
      danger: { fg: '#ff9aa6', bg: '#40131b', border: '#7f2a38' },
    },
  },
};
