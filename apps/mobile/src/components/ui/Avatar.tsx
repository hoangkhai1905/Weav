import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface AvatarProps {
  name: string;
  size?: number;
  /** Signed image URL; falls back to initials when missing or when loading fails. */
  uri?: string | null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 40, uri }) => {
  const colors = useThemeColors();
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel={name}
        source={{ uri }}
        onError={() => setFailed(true)}
        style={[box, { backgroundColor: colors.cardSecondary }]}
      />
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fallback, box, { backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.border }]}
    >
      <Text style={{ color: colors.textMuted, fontSize: size * 0.38, fontWeight: '600' }}>{initialsOf(name)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({ fallback: { alignItems: 'center', justifyContent: 'center' } });
