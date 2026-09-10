import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface SparklineProps {
  data?: number[];
  height?: number;
}

export const ActivitySparkline: React.FC<SparklineProps> = ({
  data = [14, 22, 18, 35, 28, 42, 38],
  height = 36,
}) => {
  const colors = useThemeColors();
  const max = Math.max(...data, 1);

  return (
    <View style={[styles.container, { height }]}>
      {data.map((value, idx) => {
        const barHeightPercent = Math.max(15, (value / max) * 100);
        const isLatest = idx === data.length - 1;

        return (
          <View key={idx} style={styles.barCol}>
            <View
              style={[
                styles.bar,
                {
                  height: `${barHeightPercent}%`,
                  backgroundColor: isLatest ? colors.primary : colors.cardSecondary,
                  borderColor: isLatest ? colors.primaryBorder : colors.border,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    paddingTop: 8,
  },
  barCol: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: 3,
  },
  bar: {
    width: '100%',
    borderRadius: 4,
    borderWidth: 1,
  },
});
