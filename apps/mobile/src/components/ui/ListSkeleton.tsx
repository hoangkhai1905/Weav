import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Radius, Spacing } from '../../constants/theme';
import { Skeleton } from './Skeleton';

/** Placeholder rows shaped like ListItem, shown while a list loads (never a bare spinner). */
export const ListSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View accessible accessibilityLabel={t('ui.loading')} accessibilityRole="progressbar" style={styles.wrap}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.main}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="85%" height={12} />
            <Skeleton width="30%" height={12} />
          </View>
          <Skeleton width={72} height={22} radius={Radius.sm} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
  },
  main: { flex: 1, gap: Spacing.two },
});
