import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'sm' }) => {
  const colors = useThemeColors();
  const upper = status.toUpperCase();

  let bg = colors.cardSecondary;
  let text = colors.textMuted;
  let border = colors.border;
  let dotColor = colors.textSubtle;

  if (upper === 'PUBLISHED' || upper === 'SUCCESS' || upper === 'CONNECTED') {
    bg = colors.successBg;
    text = colors.success;
    border = colors.isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(5, 150, 105, 0.3)';
    dotColor = colors.success;
  } else if (upper === 'RUNNING' || upper === 'QUEUED') {
    bg = colors.primaryBg;
    text = colors.primary;
    border = colors.primaryBorder;
    dotColor = colors.primary;
  } else if (upper === 'PAUSED' || upper === 'WARNING' || upper === 'EXPIRED') {
    bg = colors.warningBg;
    text = colors.warning;
    border = colors.isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(217, 119, 6, 0.3)';
    dotColor = colors.warning;
  } else if (upper === 'FAILED' || upper === 'DISCONNECTED') {
    bg = colors.dangerBg;
    text = colors.danger;
    border = colors.isDark ? 'rgba(244, 63, 94, 0.3)' : 'rgba(225, 29, 72, 0.3)';
    dotColor = colors.danger;
  }

  const isSm = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }, isSm ? styles.smBadge : styles.mdBadge]}>
      <View style={[styles.dot, { backgroundColor: dotColor }, isSm ? styles.smDot : styles.mdDot]} />
      <Text style={[styles.text, { color: text }, isSm ? styles.smText : styles.mdText]}>{upper}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  smBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 5,
  },
  mdBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 6,
  },
  dot: {
    borderRadius: 999,
  },
  smDot: {
    width: 6,
    height: 6,
  },
  mdDot: {
    width: 8,
    height: 8,
  },
  text: {
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  smText: {
    fontSize: 10,
  },
  mdText: {
    fontSize: 12,
  },
});
