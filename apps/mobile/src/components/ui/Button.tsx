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
  testID?: string;
}

/** Shared 44 pt button. Primary = solid accent; secondary = white with a hairline; danger = red text on white. */
export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy = false,
  disabled = false,
  accessibilityHint,
  testID,
}) => {
  const colors = useThemeColors();
  const palette = {
    primary: { bg: colors.primary, border: colors.primary, fg: colors.onPrimary },
    secondary: { bg: colors.card, border: colors.borderStrong, fg: colors.text },
    danger: { bg: colors.card, border: colors.tones.danger.border, fg: colors.danger },
  }[variant];
  const inactive = busy || disabled;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
      ]}
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
