import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lightbulb } from 'lucide-react-native';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import type { WorkflowStatus, WorkflowTrigger } from '../../../domain/workflow/workflow.types';
import { fill } from '../../common/fill';
import { formatDateTime, formatRelativeTime } from '../../common/time';

interface TriggerListProps {
  triggers: WorkflowTrigger[];
  workflowStatus: WorkflowStatus;
}

/** Triggers of a workflow with plain-language reasons (and a fix hint) for every backend reason code. */
export const TriggerList: React.FC<TriggerListProps> = ({ triggers, workflowStatus }) => {
  const colors = useThemeColors();
  const { t, language } = useTranslation();

  if (triggers.length === 0) {
    return (
      <Text style={[Typography.body, { color: colors.textMuted }]}>
        {workflowStatus === 'DRAFT' ? t('wfd.triggers.draftEmpty') : t('wfd.triggers.empty')}
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {triggers.map((trigger, index) => {
        const warn = colors.tones.warning;
        return (
          <View
            key={trigger.triggerId}
            style={[styles.card, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: Spacing.three }]}
          >
            <View style={styles.head}>
              <Text style={[Typography.body, styles.type, { color: colors.text }]}>
                {t(`trigger.type.${trigger.type}`)}
              </Text>
              <StatusBadge status={trigger.status} />
            </View>
            {trigger.nextRunAt ? (
              <Text style={[Typography.caption, { color: colors.textMuted }]}>
                {fill(t('trigger.next'), {
                  time: `${formatRelativeTime(trigger.nextRunAt, language)} (${formatDateTime(trigger.nextRunAt)})`,
                })}
              </Text>
            ) : null}
            <Text style={[Typography.caption, { color: colors.textMuted }]}>
              {trigger.lastTriggeredAt
                ? fill(t('trigger.last'), { time: formatRelativeTime(trigger.lastTriggeredAt, language) })
                : t('trigger.never')}
            </Text>
            {trigger.reasonCode ? (
              <View
                accessibilityRole="alert"
                style={[styles.reason, { backgroundColor: warn.bg }]}
              >
                <Text style={[Typography.label, { color: warn.fg }]}>{t(`trigger.reason.${trigger.reasonCode}`)}</Text>
                <View style={styles.fix}>
                  <Lightbulb size={14} color={warn.fg} />
                  <Text style={[Typography.caption, styles.fixText, { color: colors.text }]}>
                    {t('trigger.fix')}: {t(`trigger.fix.${trigger.reasonCode}`)}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  card: { gap: Spacing.one },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  type: { flex: 1, fontWeight: '500' },
  reason: { gap: Spacing.one, marginTop: Spacing.two, padding: Spacing.two, borderRadius: Radius.sm },
  fix: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  fixText: { flex: 1 },
});
