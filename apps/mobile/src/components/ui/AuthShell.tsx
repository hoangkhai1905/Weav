import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { Logo } from '../common/Logo';
import { Radius, Spacing, Typography } from '../../constants/theme';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/** Shared frame of Login / Register / Forgot password: logo, one flat card, no decoration. */
export const AuthShell: React.FC<AuthShellProps> = ({ title, subtitle, children }) => {
  const colors = useThemeColors();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <View style={styles.brand}>
            <Logo size="md" showSubtitle />
          </View>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text accessibilityRole="header" style={[Typography.headline, { color: colors.text }]}>
              {title}
            </Text>
            {subtitle ? <Text style={[Typography.body, { color: colors.textMuted }]}>{subtitle}</Text> : null}
            {children}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.three },
  inner: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: Spacing.four },
  brand: { alignItems: 'center' },
  card: { gap: Spacing.three, padding: Spacing.four, borderWidth: 1, borderRadius: Radius.lg },
});
