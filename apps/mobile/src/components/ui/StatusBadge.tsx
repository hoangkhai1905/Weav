import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Radius } from '../../constants/theme';
import { statusInfo } from './status';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

/** Flat status badge: soft tint, coloured dot and a plain-language label (never colour alone). */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const info = statusInfo(status);
  const tone = colors.tones[info.tone];
  const isSm = size === 'sm';
  const label = t(info.labelKey);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: tone.bg }, isSm ? styles.sm : styles.md]}
    >
      <View style={[styles.dot, { backgroundColor: tone.fg }]} />
      <Text style={[styles.text, { color: tone.fg, fontSize: isSm ? 12 : 13 }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
  },
  sm: { paddingHorizontal: 8, paddingVertical: 2, gap: 6 },
  md: { paddingHorizontal: 10, paddingVertical: 4, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontWeight: '500' },
});
