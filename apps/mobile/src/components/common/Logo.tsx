import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

/** Plain wordmark: a small accent square with a W, then the name. No gradients or glow. */
export const Logo: React.FC<LogoProps> = ({ size = 'md', showSubtitle = true }) => {
  const colors = useThemeColors();

  let box = 32;
  let titleSize = 16;

  if (size === 'sm') {
    box = 26;
    titleSize = 14;
  } else if (size === 'lg') {
    box = 44;
    titleSize = 22;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.mark, { width: box, height: box, backgroundColor: colors.primary }]}>
        <Text style={[styles.markText, { color: colors.onPrimary, fontSize: box * 0.5 }]}>W</Text>
      </View>

      <View style={styles.textGroup}>
        <Text style={[styles.title, { color: colors.text, fontSize: titleSize }]}>WEAV</Text>
        {showSubtitle && <Text style={[styles.subtitle, { color: colors.textSubtle }]}>AI Workflow Studio</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontWeight: '700',
  },
  textGroup: {
    justifyContent: 'center',
  },
  title: {
    fontWeight: '700',
    letterSpacing: 1.5,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
});
