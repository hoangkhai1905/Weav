import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ size = 'md', showSubtitle = true }) => {
  const colors = useThemeColors();

  let imgSize = 36;
  let titleSize = 16;

  if (size === 'sm') {
    imgSize = 28;
    titleSize = 14;
  } else if (size === 'lg') {
    imgSize = 48;
    titleSize = 22;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.imgWrapper, { borderColor: colors.primaryBorder }]}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={{ width: imgSize, height: imgSize, borderRadius: 10 }}
          resizeMode="cover"
        />
      </View>

      <View style={styles.textGroup}>
        <Text style={[styles.title, { color: colors.text, fontSize: titleSize }]}>WEAV</Text>
        {showSubtitle && (
          <Text style={[styles.subtitle, { color: colors.textSubtle }]}>AI Workflow Studio</Text>
        )}
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
  imgWrapper: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 2,
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  textGroup: {
    justifyContent: 'center',
  },
  title: {
    fontWeight: '900',
    letterSpacing: 1,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
});
