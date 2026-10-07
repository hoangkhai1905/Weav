import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '../../../components/ui/Sheet';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Fonts, MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import { parseRunInput } from '../workflow.input';

interface RunSheetProps {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  /** Called with a valid input object (`{}` when the field is empty). */
  onSubmit: (input: Record<string, unknown>) => void;
  onClose: () => void;
}

/** "Run now": optional JSON input, validated before anything is sent. */
export const RunSheet: React.FC<RunSheetProps> = ({ visible, value, onChange, busy, onSubmit, onClose }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const parsed = parseRunInput(value);
  // Show the problem only once the user typed something.
  const error = !parsed.ok && value.trim() !== '' ? t(`run.input.${(parsed as { reason: string }).reason}`) : null;
  const canSubmit = parsed.ok && !busy;

  return (
    <Sheet visible={visible} onClose={onClose} title={t('run.title')}>
      <Text style={[Typography.body, { color: colors.textMuted }]}>{t('run.intro')}</Text>
      <View style={styles.field}>
        <Text style={[Typography.label, { color: colors.text }]}>{t('run.input.label')}</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={'{"ten": "Lan"}'}
          placeholderTextColor={colors.textSubtle}
          accessibilityLabel={t('run.input.label')}
          accessibilityHint={t('run.input.help')}
          style={[
            Typography.mono,
            styles.input,
            {
              color: colors.text,
              fontFamily: Fonts?.mono,
              backgroundColor: colors.cardSecondary,
              borderColor: error ? colors.danger : colors.borderStrong,
            },
          ]}
        />
        {error ? (
          <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>
            {error}
          </Text>
        ) : (
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>{t('run.input.help')}</Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('run.submit')}
        accessibilityState={{ disabled: !canSubmit, busy }}
        disabled={!canSubmit}
        onPress={() => parsed.ok && onSubmit(parsed.value)}
        style={[styles.submit, { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={[Typography.label, { color: colors.onPrimary }]}>{t('run.submit')}</Text>
        )}
      </Pressable>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  input: {
    minHeight: 120,
    padding: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.sm,
    textAlignVertical: 'top',
  },
  submit: {
    minHeight: MinTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
});
