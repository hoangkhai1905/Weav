import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch, Radius, Spacing, Typography } from '../../constants/theme';

interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Small trailing metadata line, e.g. "5 min ago". */
  meta?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
}

export const ListItem: React.FC<ListItemProps> = ({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  accessibilityHint,
}) => {
  const colors = useThemeColors();
  const body = (
    <>
      {leading}
      <View style={styles.main}>
        <Text style={[Typography.body, styles.title, { color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[Typography.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text style={[Typography.caption, { color: colors.textSubtle }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );
  const container = [styles.row, { backgroundColor: colors.card, borderColor: colors.border }];

  if (!onPress) return <View style={container}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, meta].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [...container, pressed && { backgroundColor: colors.cardSecondary }]}
    >
      {body}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouch,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  main: { flex: 1, gap: Spacing.half },
  title: { fontWeight: '600' },
});
