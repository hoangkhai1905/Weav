import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fill } from '../../common/fill';
import { formatRelativeTime } from '../../common/time';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Toggle } from '../../../components/ui/Toggle';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, Radius, Typography } from '../../../constants/theme';
import type { WorkflowSummary } from '../../../domain/workflow/workflow.types';

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  /** What the switch shows right now (already includes a change that is still being saved). */
  on: boolean;
  /** Turning on/off needs the "manage workflow state" permission; drafts have no switch at all. */
  canToggle: boolean;
  onToggle: (next: boolean) => void;
  onOpen: () => void;
}

/** One workflow in the team list: tap to open, switch to turn it on or off (drafts: no switch). */
export const WorkflowCard: React.FC<WorkflowCardProps> = ({ workflow, on, canToggle, onToggle, onOpen }) => {
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const hasSwitch = workflow.status !== 'DRAFT';
  const description = workflow.description?.trim();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        testID={`workflow-card-${workflow.workflowId}`}
        accessibilityRole="button"
        accessibilityLabel={[workflow.name, t(`status.${workflow.status}`)].join(', ')}
        accessibilityHint={t('wfl.item.hint')}
        onPress={onOpen}
        style={styles.main}
      >
        <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>
          {workflow.name}
        </Text>
        {description ? (
          <Text numberOfLines={1} style={[Typography.caption, { color: colors.textMuted }]}>
            {description}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <StatusBadge status={workflow.status} />
          <Text style={[Typography.mono, { color: colors.textSubtle }]}>
            {fill(t('wfl.updated'), { time: formatRelativeTime(workflow.updatedAt, language) })}
          </Text>
        </View>
      </Pressable>
      {hasSwitch ? (
        <Toggle
          testID={`workflow-toggle-${workflow.workflowId}`}
          value={on}
          disabled={!canToggle}
          accessibilityLabel={fill(t(on ? 'wfl.switch.off' : 'wfl.switch.on'), { name: workflow.name })}
          onChange={onToggle}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  main: { flex: 1, minWidth: 0, gap: 6 },
  name: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
