import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';

export const AnimatedNodeVisual: React.FC<{ size?: number }> = ({ size = 48 }) => {
  const pulse1 = useSharedValue(0.4);
  const pulse2 = useSharedValue(0.2);
  const pulse3 = useSharedValue(0.6);

  useEffect(() => {
    pulse1.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 1800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    pulse2.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.2, { duration: 2200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    pulse3.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [pulse1, pulse2, pulse3]);

  const styleNode1 = useAnimatedStyle(() => ({
    opacity: pulse1.value,
    transform: [{ scale: 0.8 + pulse1.value * 0.3 }],
  }));

  const styleNode2 = useAnimatedStyle(() => ({
    opacity: pulse2.value,
    transform: [{ scale: 0.8 + pulse2.value * 0.3 }],
  }));

  const styleNode3 = useAnimatedStyle(() => ({
    opacity: pulse3.value,
    transform: [{ scale: 0.8 + pulse3.value * 0.3 }],
  }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Connecting Glowing Lines */}
      <View style={styles.lineHorizontal} />
      <View style={styles.lineVertical} />

      {/* Nodes */}
      <Animated.View style={[styles.node, styles.nodeCenter, styleNode1]} />
      <Animated.View style={[styles.node, styles.nodeTopRight, styleNode2]} />
      <Animated.View style={[styles.node, styles.nodeBottomLeft, styleNode3]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lineHorizontal: {
    position: 'absolute',
    width: '70%',
    height: 1.5,
    backgroundColor: 'rgba(139, 92, 246, 0.4)',
    top: '50%',
  },
  lineVertical: {
    position: 'absolute',
    height: '70%',
    width: 1.5,
    backgroundColor: 'rgba(139, 92, 246, 0.4)',
    left: '50%',
  },
  node: {
    position: 'absolute',
    borderRadius: 999,
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  nodeCenter: {
    width: 12,
    height: 12,
    backgroundColor: '#8b5cf6',
    top: '50%',
    left: '50%',
    marginTop: -6,
    marginLeft: -6,
  },
  nodeTopRight: {
    width: 8,
    height: 8,
    backgroundColor: '#38bdf8',
    top: '20%',
    right: '20%',
  },
  nodeBottomLeft: {
    width: 9,
    height: 9,
    backgroundColor: '#34d399',
    bottom: '20%',
    left: '20%',
  },
});
