import React, { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronRight, Ellipsis, Play, Trash2, Upload } from 'lucide-react-native';
import { format } from 'date-fns';
import { useWorkflowDetail } from '../../../features/workflows/hooks/useWorkflowDetail';
import {
  useDeleteWorkflow,
  usePauseWorkflow,
  usePublishWorkflow,
  useResumeWorkflow,
} from '../../../features/workflows/hooks/useWorkflows';
import { useRunWorkflow } from '../../../features/workflows/hooks/useRunWorkflow';
import { useWorkflowPermissions } from '../../../features/workflows/hooks/useWorkflowPermissions';
import { useWorkflowExecutions } from '../../../features/executions/hooks/useWorkflowExecutions';
import { completeWorkflowRunInCurrentSession } from '../../../features/workflows/run-workflow.session';
import { newIdempotencyKey } from '../../../infrastructure/http/workflow.http.contract';
import { isUnknownOutcomeTimeout } from '../../../infrastructure/http/gateway-request';
import { FlowCards } from '../../../features/workflows/components/FlowCards';
import { PublishResultSheet } from '../../../features/workflows/components/PublishResultSheet';
import { publishErrorKey } from '../../../features/workflows/publish-error';
import { RunSheet } from '../../../features/workflows/components/RunSheet';
import { TriggerList } from '../../../features/workflows/components/TriggerList';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { fill } from '../../../features/common/fill';
import { durationBetween, formatHourMinute, formatRelativeTime } from '../../../features/common/time';
import { groupByDay } from '../../../features/notifications/notification.grouping';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { HeaderActions } from '../../../components/ui/HeaderActions';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton } from '../../../components/ui/Skeleton';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { StepTileText } from '../../../components/ui/StepTile';
import { Toggle } from '../../../components/ui/Toggle';
import { formatDuration } from '../../../components/ui/status';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { FontFamily, MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { WorkflowPublication } from '../../../domain/workflow/workflow.types';

type DetailSegment = 'steps' | 'runs';

export default function WorkflowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workflowId = id ?? '';
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);

  const deleteMutation = useDeleteWorkflow();
  // Once the delete is under way the workflow is gone: stop reading it so no 404 request fires.
  const keepReading = !deleteMutation.isPending && !deleteMutation.isSuccess;
  const detail = useWorkflowDetail(workflowId, keepReading);
  const history = useWorkflowExecutions(workflowId, keepReading);
  const perms = useWorkflowPermissions();
  const runMutation = useRunWorkflow();
  const pauseMutation = usePauseWorkflow();
  const resumeMutation = useResumeWorkflow();
  const publishMutation = usePublishWorkflow();

  const [segment, setSegment] = useState<DetailSegment>('steps');
  const [moreOpen, setMoreOpen] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [payloadInput, setPayloadInput] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publication, setPublication] = useState<WorkflowPublication | null>(null);
  // One Idempotency-Key per tap. It is kept only after a 504/timeout (outcome unknown), so the
  // retry is de-duplicated by the backend; a changed input or any other outcome starts a new key.
  const runKeyRef = useRef<string | null>(null);

  const workflow = detail.data;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/(tabs)/workflows');
  };

  const handleRunConfirm = async (input: Record<string, unknown>) => {
    if (!workflow) return;
    const idempotencyKey = runKeyRef.current ?? newIdempotencyKey();
    runKeyRef.current = idempotencyKey;
    const completion = await completeWorkflowRunInCurrentSession(
      () =>
        runMutation.mutateAsync({ id: workflow.workflowId, input, idempotencyKey }).catch((error: unknown) => {
          if (!isUnknownOutcomeTimeout(error)) runKeyRef.current = null;
          throw error;
        }),
    );
    if (completion.status !== 'success') return;
    const res = completion.result;
    runKeyRef.current = null;
    setShowRunModal(false);
    setPayloadInput('');
    if (res?.executionId) {
      router.push(`/(app)/executions/${res.workflowId}/${res.executionId}`);
    }
  };

  const changeState = async (action: 'pause' | 'resume') => {
    if (!workflow) return;
    try {
      await (action === 'pause' ? pauseMutation : resumeMutation).mutateAsync(workflow.workflowId);
    } catch (error) {
      showToast({ type: 'error', title: t('wfd.stateFailTitle'), message: friendlyErrorMessage(error) });
    }
  };

  const handlePublish = async () => {
    if (!workflow) return;
    try {
      const result = await publishMutation.mutateAsync(workflow.workflowId);
      setConfirmPublish(false);
      setPublication(result);
    } catch (error) {
      setConfirmPublish(false);
      const key = publishErrorKey(error);
      showToast({ type: 'error', title: t('pub.failTitle'), message: key ? t(key) : friendlyErrorMessage(error) });
    }
  };

  const closePublication = () => {
    setPublication(null);
    publishMutation.reset(); // drop the one-time secrets from the mutation cache
  };

  const handleDelete = async () => {
    if (!workflow) return;
    try {
      await deleteMutation.mutateAsync(workflow.workflowId);
      setConfirmDelete(false);
      showToast({ type: 'success', title: t('del.done') });
      router.replace('/(app)/(tabs)/workflows');
    } catch (error) {
      setConfirmDelete(false);
      showToast({ type: 'error', title: t('del.failTitle'), message: friendlyErrorMessage(error) });
    }
  };

  const refresh = () => {
    void detail.refetch();
    void history.refetch();
  };

  const runWhen = (iso: string) => {
    const bucket = groupByDay([iso], (value) => value)[0];
    const day = !bucket
      ? ''
      : bucket.bucket === 'today'
        ? t('ntf.today')
        : bucket.bucket === 'yesterday'
          ? t('ntf.yesterday')
          : format(bucket.date, 'dd/MM');
    return `${day} ${formatHourMinute(iso)}`.trim();
  };

  let body: React.ReactNode;
  if (detail.isPending) {
    body = (
      <View style={styles.skeleton}>
        <Skeleton height={28} width="70%" />
        <Skeleton height={16} width="90%" />
        <Skeleton height={44} />
        <Skeleton height={96} />
        <Skeleton height={96} />
      </View>
    );
  } else if (detail.isError || !workflow) {
    body = <ErrorState error={detail.error as unknown as ApiError} onRetry={() => void detail.refetch()} />;
  } else {
    const status = workflow.status;
    const canRun = status === 'PUBLISHED';
    const canToggle = status !== 'DRAFT' && perms.canManageState;
    const canPublish = status === 'DRAFT' && perms.canPublish;
    const canDelete = perms.canManageState;
    const noPermission = perms.loaded && !perms.canManageState && !perms.canPublish;
    const stateBusy = pauseMutation.isPending || resumeMutation.isPending;
    const isOn = status === 'PUBLISHED';
    const statusText = t(status === 'DRAFT' ? 'wfd.status.draft' : isOn ? 'wfd.status.on' : 'wfd.status.off');
    const runs = history.data?.items ?? [];

    body = (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={detail.isRefetching && !detail.isPending}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>
              {workflow.name}
            </Text>
            <Text style={[Typography.caption, { color: colors.textMuted }]}>
              {statusText}
              {' · '}
              {fill(t('wfd.updated'), { time: formatRelativeTime(workflow.updatedAt, language) })}
            </Text>
            {workflow.description?.trim() ? (
              <Text style={[Typography.body, { color: colors.textMuted }]}>{workflow.description.trim()}</Text>
            ) : null}
          </View>
          {status !== 'DRAFT' ? (
            <Toggle
              testID="workflow-detail-toggle"
              value={isOn}
              disabled={!canToggle || stateBusy}
              accessibilityLabel={t('wfd.toggle.label')}
              onChange={(next) => void changeState(next ? 'resume' : 'pause')}
            />
          ) : null}
        </View>

        <View style={styles.actions}>
          {canRun ? (
            <View style={styles.actionCell}>
              <Button
                testID="workflow-run"
                label={t('wfd.run')}
                icon={<Play size={16} strokeWidth={1.75} color={colors.onButton} />}
                onPress={() => setShowRunModal(true)}
              />
            </View>
          ) : canPublish ? (
            <View style={styles.actionCell}>
              <Button
                testID="workflow-publish"
                label={t('wfd.publish')}
                icon={<Upload size={16} strokeWidth={1.75} color={colors.onButton} />}
                onPress={() => setConfirmPublish(true)}
              />
            </View>
          ) : null}
          <View style={styles.actionCell}>
            <Button
              testID="workflow-create-ai"
              variant="secondary"
              label={t('wfd.ai')}
              accessibilityHint={t('wfd.ai.hint')}
              icon={<StepTileText kind="ai" size={22} label="AI" />}
              onPress={() => router.push('/(app)/ai/generator')}
            />
          </View>
        </View>
        {status !== 'PUBLISHED' ? (
          <Text style={[Typography.caption, { color: colors.textMuted }]}>{t(`wfd.run.cannot.${status}`)}</Text>
        ) : null}
        {noPermission ? <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('wfd.noPermission')}</Text> : null}

        <SegmentedControl<DetailSegment>
          accessibilityLabel={t('wfd.seg.label')}
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'steps', label: t('wfd.seg.steps') },
            { value: 'runs', label: t('wfd.seg.runs') },
          ]}
        />

        {segment === 'steps' ? (
          <>
            <FlowCards workflow={workflow} />
            <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>{t('wfd.flow.note')}</Text>
            <View style={styles.section}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
                {t('wfd.triggers')}
              </Text>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TriggerList triggers={workflow.triggers} workflowStatus={status} />
              </View>
            </View>
          </>
        ) : history.isPending ? (
          <Skeleton height={64} radius={Radius.lg} />
        ) : history.isError ? (
          <ErrorState error={history.error as unknown as ApiError} onRetry={() => void history.refetch()} />
        ) : runs.length === 0 ? (
          <EmptyState
            title={t('wfd.history.empty.title')}
            description={t('wfd.history.empty.body')}
            actionLabel={canRun ? t('wfd.run') : undefined}
            onAction={canRun ? () => setShowRunModal(true) : undefined}
          />
        ) : (
          <View style={[styles.card, styles.runs, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {runs.map((e, i) => (
              <Pressable
                key={e.executionId}
                testID={`workflow-run-${e.executionId}`}
                accessibilityRole="button"
                accessibilityLabel={`${runWhen(e.createdAt)}, ${t(`status.${e.status}`)}`}
                accessibilityHint={t('exl.item.hint')}
                onPress={() => router.push(`/(app)/executions/${e.workflowId}/${e.executionId}`)}
                style={({ pressed }) => [
                  styles.runRow,
                  i < runs.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  pressed && { backgroundColor: colors.cardSecondary },
                ]}
              >
                <View style={styles.runText}>
                  <Text style={[Typography.mono, { color: colors.text }]}>{runWhen(e.createdAt)}</Text>
                  <Text style={[Typography.caption, { color: colors.textSubtle }]}>
                    {formatDuration(e.durationMs ?? durationBetween(e.startedAt, e.finishedAt))}
                  </Text>
                </View>
                <StatusBadge status={e.status} />
                <ChevronRight size={16} strokeWidth={1.75} color={colors.textSubtle} />
              </Pressable>
            ))}
          </View>
        )}

        <RunSheet
          visible={showRunModal}
          value={payloadInput}
          onChange={(value) => {
            runKeyRef.current = null;
            setPayloadInput(value);
          }}
          busy={runMutation.isPending}
          onSubmit={(input) => void handleRunConfirm(input)}
          onClose={() => setShowRunModal(false)}
        />
        <ConfirmSheet
          visible={confirmPublish}
          title={t('pub.confirm.title')}
          message={t('pub.confirm.body')}
          confirmLabel={t('pub.confirm.action')}
          busy={publishMutation.isPending}
          onConfirm={() => void handlePublish()}
          onClose={() => setConfirmPublish(false)}
        />
        <ConfirmSheet
          visible={confirmDelete}
          title={t('del.title')}
          message={fill(t('del.body'), { name: workflow.name })}
          confirmLabel={t('del.action')}
          destructive
          busy={deleteMutation.isPending}
          onConfirm={() => void handleDelete()}
          onClose={() => setConfirmDelete(false)}
        />
        <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={t('wfd.more')}>
          {canPublish ? (
            <MenuRow
              icon={<Upload size={18} strokeWidth={1.75} color={colors.text} />}
              label={t('wfd.publish')}
              onPress={() => {
                setMoreOpen(false);
                setConfirmPublish(true);
              }}
            />
          ) : null}
          {canDelete ? (
            <MenuRow
              icon={<Trash2 size={18} strokeWidth={1.75} color={colors.danger} />}
              label={t('wfd.delete')}
              danger
              onPress={() => {
                setMoreOpen(false);
                setConfirmDelete(true);
              }}
            />
          ) : null}
          {!canPublish && !canDelete ? (
            <Text style={[Typography.body, styles.menuEmpty, { color: colors.textMuted }]}>{t('wfd.noPermission')}</Text>
          ) : null}
        </Sheet>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable
          testID="workflow-back"
          accessibilityRole="button"
          accessibilityLabel={t('wfd.back')}
          onPress={handleBack}
          style={styles.iconButton}
        >
          <ArrowLeft size={20} strokeWidth={1.75} color={colors.text} />
        </Pressable>
        <View style={styles.headerSpace} />
        <HeaderActions />
        {workflow ? (
          <Pressable
            testID="workflow-more"
            accessibilityRole="button"
            accessibilityLabel={t('wfd.more')}
            onPress={() => setMoreOpen(true)}
            style={styles.iconButton}
          >
            <Ellipsis size={20} strokeWidth={1.75} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {body}
      <PublishResultSheet publication={publication} onClose={closePublication} />
    </SafeAreaView>
  );
}

const MenuRow: React.FC<{ icon: React.ReactNode; label: string; danger?: boolean; onPress: () => void }> = ({ icon, label, danger, onPress }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.menuRow, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
    >
      {icon}
      <Text style={[Typography.body, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  headerSpace: { flex: 1 },
  iconButton: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  skeleton: { gap: Spacing.three, padding: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  titleText: { flex: 1, gap: 6 },
  name: { fontFamily: FontFamily.semibold, fontSize: 22, lineHeight: 29, letterSpacing: -0.3 },
  actions: { flexDirection: 'row', gap: 10 },
  actionCell: { flex: 1 },
  note: { textAlign: 'center' },
  section: { gap: Spacing.two },
  sectionTitle: { fontFamily: FontFamily.semibold, fontSize: 16, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: 14 },
  runs: { padding: 0, overflow: 'hidden' },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14 },
  runText: { flex: 1 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch, paddingHorizontal: Spacing.three, borderBottomWidth: 1 },
  menuEmpty: { padding: Spacing.three },
});
