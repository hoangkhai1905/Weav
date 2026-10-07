import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  actionLabel,
  onAction,
}) => {
  const colors = useThemeColors();
  return (
    <View style={styles.wrap}>
      {icon}
      <Text accessibilityRole="header" style={[Typography.title, styles.center, { color: colors.text }]}>
        {title}
      </Text>
      {description ? (
        <Text style={[Typography.body, styles.center, { color: colors.textMuted }]}>{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[Typography.label, { color: colors.onPrimary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.two, padding: Spacing.four },
  center: { textAlign: 'center' },
  button: {
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    borderRadius: Radius.md,
    marginTop: Spacing.two,
  },
});
