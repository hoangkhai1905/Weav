import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Activity, ChevronDown, MessageCircle } from 'lucide-react-native';
import { useExecutions } from '../../../features/executions/hooks/useExecutions';
import { useWorkflowNames } from '../../../features/workflows/hooks/useWorkflows';
import { fill } from '../../../features/common/fill';
import { durationBetween, formatRelativeTime } from '../../../features/common/time';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListItem } from '../../../components/ui/ListItem';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Sheet } from '../../../components/ui/Sheet';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { formatDuration } from '../../../components/ui/status';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { ExecutionStatus, ExecutionSummary } from '../../../domain/execution/execution.types';

type StatusFilter = 'ALL' | ExecutionStatus;
const STATUS_FILTERS: StatusFilter[] = ['ALL', 'RUNNING', 'QUEUED', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'];

export default function ExecutionsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const query = useExecutions();
  const names = useWorkflowNames();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const all = query.data ?? [];
  const nameOf = (id: string) => names.get(id) ?? t('exl.unknownWorkflow');

  const workflowOptions = Array.from(new Set(all.map((e) => e.workflowId))).map((id) => ({ id, name: nameOf(id) }));

  const visible = useMemo(
    () => all.filter((e) => (status === 'ALL' || e.status === status) && (!workflowId || e.workflowId === workflowId)),
    [all, status, workflowId],
  );

  const chips: ChipOption<StatusFilter>[] = STATUS_FILTERS.map((value) => ({
    value,
    label: value === 'ALL' ? t('ui.filter.all') : t(`status.${value}`),
  }));

  const clearFilters = () => {
    setStatus('ALL');
    setWorkflowId(null);
  };

  const renderItem = ({ item }: { item: ExecutionSummary }) => {
    const duration = formatDuration(item.durationMs ?? durationBetween(item.startedAt, item.finishedAt));
    return (
      <ListItem
        title={nameOf(item.workflowId)}
        subtitle={`${t(`execution.trigger.${item.triggerType}`)} · ${duration}`}
        meta={formatRelativeTime(item.createdAt, language)}
        trailing={<StatusBadge status={item.status} />}
        accessibilityHint={t('exl.item.hint')}
        onPress={() => router.push(`/(app)/executions/${item.workflowId}/${item.executionId}`)}
      />
    );
  };

  const header = (
    <View style={styles.controls}>
      <FilterChips<StatusFilter> options={chips} value={status} onChange={setStatus} accessibilityLabel={t('exl.filter.status')} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('exl.filter.workflow')}: ${workflowId ? nameOf(workflowId) : t('exl.filter.allWorkflows')}`}
        onPress={() => setPickerOpen(true)}
        style={[styles.picker, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}
      >
        <Text numberOfLines={1} style={[Typography.body, styles.pickerText, { color: colors.text }]}>
          {workflowId ? nameOf(workflowId) : t('exl.filter.allWorkflows')}
        </Text>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );

  const footer = (
    <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>{t('exl.note')}</Text>
  );

  let body: React.ReactNode;
  if (query.isPending) {
    body = <ListSkeleton />;
  } else if (query.isError && all.length === 0) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else if (all.length === 0) {
    body = (
      <EmptyState
        icon={<Activity size={36} color={colors.textMuted} />}
        title={t('exl.empty.title')}
        description={t('exl.empty.body')}
        actionLabel={t('exl.empty.action')}
        onAction={() => router.navigate('/(app)/(tabs)/workflows')}
      />
    );
  } else {
    body = (
      <FlatList
        data={visible}
        keyExtractor={(e) => e.executionId}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <EmptyState
            title={t('exl.noMatch.title')}
            description={t('exl.noMatch.body')}
            actionLabel={t('ui.clearFilters')}
            onAction={clearFilters}
          />
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />
        }
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={t('exl.title')}
        subtitle={query.data ? fill(t('exl.count'), { n: visible.length }) : undefined}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('asst.open')}
            onPress={() => router.push('/(app)/assistant')}
            style={styles.assistant}
          >
            <MessageCircle size={22} color={colors.primary} />
          </Pressable>
        }
      />
      {body}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t('exl.filter.pick')}>
        <WorkflowChoice
          label={t('exl.filter.allWorkflows')}
          selected={workflowId === null}
          onPress={() => {
            setWorkflowId(null);
            setPickerOpen(false);
          }}
        />
        {workflowOptions.map((o) => (
          <WorkflowChoice
            key={o.id}
            label={o.name}
            selected={workflowId === o.id}
            onPress={() => {
              setWorkflowId(o.id);
              setPickerOpen(false);
            }}
          />
        ))}
      </Sheet>
    </SafeAreaView>
  );
}

const WorkflowChoice: React.FC<{ label: string; selected: boolean; onPress: () => void }> = ({ label, selected, onPress }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? colors.primaryBg : colors.card,
          borderColor: selected ? colors.primaryBorder : colors.border,
        },
      ]}
    >
      <Text style={[Typography.body, { color: colors.text, fontWeight: selected ? '700' : '400' }]}>{label}</Text>
    </Pressable>
  );
};

const Separator = () => <View style={{ height: Spacing.two }} />;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five },
  controls: { gap: Spacing.two, paddingVertical: Spacing.three, marginHorizontal: -Spacing.three },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    marginHorizontal: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  pickerText: { flex: 1 },
  assistant: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  note: { textAlign: 'center', paddingTop: Spacing.three },
  choice: {
    minHeight: MinTouch,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
});
