import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, type DimensionValue, type ViewStyle } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { Radius } from '../../constants/theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** Placeholder block. Pulses, unless the OS asks for reduced motion. */
export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = 16, radius = Radius.sm, style }) => {
  const colors = useThemeColors();
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const useNativeDriver = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 800, useNativeDriver }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.skeleton, opacity }, style]}
    />
  );
};
