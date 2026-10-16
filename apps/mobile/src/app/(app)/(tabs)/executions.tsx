import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Activity, ChevronRight } from 'lucide-react-native';
import { format } from 'date-fns';
import { useExecutions } from '../../../features/executions/hooks/useExecutions';
import { RUN_FILTERS, filterRuns, parseRunFilter, type RunFilter } from '../../../features/executions/run-list';
import { useWorkflowNames } from '../../../features/workflows/hooks/useWorkflows';
import { groupByDay, type DayGroup } from '../../../features/notifications/notification.grouping';
import { fill } from '../../../features/common/fill';
import { durationBetween, formatHourMinute, formatRelativeTime } from '../../../features/common/time';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { HeaderActions } from '../../../components/ui/HeaderActions';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { SearchField } from '../../../components/ui/SearchField';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { TriggerTile } from '../../../components/ui/TriggerTile';
import { formatDuration } from '../../../components/ui/status';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { ExecutionSummary } from '../../../domain/execution/execution.types';

export default function ExecutionsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const params = useLocalSearchParams<{ filter?: string }>();
  const query = useExecutions();
  const names = useWorkflowNames();
  const [filter, setFilter] = useState<RunFilter>('all');
  const [search, setSearch] = useState('');

  // Home links here with `filter=failed` / `running`. The tab stays mounted, so read the parameter
  // whenever it arrives and clear it so the same shortcut works again later.
  useEffect(() => {
    if (params.filter !== undefined) {
      setFilter(parseRunFilter(params.filter));
      router.setParams({ filter: undefined });
    }
  }, [params.filter, router]);

  const all = query.data ?? [];
  const nameOf = (id: string) => names.get(id) ?? t('exl.unknownWorkflow');

  const visible = useMemo(() => filterRuns(all, filter, search, nameOf), [all, filter, search, names]);
  const groups = useMemo(() => groupByDay(visible, (run) => run.createdAt), [visible]);

  const chips: ChipOption<RunFilter>[] = RUN_FILTERS.map((value) => ({
    value,
    label: t(`rl.filter.${value}`),
    count: filterRuns(all, value, search, nameOf).length,
  }));

  const clearFilters = () => {
    setFilter('all');
    setSearch('');
  };

  const dayLabel = (group: DayGroup<ExecutionSummary>) =>
    group.bucket === 'today' ? t('ntf.today') : group.bucket === 'yesterday' ? t('ntf.yesterday') : format(group.date, 'dd/MM/yyyy');

  const renderRun = (run: ExecutionSummary, last: boolean) => {
    const active = run.status === 'QUEUED' || run.status === 'RUNNING' || run.status === 'WAITING';
    const duration = run.durationMs ?? durationBetween(run.startedAt, run.finishedAt);
    const when = `${formatHourMinute(run.createdAt)} · ${active ? t('rl.inProgress') : formatDuration(duration)}`;
    return (
      <Pressable
        key={run.executionId}
        testID={`run-row-${run.executionId}`}
        accessibilityRole="button"
        accessibilityLabel={fill(t('rl.open'), { name: nameOf(run.workflowId), time: formatRelativeTime(run.createdAt, language) })}
        accessibilityHint={t('exl.item.hint')}
        onPress={() => router.push(`/(app)/executions/${run.workflowId}/${run.executionId}`)}
        style={({ pressed }) => [
          styles.row,
          !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
          pressed && { backgroundColor: colors.cardSecondary },
        ]}
      >
        <TriggerTile type={run.triggerType} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={[Typography.body, { color: colors.text, fontFamily: FontFamily.medium }]}>
            {nameOf(run.workflowId)}
          </Text>
          <Text style={[Typography.mono, { color: colors.textSubtle }]}>{when}</Text>
        </View>
        <StatusBadge status={run.status} />
        <ChevronRight size={16} strokeWidth={1.75} color={colors.textSubtle} />
      </Pressable>
    );
  };

  const header = (
    <View style={styles.controls}>
      <View style={styles.field}>
        <SearchField
          testID="runs-search"
          value={search}
          onChangeText={setSearch}
          placeholder={t('rl.search.placeholder')}
          accessibilityLabel={t('rl.search.label')}
        />
      </View>
      <FilterChips<RunFilter> options={chips} value={filter} onChange={setFilter} accessibilityLabel={t('rl.filter.label')} />
    </View>
  );

  const footer = <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>{t('exl.note')}</Text>;

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
        showsVerticalScrollIndicator={false}
        data={groups}
        keyExtractor={(g) => g.key}
        renderItem={({ item: group }) => (
          <View style={styles.group}>
            <Text accessibilityRole="header" style={[styles.day, { color: colors.textSubtle }]}>
              {dayLabel(group)}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {group.items.map((run, i) => renderRun(run, i === group.items.length - 1))}
            </View>
          </View>
        )}
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
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />
        }
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {t('exl.title')}
        </Text>
        <HeaderActions />
      </View>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  title: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  list: { paddingBottom: Spacing.four },
  controls: { gap: Spacing.one, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  field: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  group: { paddingHorizontal: Spacing.three },
  day: { fontFamily: FontFamily.semibold, fontSize: 13, lineHeight: 18, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 2 },
  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, paddingLeft: 14, paddingRight: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  note: { textAlign: 'center', paddingTop: Spacing.three, paddingHorizontal: Spacing.three },
});
