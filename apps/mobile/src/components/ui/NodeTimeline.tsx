import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { Fonts, MinTouch, Radius, Spacing, Typography } from '../../constants/theme';
import { StatusBadge } from './StatusBadge';
import { JsonViewer } from './JsonViewer';
import { formatDuration, statusInfo } from './status';

export interface NodeTimelineAttempt {
  id: string;
  number: number;
  status: string;
  durationMs: number | null;
  output?: unknown;
  error?: unknown;
}

export interface NodeTimelineItem {
  id: string;
  label: string;
  status: string;
  durationMs: number | null;
  attemptCount: number;
  attempts?: NodeTimelineAttempt[];
  output?: unknown;
  error?: unknown;
}

const hasValue = (v: unknown) => v !== null && v !== undefined;

const Row: React.FC<{ item: NodeTimelineItem; last: boolean }> = ({ item, last }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tone = colors.tones[statusInfo(item.status).tone];
  const attempts = item.attempts ?? [];
  const canExpand = attempts.length > 0 || hasValue(item.error) || hasValue(item.output);
  const toggleLabel = open ? t('ui.timeline.hideAttempts') : t('ui.timeline.showAttempts');

  return (
    <View style={styles.row} accessibilityRole="none">
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: tone.fg }]} />
        {!last ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
      </View>
      <View style={styles.body}>
        <Text style={[Typography.body, styles.label, { color: colors.text }]}>{item.label}</Text>
        <View style={styles.meta}>
          <StatusBadge status={item.status} />
          <Text style={[Typography.mono, { color: colors.textMuted, fontFamily: Fonts?.mono }]}>
            {formatDuration(item.durationMs)}
          </Text>
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>
            {t('ui.timeline.attempts')}: {item.attemptCount}
          </Text>
        </View>
        {canExpand ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${item.label}: ${toggleLabel}`}
            onPress={() => setOpen((o) => !o)}
            style={styles.toggle}
          >
            <Text style={[Typography.label, { color: colors.primary }]}>{toggleLabel}</Text>
          </Pressable>
        ) : null}
        {open ? (
          <View style={styles.details}>
            {hasValue(item.error) ? <JsonViewer label={t('ui.timeline.error')} value={item.error} defaultExpanded /> : null}
            {hasValue(item.output) ? <JsonViewer label={t('ui.timeline.output')} value={item.output} /> : null}
            {attempts.map((a) => (
              <View key={a.id} style={[styles.attempt, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <View style={styles.meta}>
                  <Text style={[Typography.label, { color: colors.text }]}>
                    {t('ui.timeline.attempt')} {a.number}
                  </Text>
                  <StatusBadge status={a.status} />
                  <Text style={[Typography.mono, { color: colors.textMuted, fontFamily: Fonts?.mono }]}>
                    {formatDuration(a.durationMs)}
                  </Text>
                </View>
                {hasValue(a.error) ? <JsonViewer label={t('ui.timeline.error')} value={a.error} defaultExpanded /> : null}
                {hasValue(a.output) ? <JsonViewer label={t('ui.timeline.output')} value={a.output} /> : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
};

/** Vertical list of workflow nodes for one execution. Expandable per node. */
export const NodeTimeline: React.FC<{ nodes: NodeTimelineItem[] }> = ({ nodes }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return <Text style={[Typography.body, { color: colors.textMuted }]}>{t('ui.timeline.empty')}</Text>;
  }
  return (
    <View accessibilityRole="list">
      {nodes.map((n, i) => (
        <Row key={n.id} item={n} last={i === nodes.length - 1} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  line: { flex: 1, width: 2, marginTop: Spacing.one },
  body: { flex: 1, gap: Spacing.one, paddingBottom: Spacing.three },
  label: { fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  toggle: { minHeight: MinTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  details: { gap: Spacing.two },
  attempt: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.two, gap: Spacing.two },
});
