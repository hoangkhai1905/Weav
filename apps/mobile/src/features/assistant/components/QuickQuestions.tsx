import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';

const CHIPS = ['asst.chip.1', 'asst.chip.2', 'asst.chip.3', 'asst.chip.4'] as const;

/** Ready-made questions; tapping one asks it right away. */
export const QuickQuestions: React.FC<{ onPick: (question: string) => void }> = ({ onPick }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <Text style={[Typography.label, { color: colors.textMuted }]}>{t('asst.chips.title')}</Text>
      {CHIPS.map((key) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={t(key)}
          onPress={() => onPick(t(key))}
          style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}
        >
          <Text style={[Typography.body, { color: colors.text }]}>{t(key)}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: Spacing.two },
  chip: {
    minHeight: MinTouch,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.pill,
  },
});
