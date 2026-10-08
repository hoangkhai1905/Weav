import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Already-localized message shown under the field (also announced as an alert). */
  error?: string | null;
  hint?: string;
  icon?: LucideIcon;
  /** Adds a show / hide toggle for password fields. */
  secure?: boolean;
}

/** Labelled input with an inline error. 44 pt tall, error text is linked by accessibilityLabel. */
export const TextField: React.FC<TextFieldProps> = ({ label, error, hint, icon: Icon, secure = false, ...input }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const border = error ? colors.danger : focused ? colors.primary : colors.borderStrong;
  return (
    <View style={styles.group}>
      <Text style={[Typography.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={[styles.box, { backgroundColor: colors.card, borderColor: border }]}>
        {Icon ? <Icon size={18} color={focused ? colors.primary : colors.textSubtle} /> : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          {...input}
          secureTextEntry={secure && !visible}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[Typography.body, styles.input, { color: colors.text }]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(visible ? 'ui.hidePassword' : 'ui.showPassword')}
            onPress={() => setVisible((v) => !v)}
            style={styles.eye}
          >
            {visible ? <EyeOff size={18} color={colors.textSubtle} /> : <Eye size={18} color={colors.textSubtle} />}
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[Typography.caption, { color: colors.textSubtle }]}>{hint}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  group: { gap: Spacing.one },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  // The box already shows the focus border; outlineWidth removes the second, browser-drawn ring on web.
  input: { flex: 1, minHeight: MinTouch, paddingVertical: Spacing.one, outlineWidth: 0 } as TextStyle,
  eye: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.two },
});
