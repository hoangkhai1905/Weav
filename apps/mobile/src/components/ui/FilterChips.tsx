import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FontFamily, MinTouch, Radius, Spacing } from '../../constants/theme';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Shown after the label in the mono font, e.g. how many items the chip would list. */
  count?: number;
}

interface FilterChipsProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Spoken name of the whole group, e.g. "Lọc theo trạng thái". */
  accessibilityLabel: string;
}

/**
 * Single-choice horizontal pills; the chosen one is filled with the ink button colour. The pill is 36 pt
 * tall but the touch area is padded to 44 pt, and each chip announces its selected state.
 */
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
        const label = o.count === undefined ? o.label : `${o.label}, ${o.count}`;
        const fg = selected ? colors.onButton : colors.textMuted;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onChange(o.value)}
            hitSlop={{ top: 4, bottom: 4 }}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.button : colors.card,
                borderColor: selected ? colors.button : colors.borderStrong,
              },
            ]}
          >
            <Text style={[styles.label, { color: fg }]}>{o.label}</Text>
            {o.count === undefined ? null : <Text style={[styles.count, { color: fg }]}>{o.count}</Text>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: MinTouch - 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  label: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  count: { fontFamily: FontFamily.mono, fontSize: 12, opacity: 0.75 },
});
