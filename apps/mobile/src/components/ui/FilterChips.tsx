import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface FilterChipsProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Spoken name of the whole group, e.g. "Lọc theo trạng thái". */
  accessibilityLabel: string;
}

/** Single-choice horizontal chips. Each chip is a 44 pt touch target and announces its selected state. */
export function FilterChips<T extends string>({ options, value, onChange, accessibilityLabel }: FilterChipsProps<T>) {
  const colors = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.row}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.cardSecondary : 'transparent',
                borderColor: selected ? colors.borderStrong : 'transparent',
              },
            ]}
          >
            <Text style={[Typography.label, { color: selected ? colors.text : colors.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  chip: {
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
});
