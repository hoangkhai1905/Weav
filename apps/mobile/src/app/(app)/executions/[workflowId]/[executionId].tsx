import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useExecutionDetail } from '../../../../features/executions/hooks/useExecutionDetail';
import { useWorkflowDetail } from '../../../../features/workflows/hooks/useWorkflowDetail';
import { useRunWorkflow } from '../../../../features/workflows/hooks/useRunWorkflow';
import { completeWorkflowRunInCurrentSession } from '../../../../features/workflows/run-workflow.session';
import { useNodeLabel } from '../../../../features/workflows/components/FlowList';
import { orderFlowNodes } from '../../../../features/workflows/workflow-flow';
import { fill } from '../../../../features/common/fill';
import { logEventKey } from '../../../../features/executions/execution-log.copy';
import { durationBetween, formatClock, formatDateTime } from '../../../../features/common/time';
import { Button } from '../../../../components/ui/Button';
import { Group, SectionLabel } from '../../../../components/ui/Section';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../../components/ui/FilterChips';
import { JsonViewer } from '../../../../components/ui/JsonViewer';
import { NodeTimeline, type NodeTimelineItem } from '../../../../components/ui/NodeTimeline';
import { ScreenHeader } from '../../../../components/ui/ScreenHeader';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { formatDuration, shortId } from '../../../../components/ui/status';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { useTranslation } from '../../../../hooks/useTranslation';
import { Fonts, MinTouch, Radius, Spacing, Typography } from '../../../../constants/theme';
import { ACTIVE_EXECUTION_STATUSES, type ExecutionLogItem, type ExecutionLogLevel } from '../../../../domain/execution/execution.types';
import type { ApiError } from '../../../../domain/common/error.types';

