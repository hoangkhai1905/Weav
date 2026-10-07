import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { translations } from '../../stores/i18n.store';
import { MinTouch, Fonts, Radius, Spacing, Typography } from '../../constants/theme';
import type { ApiError } from '../../domain/common/error.types';
import { errorMessageKey, isForbiddenError } from './status';

interface ErrorStateProps {
  error?: Pick<ApiError, 'code' | 'requestId' | 'status'> | null;
  onRetry?: () => void;
}

/** Friendly message chosen by ApiError.code; the raw backend message is never shown. */
export const ErrorState: React.FC<ErrorStateProps> = ({ error, onRetry }) => {
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const message = t(errorMessageKey(error, (key) => Boolean(translations[language][key])));
  // 403: retrying cannot help, so show a calmer "no access" state without the retry button.
  const forbidden = isForbiddenError(error);

  return (
    <View accessibilityRole="alert" style={styles.wrap}>
      <TriangleAlert size={32} color={colors.danger} />
      <Text style={[Typography.title, styles.center, { color: colors.text }]}>{forbidden ? t('ui.forbidden.title') : t('ui.error.title')}</Text>
      <Text style={[Typography.body, styles.center, { color: colors.textMuted }]}>{message}</Text>
      {onRetry && !forbidden ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('ui.retry')}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.button,
            { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardSecondary : colors.card },
          ]}
        >
          <Text style={[Typography.label, { color: colors.text }]}>{t('ui.retry')}</Text>
        </Pressable>
      ) : null}
      {error?.requestId ? (
        <Text
          selectable
          style={[Typography.caption, styles.center, { color: colors.textSubtle, fontFamily: Fonts?.mono }]}
        >
          {t('ui.requestId')}: {error.requestId}
        </Text>
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
    borderWidth: 1,
    marginTop: Spacing.two,
  },
});
