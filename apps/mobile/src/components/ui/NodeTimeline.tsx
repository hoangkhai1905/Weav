import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Check, Minus, X, type LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useTranslation } from '../../hooks/useTranslation';
import { fill } from '../../features/common/fill';
import { FontFamily, MinTouch, Radius, Spacing, Typography } from '../../constants/theme';
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
  /** Readable one-line error (field label + friendly text), shown without expanding. */
  errorSummary?: string | null;
}

const hasValue = (v: unknown) => v !== null && v !== undefined;

const DOT_ICON: Partial<Record<string, LucideIcon>> = { success: Check, danger: X, neutral: Minus };

const Row: React.FC<{ item: NodeTimelineItem; index: number; last: boolean }> = ({ item, index, last }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const info = statusInfo(item.status);
  const tone = colors.tones[info.tone];
  const Icon = DOT_ICON[info.tone];
  const attempts = item.attempts ?? [];
  const canExpand = attempts.length > 1 || hasValue(item.error) || hasValue(item.output);
  const skipped = item.status === 'SKIPPED' || item.status === 'CANCELLED';
  const note = item.errorSummary
    ? { text: item.errorSummary, color: colors.danger }
    : skipped
      ? { text: t('rd.step.skipped'), color: colors.textSubtle }
      : item.status === 'PENDING' || item.status === 'READY'
        ? { text: t('rd.step.pending'), color: colors.textSubtle }
        : item.attemptCount > 1
          ? { text: fill(t('rd.step.retried'), { n: item.attemptCount }), color: colors.textSubtle }
          : null;

  return (
    <Pressable
      disabled={!canExpand}
      accessibilityRole={canExpand ? 'button' : 'text'}
      accessibilityState={canExpand ? { expanded: open } : undefined}
      accessibilityLabel={`${index + 1}. ${item.label}, ${t(info.labelKey)}${note ? `. ${note.text}` : ''}`}
      onPress={() => setOpen((o) => !o)}
      style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
    >
      <View style={[styles.dot, { backgroundColor: tone.bg }]}>
        {Icon ? <Icon size={14} strokeWidth={2} color={tone.fg} /> : <View style={[styles.pulse, { backgroundColor: tone.fg }]} />}
      </View>
      <View style={styles.body}>
        <Text style={[Typography.body, styles.label, { color: colors.text }]}>
          {index + 1}. {item.label}
        </Text>
        {note ? <Text style={[Typography.caption, { color: note.color }]}>{note.text}</Text> : null}
        {open ? (
          <View style={styles.details}>
            {hasValue(item.output) ? <JsonViewer label={t('rd.step.result')} value={item.output} /> : null}
            {hasValue(item.error) ? <JsonViewer label={t('rd.technical')} value={item.error} /> : null}
            {attempts.length > 1
              ? attempts.map((a) => (
                  <View key={a.id} style={[styles.attempt, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}>
                    <View style={styles.meta}>
                      <Text style={[Typography.label, { color: colors.text }]}>
                        {t('ui.timeline.attempt')} {a.number}
                      </Text>
                      <StatusBadge status={a.status} />
                      <Text style={[Typography.mono, { color: colors.textMuted }]}>{formatDuration(a.durationMs)}</Text>
                    </View>
                    {hasValue(a.error) ? <JsonViewer label={t('rd.technical')} value={a.error} /> : null}
                    {hasValue(a.output) ? <JsonViewer label={t('rd.step.result')} value={a.output} /> : null}
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </View>
      <Text style={[Typography.mono, { color: colors.textMuted }]}>{skipped ? '-' : formatDuration(item.durationMs)}</Text>
    </Pressable>
  );
};

/** Steps of one run as a single card: status dot, name, short plain note, duration; tap a step for its result. */
export const NodeTimeline: React.FC<{ nodes: NodeTimelineItem[] }> = ({ nodes }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return <Text style={[Typography.body, { color: colors.textMuted }]}>{t('ui.timeline.empty')}</Text>;
  }
  return (
    <View accessibilityRole="list" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {nodes.map((n, i) => (
        <Row key={n.id} item={n} index={i} last={i === nodes.length - 1} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 56, paddingVertical: 12, paddingHorizontal: 14 },
  dot: { width: 26, height: 26, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  pulse: { width: 8, height: 8, borderRadius: Radius.pill },
  body: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontFamily: FontFamily.medium },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  details: { gap: Spacing.two, marginTop: 6, minHeight: MinTouch - 12 },
  attempt: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.two, gap: Spacing.two },
});
