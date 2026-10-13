import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { GitFork } from 'lucide-react-native';
import { useInfiniteWorkflows, usePauseWorkflow, useResumeWorkflow } from '../hooks/useWorkflows';
import { useWorkflowPermissions } from '../hooks/useWorkflowPermissions';
import { filterWorkflows, type WorkflowStatusFilter } from '../workflow.filter';
import { friendlyErrorMessage } from '../../common/friendly-error';
import { fill } from '../../common/fill';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { SearchField } from '../../../components/ui/SearchField';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { WorkflowSummary } from '../../../domain/workflow/workflow.types';
import { WorkflowCard } from './WorkflowCard';

const STATUS_FILTERS: WorkflowStatusFilter[] = ['ALL', 'PUBLISHED', 'PAUSED', 'DRAFT'];
const FILTER_LABEL: Record<WorkflowStatusFilter, string> = {
  ALL: 'ui.filter.all',
  PUBLISHED: 'wfl.filter.on',
  PAUSED: 'wfl.filter.paused',
  DRAFT: 'wfl.filter.draft',
};

/** "Của nhóm": the workspace's workflows with a status filter and a switch per row. */
export const TeamWorkflowsPane: React.FC<{ onCreate: () => void }> = ({ onCreate }) => {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const query = useInfiniteWorkflows();
  const perms = useWorkflowPermissions();
  const pause = usePauseWorkflow();
  const resume = useResumeWorkflow();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WorkflowStatusFilter>('ALL');
  // A switch shows the new position at once; the entry is dropped when the list catches up or the call fails.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const loaded = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.totalElements ?? 0;
  const visible = useMemo(() => filterWorkflows(loaded, status, search), [loaded, status, search]);
  const filtering = status !== 'ALL' || search.trim() !== '';
  const partial = query.hasNextPage === true;

  useEffect(() => {
    setPending((current) => {
      const ids = Object.keys(current);
      if (ids.length === 0) return current;
      const next = { ...current };
      for (const w of loaded) if (w.workflowId in next && (w.status === 'PUBLISHED') === next[w.workflowId]) delete next[w.workflowId];
      return Object.keys(next).length === ids.length ? current : next;
    });
  }, [loaded]);

  const chips: ChipOption<WorkflowStatusFilter>[] = STATUS_FILTERS.map((value) => ({
    value,
    label: t(FILTER_LABEL[value]),
    count: filterWorkflows(loaded, value, search).length,
  }));

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('ALL');
  }, []);
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const toggle = async (workflow: WorkflowSummary, next: boolean) => {
    setPending((current) => ({ ...current, [workflow.workflowId]: next }));
    try {
      await (next ? resume : pause).mutateAsync(workflow.workflowId);
    } catch (error) {
      setPending((current) => {
        const { [workflow.workflowId]: _dropped, ...rest } = current;
        return rest;
      });
      showToast({ type: 'error', title: t('wfl.switch.failed'), message: friendlyErrorMessage(error) });
    }
  };

  const header = (
    <View style={styles.controls}>
      <View style={styles.field}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('wfl.pane.search')}
          accessibilityLabel={t('wfl.search.label')}
        />
      </View>
      <FilterChips<WorkflowStatusFilter> options={chips} value={status} onChange={setStatus} accessibilityLabel={t('wfl.filter.label')} />
      {perms.loaded && !perms.canManageState ? (
        <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>{t('wfl.switch.locked')}</Text>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
      {partial && !query.isFetchingNextPage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wfl.loadMore')}
          onPress={loadMore}
          style={[styles.more, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}
        >
          <Text style={[Typography.label, { color: colors.text }]}>{t('wfl.loadMore')}</Text>
        </Pressable>
      ) : null}
      {partial && filtering ? (
        <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>
          {fill(t('wfl.limit.note'), { loaded: loaded.length, total })}
        </Text>
      ) : null}
    </View>
  );

  if (query.isPending) return <ListSkeleton />;
  if (query.isError && loaded.length === 0) {
    return <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  }
  if (loaded.length === 0) {
    return (
      <EmptyState
        icon={<GitFork size={36} color={colors.textMuted} />}
        title={t('wfl.empty.title')}
        description={t('wfl.empty.body')}
        actionLabel={t('wfl.empty.action')}
        onAction={onCreate}
      />
    );
  }

  return (
    <FlatList
      data={visible}
      keyExtractor={(w) => w.workflowId}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <WorkflowCard
            workflow={item}
            on={pending[item.workflowId] ?? item.status === 'PUBLISHED'}
            canToggle={perms.loaded && perms.canManageState && !(item.workflowId in pending)}
            onToggle={(next) => void toggle(item, next)}
            onOpen={() => router.push(`/(app)/workflows/${item.workflowId}`)}
          />
        </View>
      )}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        <EmptyState
          title={t('wfl.noMatch.title')}
          description={t('wfl.noMatch.body')}
          actionLabel={t('ui.clearFilters')}
          onAction={clearFilters}
        />
      }
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          tintColor={colors.primary}
        />
      }
    />
  );
};

const Separator: React.FC = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  list: { paddingBottom: Spacing.four },
  controls: { gap: Spacing.one, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  field: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  row: { paddingHorizontal: Spacing.three },
  separator: { height: 10 },
  footer: { gap: Spacing.two, paddingTop: Spacing.three, alignItems: 'center' },
  more: {
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  note: { textAlign: 'center', paddingHorizontal: Spacing.three },
});
