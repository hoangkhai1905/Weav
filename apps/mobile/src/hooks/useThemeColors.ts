import { palette, type ColorPalette } from '../constants/palette';
import { useColorScheme } from 'react-native';
import { useUIStore } from '../stores/ui.store';

export interface ThemeColors {
  isDark: boolean;
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
  primaryBg: string;
  primaryBorder: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  skeleton: string;
  overlay: string;
  tabBg: string;
  tabBorder: string;
  headerBg: string;
  /** Semantic status tones, shared by badges and timelines. */
  tones: ColorPalette['tones'];
}

function toThemeColors(p: ColorPalette, isDark: boolean): ThemeColors {
  const { info, success, danger, warning } = p.tones;
  return {
    isDark,
    bg: p.bg,
    card: p.card,
    cardSecondary: p.cardSecondary,
    border: p.border,
    borderStrong: p.borderStrong,
    text: p.text,
    textMuted: p.textMuted,
    textSubtle: p.textSubtle,
    primary: p.primary,
    onPrimary: p.onPrimary,
    primaryBg: info.bg,
    primaryBorder: info.border,
    success: success.fg,
    successBg: success.bg,
    danger: danger.fg,
    dangerBg: danger.bg,
    warning: warning.fg,
    warningBg: warning.bg,
    skeleton: p.skeleton,
    overlay: p.overlay,
    tabBg: p.card,
    tabBorder: p.border,
    headerBg: p.headerBg,
    tones: p.tones,
  };
}

const LIGHT = toThemeColors(palette.light, false);
const DARK = toThemeColors(palette.dark, true);

export function useThemeColors(): ThemeColors {
  const mode = useUIStore((s) => s.themeMode);
  const system = useColorScheme();
  const dark = mode === 'system' ? system === 'dark' : mode === 'dark';
  return dark ? DARK : LIGHT;
}
