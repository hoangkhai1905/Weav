import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pause, Play, Rocket, Trash2 } from 'lucide-react-native';
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
import { FlowList } from '../../../features/workflows/components/FlowList';
import { PublishResultSheet } from '../../../features/workflows/components/PublishResultSheet';
import { RunSheet } from '../../../features/workflows/components/RunSheet';
import { TriggerList } from '../../../features/workflows/components/TriggerList';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { fill } from '../../../features/common/fill';
import { durationBetween, formatRelativeTime } from '../../../features/common/time';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListItem } from '../../../components/ui/ListItem';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Skeleton } from '../../../components/ui/Skeleton';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { formatDuration } from '../../../components/ui/status';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { WorkflowPublication } from '../../../domain/workflow/workflow.types';

export default function WorkflowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workflowId = id ?? '';
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);

  const detail = useWorkflowDetail(workflowId);
  const history = useWorkflowExecutions(workflowId);
  const perms = useWorkflowPermissions();
  const runMutation = useRunWorkflow();
  const pauseMutation = usePauseWorkflow();
  const resumeMutation = useResumeWorkflow();
  const publishMutation = usePublishWorkflow();
  const deleteMutation = useDeleteWorkflow();

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
      showToast({ type: 'error', title: t('pub.failTitle'), message: friendlyErrorMessage(error) });
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

  let body: React.ReactNode;
  if (detail.isPending) {
    body = (
      <View style={styles.content}>
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
    const canPause = status === 'PUBLISHED' && perms.canManageState;
    const canResume = status === 'PAUSED' && perms.canManageState;
    const canPublish = status === 'DRAFT' && perms.canPublish;
    const canDelete = perms.canManageState;
    const noPermission = perms.loaded && !perms.canManageState && !perms.canPublish;
    const stateBusy = pauseMutation.isPending || resumeMutation.isPending;

    body = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={detail.isRefetching && !detail.isPending}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={[Typography.headline, styles.name, { color: colors.text }]}>
              {workflow.name}
            </Text>
            <StatusBadge status={status} size="md" />
          </View>
          <Text style={[Typography.body, { color: colors.textMuted }]}>
            {workflow.description?.trim() || t('wfl.noDescription')}
          </Text>
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>
            {fill(t('wfd.updated'), { time: formatRelativeTime(workflow.updatedAt, language) })}
            {' · '}
            {workflow.publishedAt
              ? fill(t('wfd.publishedAt'), { time: formatRelativeTime(workflow.publishedAt, language) })
              : t('wfd.notPublished')}
          </Text>
        </View>

        <Section title={t('wfd.actions')}>
          <View style={styles.actions}>
            {canRun ? (
              <ActionButton
                label={t('wfd.run')}
                icon={<Play size={18} color={colors.onPrimary} />}
                variant="primary"
                onPress={() => setShowRunModal(true)}
              />
            ) : null}
            {canPublish ? (
              <ActionButton
                label={t('wfd.publish')}
                icon={<Rocket size={18} color={colors.onPrimary} />}
                variant="primary"
                onPress={() => setConfirmPublish(true)}
              />
            ) : null}
            {canPause ? (
              <ActionButton
                label={t('wfd.pause')}
                icon={<Pause size={18} color={colors.text} />}
                variant="secondary"
                busy={stateBusy}
                onPress={() => void changeState('pause')}
              />
            ) : null}
            {canResume ? (
              <ActionButton
                label={t('wfd.resume')}
                icon={<Play size={18} color={colors.text} />}
                variant="secondary"
                busy={stateBusy}
                onPress={() => void changeState('resume')}
              />
            ) : null}
            {canDelete ? (
              <ActionButton
                label={t('wfd.delete')}
                icon={<Trash2 size={18} color={colors.danger} />}
                variant="danger"
                onPress={() => setConfirmDelete(true)}
              />
            ) : null}
          </View>
          {status !== 'PUBLISHED' ? (
            <Text style={[Typography.caption, { color: colors.textMuted }]}>
              {t(`wfd.run.cannot.${status}`)}
            </Text>
          ) : null}
          {noPermission ? (
            <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('wfd.noPermission')}</Text>
          ) : null}
        </Section>

        <Section title={t('wfd.triggers')}>
          <TriggerList triggers={workflow.triggers} workflowStatus={status} />
        </Section>

        <Section title={t('wfd.flow')}>
          <FlowList workflow={workflow} />
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>{t('wfd.flow.note')}</Text>
        </Section>

        <Section title={t('wfd.history')}>
          {history.isPending ? (
            <Skeleton height={64} />
          ) : history.isError ? (
            <ErrorState error={history.error as unknown as ApiError} onRetry={() => void history.refetch()} />
          ) : history.data.items.length === 0 ? (
            <EmptyState
              title={t('wfd.history.empty.title')}
              description={t('wfd.history.empty.body')}
              actionLabel={canRun ? t('wfd.run') : undefined}
              onAction={canRun ? () => setShowRunModal(true) : undefined}
            />
          ) : (
            <View style={styles.history}>
              {history.data.items.map((e) => (
                <ListItem
                  key={e.executionId}
                  title={t(`execution.trigger.${e.triggerType}`)}
                  subtitle={formatDuration(e.durationMs ?? durationBetween(e.startedAt, e.finishedAt))}
                  meta={formatRelativeTime(e.createdAt, language)}
                  trailing={<StatusBadge status={e.status} />}
                  accessibilityHint={t('exl.item.hint')}
                  onPress={() => router.push(`/(app)/executions/${e.workflowId}/${e.executionId}`)}
                />
              ))}
            </View>
          )}
        </Section>

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
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('wfd.title')} onBack={handleBack} />
      {body}
      <PublishResultSheet publication={publication} onClose={closePublication} />
    </SafeAreaView>
  );
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
};

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  variant: 'primary' | 'secondary' | 'danger';
  onPress: () => void;
  busy?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ label, icon, variant, onPress, busy = false }) => {
  const colors = useThemeColors();
  const palette = {
    primary: { bg: colors.primary, border: colors.primary, fg: colors.onPrimary },
    secondary: { bg: colors.card, border: colors.borderStrong, fg: colors.text },
    danger: { bg: colors.dangerBg, border: colors.tones.danger.border, fg: colors.danger },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={[styles.action, { backgroundColor: palette.bg, borderColor: palette.border, opacity: busy ? 0.6 : 1 }]}
    >
      {busy ? <ActivityIndicator color={palette.fg} /> : icon}
      <Text style={[Typography.label, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { gap: Spacing.four, padding: Spacing.three, paddingBottom: Spacing.six },
  card: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  titleRow: { gap: Spacing.two },
  name: { flexShrink: 1 },
  section: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  history: { gap: Spacing.two },
});
