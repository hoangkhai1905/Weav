import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { Spacing, Typography } from '../../constants/theme';

/** Small uppercase muted heading above a group of rows. */
export const SectionLabel: React.FC<{ title: string; trailing?: React.ReactNode }> = ({ title, trailing }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={[Typography.section, styles.label, { color: colors.textSubtle }]}>
        {title}
      </Text>
      {trailing}
    </View>
  );
};

/** White full-width block with a top hairline; its rows (<ListItem>) draw the line below themselves. */
export const Group: React.FC<{ children: React.ReactNode; padded?: boolean }> = ({ children, padded = false }) => {
  const colors = useThemeColors();
  return (
    <View
      style={[
        styles.group,
        { backgroundColor: colors.card, borderTopColor: colors.border, borderBottomColor: colors.border },
        padded && styles.padded,
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  label: { flex: 1, textTransform: 'uppercase' },
  group: { borderTopWidth: 1 },
  padded: { gap: Spacing.three, padding: Spacing.three, borderBottomWidth: 1 },
});
