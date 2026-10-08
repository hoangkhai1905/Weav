import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Ban,
  CircleCheck,
  CircleDot,
  CircleX,
  Circle,
  Clock,
  FilePen,
  Hourglass,
  Loader,
  Pause,
  SkipForward,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Radius } from '../../constants/theme';
import { statusInfo, type StatusIconName } from './status';

const ICONS: Record<StatusIconName, LucideIcon> = {
  Clock,
  Loader,
  Hourglass,
  CircleCheck,
  CircleX,
  Ban,
  SkipForward,
  Circle,
  CircleDot,
  FilePen,
  Pause,
  TriangleAlert,
};

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

/** Status is always shown as colour + icon + plain-language label. */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const info = statusInfo(status);
  const tone = colors.tones[info.tone];
  const Icon = ICONS[info.icon];
  const isSm = size === 'sm';
  const label = t(info.labelKey);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        { backgroundColor: tone.bg, borderColor: tone.border },
        isSm ? styles.sm : styles.md,
      ]}
    >
      <Icon size={isSm ? 12 : 14} color={tone.fg} />
      <Text style={[styles.text, { color: tone.fg, fontSize: isSm ? 12 : 13 }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  sm: { paddingHorizontal: 8, paddingVertical: 2, gap: 4 },
  md: { paddingHorizontal: 12, paddingVertical: 4, gap: 6 },
  text: { fontWeight: '700' },
});
