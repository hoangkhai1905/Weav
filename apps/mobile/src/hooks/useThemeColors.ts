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
  primaryBg: string;
  primaryBorder: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  tabBg: string;
  tabBorder: string;
  headerBg: string;
}

export function useThemeColors(): ThemeColors {
  const theme = useUIStore((s) => s.theme);
  const isDark = theme === 'dark';

  if (isDark) {
    return {
      isDark: true,
      bg: '#090d16',
      card: '#0f172a',
      cardSecondary: '#1e293b',
      border: '#1e293b',
      borderStrong: '#334155',
      text: '#f8fafc',
      textMuted: '#94a3b8',
      textSubtle: '#64748b',
      primary: '#8b5cf6',
      primaryBg: 'rgba(139, 92, 246, 0.15)',
      primaryBorder: 'rgba(139, 92, 246, 0.3)',
      success: '#34d399',
      successBg: 'rgba(16, 185, 129, 0.15)',
      danger: '#fb7185',
      dangerBg: 'rgba(244, 63, 94, 0.15)',
      warning: '#fbbf24',
      warningBg: 'rgba(245, 158, 11, 0.15)',
      tabBg: '#0f172a',
      tabBorder: '#1e293b',
      headerBg: 'rgba(15, 23, 42, 0.95)',
    };
  }

  return {
    isDark: false,
    bg: '#f8fafc',
    card: '#ffffff',
    cardSecondary: '#f1f5f9',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    text: '#0f172a',
    textMuted: '#475569',
    textSubtle: '#64748b',
    primary: '#6d28d9',
    primaryBg: 'rgba(109, 40, 217, 0.1)',
    primaryBorder: 'rgba(109, 40, 217, 0.25)',
    success: '#059669',
    successBg: 'rgba(5, 150, 105, 0.1)',
    danger: '#e11d48',
    dangerBg: 'rgba(225, 29, 72, 0.1)',
    warning: '#d97706',
    warningBg: 'rgba(217, 119, 6, 0.1)',
    tabBg: '#ffffff',
    tabBorder: '#e2e8f0',
    headerBg: 'rgba(255, 255, 255, 0.95)',
  };
}
