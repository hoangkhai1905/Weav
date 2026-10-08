import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Spacing, Typography } from '../../constants/theme';

/** Renders nothing while online. isConnected is null until the first reading. */
export const OfflineBanner: React.FC = () => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const net = useNetInfo();
  const insets = useSafeAreaInsets();
  if (net.isConnected !== false && net.isInternetReachable !== false) return null;
  const tone = colors.tones.warning;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: tone.bg, borderColor: tone.border, paddingTop: insets.top + Spacing.two }]}
    >
      <WifiOff size={16} color={tone.fg} />
      <Text style={[Typography.label, styles.text, { color: tone.fg }]}>{t('ui.offline')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  text: { flex: 1 },
});
