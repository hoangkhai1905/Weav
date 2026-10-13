import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, Square, TriangleAlert } from 'lucide-react-native';
import { format } from 'date-fns';
import { useCancelExecution, useExecutionDetail } from '../../../../features/executions/hooks/useExecutionDetail';
import { friendlyErrorMessage } from '../../../../features/common/friendly-error';
import { useUIStore } from '../../../../stores/ui.store';
import { ConfirmSheet } from '../../../../components/ui/ConfirmSheet';
import { useWorkflowDetail } from '../../../../features/workflows/hooks/useWorkflowDetail';
import { useRunWorkflow } from '../../../../features/workflows/hooks/useRunWorkflow';
import { completeWorkflowRunInCurrentSession } from '../../../../features/workflows/run-workflow.session';
import { useNodeLabel } from '../../../../features/workflows/components/FlowList';
import { orderFlowNodes } from '../../../../features/workflows/workflow-flow';
import { fill } from '../../../../features/common/fill';
import { logEventKey } from '../../../../features/executions/execution-log.copy';
import { failureAction, nodeErrorParts, nodeErrorSummary } from '../../../../features/executions/node-error';
import { groupByDay } from '../../../../features/notifications/notification.grouping';
import { durationBetween, formatClock, formatDateTime } from '../../../../features/common/time';
import { Button } from '../../../../components/ui/Button';
import { Disclosure } from '../../../../components/ui/Disclosure';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../../components/ui/FilterChips';
import { HeaderActions } from '../../../../components/ui/HeaderActions';
import { JsonViewer } from '../../../../components/ui/JsonViewer';
import { NodeTimeline, type NodeTimelineItem } from '../../../../components/ui/NodeTimeline';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { formatDuration, shortId } from '../../../../components/ui/status';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { useTranslation } from '../../../../hooks/useTranslation';
import { Fonts, FontFamily, MinTouch, Radius, Spacing, Typography } from '../../../../constants/theme';
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
  const cancelMutation = useCancelExecution(workflowId, executionId);
  const showToast = useUIStore((s) => s.showToast);
  const [confirmStop, setConfirmStop] = useState(false);
  // The API does not report a pending stop, so "Stopping..." lives here until the poll sees the end.
  const [stopRequested, setStopRequested] = useState(false);
  const [stopDenied, setStopDenied] = useState(false);
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

  const orderedNodes = useMemo(
    () =>
      execution
        ? [...execution.nodes].sort((a, b) => (nodeInfo.order.get(a.nodeId) ?? 1e6) - (nodeInfo.order.get(b.nodeId) ?? 1e6))
        : [],
    [execution, nodeInfo],
  );

  const timelineItems = useMemo<NodeTimelineItem[]>(
    () =>
      orderedNodes.map((n) => ({
        id: n.nodeExecutionId,
        label: labelForNode(n.nodeId, n.nodeType),
        status: n.status,
        durationMs: n.durationMs ?? durationBetween(n.startedAt, n.finishedAt),
        attemptCount: n.attemptCount,
        output: n.output,
        error: n.error,
        errorSummary: nodeErrorSummary(n.error, t),
        attempts: n.attempts.map((a) => ({
          id: a.attemptId,
          number: a.attemptNumber,
          status: a.status,
          durationMs: durationBetween(a.startedAt, a.finishedAt),
          output: a.output,
          error: a.error,
        })),
      })),
    // labelForNode closes over labelOf/nodeInfo, which change with language and workflow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedNodes, nodeInfo, labelOf, t],
  );

  const handleStop = async () => {
    try {
      const result = await cancelMutation.mutateAsync();
      if (result === 'CANCEL_REQUESTED') setStopRequested(true);
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 403) setStopDenied(true);
      const message =
        status === 409 ? t('exd.stop.finished') : status === 404 ? t('ui.error.NOT_FOUND') : friendlyErrorMessage(error);
      showToast({ type: 'error', title: t('exd.stop.failTitle'), message });
    } finally {
      setConfirmStop(false);
    }
  };

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

  const header = (
    <View style={styles.header}>
      <Pressable
        testID="run-detail-back"
        accessibilityRole="button"
        accessibilityLabel={t('rd.back')}
        onPress={handleBack}
        style={styles.iconButton}
      >
        <ArrowLeft size={20} strokeWidth={1.75} color={colors.text} />
      </Pressable>
      <Text numberOfLines={1} accessibilityRole="header" style={[Typography.mono, styles.headerTitle, { color: colors.textSubtle }]}>
        {fill(t('rd.title'), { id: shortId(executionId, 8) })}
      </Text>
      <HeaderActions />
    </View>
  );

  let body: React.ReactNode;
  let bar: React.ReactNode = null;
  if (query.isPending) {
    body = (
      <View style={styles.skeleton}>
        <Skeleton height={22} width="30%" />
        <Skeleton height={28} width="80%" />
        <Skeleton height={96} radius={Radius.lg} />
        <Skeleton height={64} radius={Radius.lg} />
        <Skeleton height={64} radius={Radius.lg} />
      </View>
    );
  } else if (query.isError && !execution) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else if (execution) {
    const active = ACTIVE_EXECUTION_STATUSES.includes(execution.status);
    const total = durationBetween(execution.startedAt, execution.finishedAt);
    const failedNode = orderedNodes.find((n) => n.status === 'FAILED');
    const failedIndex = failedNode ? orderedNodes.indexOf(failedNode) : -1;
    const failedSummary = failedNode ? nodeErrorSummary(failedNode.error, t) : null;
    const failedParts = nodeErrorParts(failedNode?.error);
    const action = failedNode ? failureAction(failedNode.error) : null;
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
    const bucket = groupByDay([execution.createdAt], (iso) => iso)[0];
    const dayLabel = !bucket
      ? ''
      : bucket.bucket === 'today'
        ? t('ntf.today')
        : bucket.bucket === 'yesterday'
          ? t('ntf.yesterday')
          : format(bucket.date, 'dd/MM/yyyy');

    body = (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching && !active} onRefresh={() => void query.refetch()} tintColor={colors.primary} />
        }
      >
        <View style={styles.titleBox}>
          <StatusBadge status={execution.status} size="md" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('exd.workflow')}: ${workflow?.name ?? shortId(workflowId)}`}
            onPress={() => router.push(`/(app)/workflows/${workflowId}`)}
          >
            <Text style={[styles.name, { color: colors.text }]}>{workflow?.name ?? shortId(workflowId)}</Text>
          </Pressable>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>
            {dayLabel}{' '}
            <Text style={[Typography.mono, { color: colors.text }]}>{formatClock(execution.createdAt)}</Text>
            {' · '}
            {total === null && active ? t('execution.running_duration') : t('rd.ran')}{' '}
            {total === null && active ? null : <Text style={[Typography.mono, { color: colors.text }]}>{formatDuration(total)}</Text>}
          </Text>
          {active ? (
            <View style={styles.live}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('exd.live')}</Text>
            </View>
          ) : null}
        </View>

        {execution.status === 'FAILED' ? (
          <View
            testID="run-failure"
            accessibilityRole="alert"
            accessibilityLabel={t('rd.fail.label')}
            style={[styles.failure, { backgroundColor: colors.dangerBg }]}
          >
            <View style={styles.failureHead}>
              <TriangleAlert size={18} strokeWidth={1.75} color={colors.danger} />
              <Text style={[styles.failureTitle, { color: colors.text }]}>
                {failedNode
                  ? fill(t('rd.fail.title'), { n: failedIndex + 1, name: labelForNode(failedNode.nodeId, failedNode.nodeType) })
                  : t('execution.failed_generic')}
              </Text>
            </View>
            <Text style={[Typography.body, { color: colors.textMuted }]}>{failedSummary ?? t('rd.fail.generic')}</Text>
            <Text style={[Typography.body, { color: colors.textMuted }]}>{t('rd.fail.fix')}</Text>
            {action ? (
              <View style={styles.failureAction}>
                <Button
                  variant="secondary"
                  label={t(action === 'connections' ? 'rd.fail.connections' : 'rd.fail.workflow')}
                  onPress={() => router.push(action === 'connections' ? '/(app)/connections' : `/(app)/workflows/${workflowId}`)}
                />
              </View>
            ) : null}
            {failedNode && (failedParts.code || failedParts.message) ? (
              <Disclosure title={t('rd.technical')} testID="run-failure-technical">
                <View style={[styles.techBox, { backgroundColor: colors.card }]}>
                  {failedParts.code ? (
                    <Text selectable style={[Typography.mono, { color: colors.textMuted }]}>
                      {t('rd.technical.code')}: {failedParts.code}
                    </Text>
                  ) : null}
                  {failedParts.message ? (
                    <Text selectable style={[Typography.mono, { color: colors.textMuted }]}>
                      {t('rd.technical.message')}: {failedParts.message}
                    </Text>
                  ) : null}
                </View>
                <JsonViewer label={t('ui.timeline.error')} value={failedNode.error} />
              </Disclosure>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
            {t('rd.steps')}
          </Text>
          <NodeTimeline nodes={timelineItems} />
        </View>

        <View style={[styles.technical, { borderTopColor: colors.border }]}>
          <Disclosure title={t('rd.technical')} testID="run-technical">
            <Info label={t('rd.technical.runId')} value={execution.executionId} mono />
            <Info label={t('exd.trigger')} value={t(`execution.trigger.${execution.triggerType}`)} />
            <Info label={t('exd.created')} value={formatDateTime(execution.createdAt)} mono />
            <Info label={t('exd.started')} value={execution.startedAt ? formatClock(execution.startedAt) : t('execution.not_started')} mono />
            <Info label={t('exd.finished')} value={execution.finishedAt ? formatClock(execution.finishedAt) : '-'} mono />

            <Text accessibilityRole="header" style={[styles.sectionTitle, styles.logsTitle, { color: colors.text }]}>
              {t('exd.logs')}
            </Text>
            <View style={styles.chipsBleed}>
              <FilterChips<LevelFilter> options={levelChips} value={level} onChange={setLevel} accessibilityLabel={t('exd.logs.filter')} />
            </View>
            {logs.items.length === 0 ? (
              <Text style={[Typography.body, { color: colors.textMuted }]}>{t('exd.logs.empty')}</Text>
            ) : shownLogs.length === 0 ? (
              <Text style={[Typography.body, { color: colors.textMuted }]}>{t('exd.logs.noMatch')}</Text>
            ) : (
              <View style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {shownLogs.map((l, i) => (
                  <LogRow key={l.id} log={l} step={logNode(l.nodeExecutionId)} last={i === shownLogs.length - 1} />
                ))}
              </View>
            )}
            {pages > 1 ? (
              <View style={styles.pager}>
                <PagerButton label={t('exd.logs.prev')} disabled={logPage === 0} onPress={() => setLogPage((p) => Math.max(0, p - 1))} />
                <Text style={[Typography.label, { color: colors.textMuted }]}>
                  {fill(t('exd.logs.page'), { page: logPage + 1, total: pages })}
                </Text>
                <PagerButton label={t('exd.logs.next')} disabled={!logs.hasNext} onPress={() => setLogPage((p) => p + 1)} />
              </View>
            ) : null}
          </Disclosure>
        </View>
      </ScrollView>
    );

    if (active && !stopDenied) {
      bar = (
        <Button
          variant="danger"
          label={stopRequested ? t('exd.stop.pending') : t('exd.stop')}
          disabled={stopRequested}
          busy={cancelMutation.isPending}
          icon={cancelMutation.isPending || stopRequested ? undefined : <Square size={16} color={colors.danger} />}
          onPress={() => setConfirmStop(true)}
        />
      );
    } else if (workflow?.status === 'PUBLISHED') {
      bar = (
        <Button
          testID="run-rerun"
          label={t('rd.rerun')}
          accessibilityHint={t('rd.rerun.hint')}
          busy={runMutation.isPending}
          icon={runMutation.isPending ? undefined : <RefreshCw size={16} strokeWidth={1.75} color={colors.onButton} />}
          onPress={() => void handleRerun()}
        />
      );
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      {header}
      {body}
      {bar ? <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>{bar}</View> : null}
      <ConfirmSheet
        visible={confirmStop}
        title={t('exd.stop.confirmTitle')}
        message={t('exd.stop.confirmBody')}
        confirmLabel={t('exd.stop')}
        destructive
        busy={cancelMutation.isPending}
        onConfirm={() => void handleStop()}
        onClose={() => setConfirmStop(false)}
      />
    </SafeAreaView>
  );
}

/** One log line: a friendly sentence; the raw message and codes only inside "Technical details". */
const LogRow: React.FC<{ log: ExecutionLogItem; step: string | null; last: boolean }> = ({ log: l, step, last }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tone = colors.tones[l.level === 'ERROR' ? 'danger' : l.level === 'WARN' ? 'warning' : l.level === 'INFO' ? 'info' : 'neutral'];
  const hasMetadata = Object.keys(l.metadata).length > 0;
  return (
    <View style={[styles.log, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={styles.logHead}>
        <View style={[styles.level, { backgroundColor: tone.bg }]}>
          <Text style={[Typography.caption, { color: tone.fg, fontFamily: FontFamily.medium }]}>{t(`log.level.${l.level}`)}</Text>
        </View>
        <Text style={[Typography.mono, { color: colors.textMuted }]}>{formatClock(l.createdAt)}</Text>
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
          <Text selectable style={[Typography.mono, { color: colors.textMuted }]}>{l.eventType}</Text>
          {l.message ? <Text selectable style={[Typography.mono, { color: colors.textMuted }]}>{l.message}</Text> : null}
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
      <Text selectable style={[Typography.body, { color: colors.text, fontFamily: mono ? Fonts?.mono : undefined }]}>{value}</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  iconButton: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  skeleton: { gap: Spacing.three, padding: Spacing.three },
  titleBox: { gap: Spacing.two, alignItems: 'flex-start' },
  name: { fontFamily: FontFamily.semibold, fontSize: 22, lineHeight: 29, letterSpacing: -0.3 },
  live: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  failure: { gap: Spacing.two, padding: 14, borderRadius: Radius.lg },
  failureHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  failureTitle: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 22 },
  failureAction: { marginTop: Spacing.one },
  techBox: { gap: Spacing.one, padding: Spacing.two, borderRadius: Radius.md },
  section: { gap: Spacing.two },
  sectionTitle: { fontFamily: FontFamily.semibold, fontSize: 16, lineHeight: 22 },
  technical: { borderTopWidth: 1, paddingTop: Spacing.one },
  logsTitle: { marginTop: Spacing.two },
  chipsBleed: { marginHorizontal: -Spacing.three },
  logCard: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  log: { gap: Spacing.one, paddingVertical: 12, paddingHorizontal: 14 },
  techToggle: { minHeight: MinTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  tech: { gap: Spacing.one },
  logHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  level: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm },
  info: { gap: Spacing.half },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  pagerBtn: { minHeight: MinTouch, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Radius.md, borderWidth: 1 },
  bar: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: 1 },
});
