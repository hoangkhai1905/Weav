import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch, Spacing, Typography } from '../../constants/theme';

interface DisclosureProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testID?: string;
}

/** "Chi tiết kỹ thuật"-style toggle: 44 pt header, content hidden until opened. */
export const Disclosure: React.FC<DisclosureProps> = ({ title, children, defaultOpen = false, testID }) => {
  const colors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen((o) => !o)}
        style={styles.header}
      >
        <Chevron size={16} strokeWidth={1.75} color={colors.textMuted} />
        <Text style={[Typography.body, { color: colors.textMuted }]}>{title}</Text>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: MinTouch },
  body: { gap: Spacing.two, paddingBottom: Spacing.one },
});
