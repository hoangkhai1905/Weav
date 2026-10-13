import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MinTouch } from '../../constants/theme';

interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Full spoken name, e.g. "Tắt quy trình Gửi hóa đơn". */
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
}

/** On/off switch in the success green (grey when off) inside a 52x44 touch area. */
export const Toggle: React.FC<ToggleProps> = ({ value, onChange, accessibilityLabel, disabled, testID }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.area}>
      <Switch
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ checked: value, disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.borderStrong, true: colors.success }}
        thumbColor="#ffffff"
      />
    </View>
  );
};

const styles = StyleSheet.create({ area: { width: 52, height: MinTouch, alignItems: 'center', justifyContent: 'center' } });
