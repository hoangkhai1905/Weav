import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { Fonts, Radius, Spacing, Typography } from '../../../constants/theme';
import { parseMessage } from '../assistant.chat';

/** Assistant/user text with minimal formatting (bold, inline code, bullet lines); no markdown library. */
export const MessageText: React.FC<{ content: string; color: string }> = ({ content, color }) => {
  const colors = useThemeColors();
  const lines = parseMessage(content);
  return (
    <View style={styles.wrap}>
      {lines.map((line, i) => (
        <View key={i} style={styles.line}>
          {line.marker ? <Text style={[Typography.body, styles.marker, { color }]}>{line.marker}</Text> : null}
          <Text style={[Typography.body, styles.text, { color }]} selectable>
            {line.segments.map((seg, j) => (
              <Text
                key={j}
                style={[
                  seg.bold ? styles.bold : null,
                  seg.code ? [styles.code, { backgroundColor: colors.cardSecondary, color: colors.text }] : null,
                ]}
              >
                {seg.text}
              </Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  line: { flexDirection: 'row', gap: Spacing.one },
  marker: { minWidth: 18 },
  text: { flex: 1 },
  bold: { fontWeight: '700' },
  code: { fontFamily: Fonts?.mono, fontSize: 13, borderRadius: Radius.sm },
});
