import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  /** Spoken name of the box, e.g. "Tìm quy trình". */
  accessibilityLabel: string;
  testID?: string;
}

/** 44 pt search box with a clear button; the focus ring is the accent colour. */
export const SearchField: React.FC<SearchFieldProps> = ({ value, onChangeText, placeholder, accessibilityLabel, testID }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={[styles.box, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}>
      <Search size={18} strokeWidth={1.75} color={colors.textSubtle} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[Typography.body, styles.input, { color: colors.text, outlineColor: colors.primary }]}
      />
      {value !== '' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('ui.clearSearch')} onPress={() => onChangeText('')} style={styles.clear}>
          <X size={18} strokeWidth={1.75} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingLeft: 12,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  input: { flex: 1, minHeight: MinTouch, paddingVertical: 0 },
  clear: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
});
