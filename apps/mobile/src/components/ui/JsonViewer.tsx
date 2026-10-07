import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Fonts, MinTouch, Radius, Spacing, Typography } from '../../constants/theme';
import { truncateJson } from './status';

interface JsonViewerProps {
  value: unknown;
  label?: string;
  /** Start expanded. Default: collapsed. */
  defaultExpanded?: boolean;
  maxChars?: number;
}

export const JsonViewer: React.FC<JsonViewerProps> = ({ value, label, defaultExpanded = false, maxChars = 600 }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultExpanded);
  const [full, setFull] = useState(false);
  const empty = value === null || value === undefined;
  const { text, truncated } = truncateJson(value, full ? Number.MAX_SAFE_INTEGER : maxChars);
  const Chevron = open ? ChevronDown : ChevronRight;
  const title = label ?? 'JSON';

  return (
    <View style={[styles.box, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${open ? t('ui.json.collapse') : t('ui.json.expand')}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.header}
      >
        <Chevron size={16} color={colors.textMuted} />
        <Text style={[Typography.label, { color: colors.textMuted }]}>{title}</Text>
      </Pressable>
      {open ? (
        <View style={styles.content}>
          <Text selectable style={[Typography.mono, { color: colors.text, fontFamily: Fonts?.mono }]}>
            {empty ? t('ui.json.empty') : text}
          </Text>
          {truncated || full ? (
            <Pressable accessibilityRole="button" onPress={() => setFull((f) => !f)} style={styles.more}>
              <Text style={[Typography.label, { color: colors.primary }]}>
                {full ? t('ui.json.showLess') : t('ui.json.showMore')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: Radius.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.two },
  more: { minHeight: MinTouch, justifyContent: 'center' },
});
