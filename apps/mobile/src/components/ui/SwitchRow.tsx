import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch, Spacing, Typography } from '../../constants/theme';

interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

/** Label + switch on one 44 pt row; the whole row is announced as a switch. */
export const SwitchRow: React.FC<SwitchRowProps> = ({ label, hint, value, onChange, disabled, testID }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[Typography.body, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{hint}</Text> : null}
      </View>
      <Switch
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor="#ffffff"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch },
  text: { flex: 1, gap: Spacing.half },
});
