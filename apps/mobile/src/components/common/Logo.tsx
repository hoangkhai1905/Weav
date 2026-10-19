import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FontFamily } from '../../constants/theme';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

/** Wordmark: the app-icon mark (docs/brand/weav-app-icon.svg, same as the launcher icon), then the name. */
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
      <Svg width={box} height={box} viewBox="0 0 256 256" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Rect width="256" height="256" rx="57.6" fill="#2b5fd9" />
        <G transform="translate(36 36) scale(0.71875)" fill="#fff">
          <Path d="M33.99 82.37L33.99 212A27 27 0 0 0 87.99 212L87.99 113.55Z" />
          <Path d="M105.99 215.2L218.25 150.38A27 27 0 0 0 191.25 103.62L105.99 152.84Z" />
          <Path d="M185.01 86.43L72.75 21.62A27 27 0 0 0 45.75 68.38L131.01 117.61Z" />
        </G>
      </Svg>

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
  textGroup: {
    justifyContent: 'center',
  },
  title: {
    fontFamily: FontFamily.bold,
    letterSpacing: 1.5,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
    marginTop: 2,
  },
});
