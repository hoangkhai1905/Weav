import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { MinTouch, Spacing, Typography } from '../../constants/theme';

interface ScreenHeaderProps {
  title: string;
  /** Shown on the left as a back arrow when set. */
  onBack?: () => void;
  trailing?: React.ReactNode;
  subtitle?: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, onBack, trailing, subtitle }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={[styles.bar, { borderBottomColor: colors.border }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('ui.back')} onPress={onBack} style={styles.back}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.titleBox}>
        <Text accessibilityRole="header" numberOfLines={1} style={[Typography.headline, { color: colors.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[Typography.caption, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: MinTouch + Spacing.two,
    borderBottomWidth: 1,
  },
  back: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center', marginLeft: -Spacing.two },
  titleBox: { flex: 1 },
});