type LevelFilter = 'ALL' | ExecutionLogLevel;
const LEVELS: LevelFilter[] = ['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

export default function ExecutionDetailScreen() {
  const { workflowId = '', executionId = '' } = useLocalSearchParams<{ workflowId: string; executionId: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const labelOf = useNodeLabel();
  const [logPage, setLogPage] = useState(0);
  const [level, setLevel] = useState<LevelFilter>('ALL');

  const query = useExecutionDetail(workflowId, executionId, logPage);
  // Node labels live in the workflow definition/editor state, not in the execution.
  const workflowQuery = useWorkflowDetail(workflowId);
  const runMutation = useRunWorkflow();
  const workflow = workflowQuery.data;
  const execution = query.data;

  const nodeInfo = useMemo(() => {
    const byId = new Map((workflow?.nodes ?? []).map((n) => [n.id, n]));
    const order = new Map(
      workflow ? orderFlowNodes(workflow.nodes, workflow.edges).map((n, i) => [n.id, i] as const) : [],
    );
    return { byId, order };
  }, [workflow]);

  const labelForNode = (nodeId: string, nodeType: string) =>
    labelOf({ type: nodeType, name: nodeInfo.byId.get(nodeId)?.name ?? null });

  const timelineItems = useMemo<NodeTimelineItem[]>(() => {
    if (!execution) return [];
    return [...execution.nodes]
      .sort((a, b) => (nodeInfo.order.get(a.nodeId) ?? 1e6) - (nodeInfo.order.get(b.nodeId) ?? 1e6))
      .map((n) => ({
        id: n.nodeExecutionId,
        label: labelForNode(n.nodeId, n.nodeType),
        status: n.status,
        durationMs: n.durationMs ?? durationBetween(n.startedAt, n.finishedAt),
        attemptCount: n.attemptCount,
        output: n.output,
        error: n.error,
        attempts: n.attempts.map((a) => ({
          id: a.attemptId,
          number: a.attemptNumber,
          status: a.status,
          durationMs: durationBetween(a.startedAt, a.finishedAt),
          output: a.output,
          error: a.error,
        })),
      }));
    // labelForNode closes over labelOf/nodeInfo, which change with language and workflow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution, nodeInfo, labelOf]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/(tabs)/executions');
  };

  const handleRerun = async () => {
    const completion = await completeWorkflowRunInCurrentSession(() =>
      runMutation.mutateAsync({ id: workflowId }),
    );
    if (completion.status !== 'success') return;
    const res = completion.result;
    if (res?.executionId) router.push(`/(app)/executions/${res.workflowId}/${res.executionId}`);
  };

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <View style={styles.skeleton}>
        <Skeleton height={120} radius={Radius.md} />
        <Skeleton height={20} width="50%" />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>
    );
  } else if (query.isError && !execution) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else if (execution) {
    const active = ACTIVE_EXECUTION_STATUSES.includes(execution.status);
    const total = durationBetween(execution.startedAt, execution.finishedAt);
    const failedNode = execution.nodes.find((n) => n.status === 'FAILED');
    const logs = execution.logs;
    const pages = Math.max(1, Math.ceil(logs.totalElements / logs.size));
    const shownLogs = logs.items.filter((l) => level === 'ALL' || l.level === level);
    const logNode = (nodeExecutionId: string | null) => {
      const n = execution.nodes.find((x) => x.nodeExecutionId === nodeExecutionId);
      return n ? labelForNode(n.nodeId, n.nodeType) : null;
    };
    const levelChips: ChipOption<LevelFilter>[] = LEVELS.map((value) => ({
      value,
      label: value === 'ALL' ? t('ui.filter.all') : t(`log.level.${value}`),
    }));

    body = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching && !active} onRefresh={() => void query.refetch()} tintColor={colors.primary} />
        }
      >
        <Group padded>
          <View style={styles.headRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('exd.workflow')}: ${workflow?.name ?? shortId(workflowId)}`}
              onPress={() => router.push(`/(app)/workflows/${workflowId}`)}
              style={styles.wfLink}
            >
              <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('exd.workflow')}</Text>
              <Text numberOfLines={2} style={[Typography.title, { color: colors.primary }]}>
                {workflow?.name ?? shortId(workflowId)}
              </Text>
            </Pressable>
            <StatusBadge status={execution.status} size="md" />
          </View>
          <Text selectable style={[Typography.mono, { color: colors.textSubtle, fontFamily: Fonts?.mono }]}>
            {shortId(execution.executionId, 13)}
          </Text>
          <View style={[styles.grid, { borderTopColor: colors.border }]}>
            <Info label={t('exd.trigger')} value={t(`execution.trigger.${execution.triggerType}`)} />
            <Info label={t('exd.duration')} value={total === null && active ? t('execution.running_duration') : formatDuration(total)} mono />
            <Info label={t('exd.created')} value={formatDateTime(execution.createdAt)} mono />
            <Info label={t('exd.started')} value={execution.startedAt ? formatClock(execution.startedAt) : t('execution.not_started')} mono />
            <Info label={t('exd.finished')} value={execution.finishedAt ? formatClock(execution.finishedAt) : '-'} mono />
          </View>
          {active ? (
            <View style={styles.live}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('exd.live')}</Text>
            </View>
          ) : null}
        </Group>

        {execution.status === 'FAILED' ? (
          <View accessibilityRole="alert" style={[styles.failed, { backgroundColor: colors.dangerBg }]}>
            <View style={styles.headRow}>
              <TriangleAlert size={18} color={colors.danger} />
              <Text style={[Typography.label, { color: colors.danger }]}>{t('exd.failed.title')}</Text>
            </View>
            <Text style={[Typography.body, { color: colors.text }]}>
              {failedNode
                ? fill(t('exd.failed.node'), { name: labelForNode(failedNode.nodeId, failedNode.nodeType) })
                : t('execution.failed_generic')}
            </Text>
          </View>
        ) : null}

        {workflow?.status === 'PUBLISHED' ? (
          <View style={styles.rerun}>
            <Button
              label={t('exd.rerun')}
              accessibilityHint={t('exd.rerun.hint')}
              busy={runMutation.isPending}
              icon={runMutation.isPending ? undefined : <RefreshCw size={16} color={colors.onPrimary} />}
              onPress={() => void handleRerun()}
            />
            <Text style={[Typography.caption, { color: colors.textSubtle }]}>{t('exd.rerun.hint')}</Text>
          </View>
        ) : null}

        <SectionLabel title={t('exd.steps')} />
        <Group padded>
          <NodeTimeline nodes={timelineItems} />
        </Group>

        <SectionLabel title={t('exd.logs')} />
        <View style={styles.chipsBleed}>
          <FilterChips<LevelFilter> options={levelChips} value={level} onChange={setLevel} accessibilityLabel={t('exd.logs.filter')} />
        </View>
        {logs.items.length === 0 ? (
          <Text style={[Typography.body, styles.pad, { color: colors.textMuted }]}>{t('exd.logs.empty')}</Text>
        ) : shownLogs.length === 0 ? (
          <Text style={[Typography.body, styles.pad, { color: colors.textMuted }]}>{t('exd.logs.noMatch')}</Text>
        ) : (
          <Group>
            {shownLogs.map((l) => (
              <LogRow key={l.id} log={l} step={logNode(l.nodeExecutionId)} />
            ))}
          </Group>
        )}
        <View style={styles.pad}>
          {pages > 1 ? (
            <View style={styles.pager}>
              <PagerButton label={t('exd.logs.prev')} disabled={logPage === 0} onPress={() => setLogPage((p) => Math.max(0, p - 1))} />
              <Text style={[Typography.label, { color: colors.textMuted }]}>
                {fill(t('exd.logs.page'), { page: logPage + 1, total: pages })}
              </Text>
              <PagerButton label={t('exd.logs.next')} disabled={!logs.hasNext} onPress={() => setLogPage((p) => p + 1)} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('exd.title')} onBack={handleBack} />
      {body}
    </SafeAreaView>
  );
}

/** One log line: a friendly sentence; the raw message and codes only inside "Technical details". */
const LogRow: React.FC<{ log: ExecutionLogItem; step: string | null }> = ({ log: l, step }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tone = colors.tones[l.level === 'ERROR' ? 'danger' : l.level === 'WARN' ? 'warning' : l.level === 'INFO' ? 'info' : 'neutral'];
  const hasMetadata = Object.keys(l.metadata).length > 0;
  return (
    <View style={[styles.log, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={styles.logHead}>
        <View style={[styles.level, { backgroundColor: tone.bg }]}>
          <Text style={[Typography.caption, { color: tone.fg, fontWeight: '500' }]}>{t(`log.level.${l.level}`)}</Text>
        </View>
        <Text style={[Typography.mono, { color: colors.textMuted, fontFamily: Fonts?.mono }]}>{formatClock(l.createdAt)}</Text>
      </View>
      {step ? (
        <Text style={[Typography.caption, { color: colors.textMuted }]}>
          {t('exd.logs.step')}: {step}
        </Text>
      ) : null}
      <Text style={[Typography.body, { color: colors.text }]}>{t(logEventKey(l.eventType))}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.techToggle}
      >
        <Text style={[Typography.label, { color: colors.primary }]}>{t('exd.logs.technical')}</Text>
      </Pressable>
      {open ? (
        <View style={styles.tech}>
          <Text selectable style={[Typography.mono, { color: colors.textMuted, fontFamily: Fonts?.mono }]}>{l.eventType}</Text>
          {l.message ? (
            <Text selectable style={[Typography.mono, { color: colors.textMuted, fontFamily: Fonts?.mono }]}>{l.message}</Text>
          ) : null}
          {hasMetadata ? <JsonViewer value={l.metadata} label="metadata" /> : null}
        </View>
      ) : null}
    </View>
  );
};

const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.info}>
      <Text style={[Typography.caption, { color: colors.textSubtle }]}>{label}</Text>
      <Text style={[Typography.body, { color: colors.text, fontFamily: mono ? Fonts?.mono : undefined }]}>{value}</Text>
    </View>
  );
};

const PagerButton: React.FC<{ label: string; disabled: boolean; onPress: () => void }> = ({ label, disabled, onPress }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pagerBtn, { borderColor: colors.borderStrong, backgroundColor: colors.card, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[Typography.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: Spacing.six },
  skeleton: { gap: Spacing.three, padding: Spacing.three },
  pad: { padding: Spacing.three },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  wfLink: { flex: 1, minHeight: MinTouch, justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, paddingTop: Spacing.three, borderTopWidth: 1 },
  info: { width: '47%', gap: Spacing.half },
  live: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  failed: { gap: Spacing.one, margin: Spacing.three, padding: Spacing.three, borderRadius: Radius.sm },
  rerun: { gap: Spacing.one, padding: Spacing.three },
  chipsBleed: { paddingBottom: Spacing.two },
  log: { gap: Spacing.one, paddingVertical: 14, paddingHorizontal: Spacing.three, borderBottomWidth: 1 },
  techToggle: { minHeight: MinTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  tech: { gap: Spacing.one },
  logHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  level: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  pagerBtn: { minHeight: MinTouch, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Radius.md, borderWidth: 1 },
});
