import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

/** Shared 44 pt button for the Home / AI / Assistant screens. */
export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy = false,
  disabled = false,
  accessibilityHint,
}) => {
  const colors = useThemeColors();
  const palette = {
    primary: { bg: colors.primary, border: colors.primary, fg: colors.onPrimary },
    secondary: { bg: colors.card, border: colors.borderStrong, fg: colors.text },
    danger: { bg: colors.dangerBg, border: colors.tones.danger.border, fg: colors.danger },
  }[variant];
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.btn, { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.55 : 1 }]}
    >
      {busy ? <ActivityIndicator color={palette.fg} /> : icon}
      <Text style={[Typography.label, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
