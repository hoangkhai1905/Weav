import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FontFamily, Radius } from '../../constants/theme';
import type { StepKind } from '../../constants/palette';

interface StepTileProps {
  kind: StepKind;
  /** An icon (it gets the tile's text colour through `color`) or a short plain label. */
  children: (color: string) => React.ReactNode;
  size?: number;
}

/** Small rounded square tinted by step type (trigger / action / condition / AI). Decorative: the row carries the label. */
export const StepTile: React.FC<StepTileProps> = ({ kind, children, size = 36 }) => {
  const { steps } = useThemeColors();
  const c = steps[kind];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, backgroundColor: c.bg }]}
    >
      {children(c.fg)}
    </View>
  );
};

/** A tile that holds a two-letter label instead of an icon. */
export const StepTileText: React.FC<{ kind: StepKind; label: string; size?: number }> = ({ kind, label, size }) => (
  <StepTile kind={kind} size={size}>
    {(color) => <Text style={[styles.text, { color, fontSize: (size ?? 36) < 30 ? 11 : 12 }]}>{label}</Text>}
  </StepTile>
);

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  text: { fontFamily: FontFamily.semibold },
});
