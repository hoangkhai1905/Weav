import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { GitFork, Search, Sparkles, X } from 'lucide-react-native';
import { useInfiniteWorkflows } from '../../../features/workflows/hooks/useWorkflows';
import { filterWorkflows, type WorkflowStatusFilter } from '../../../features/workflows/workflow.filter';
import { fill } from '../../../features/common/fill';
import { formatRelativeTime } from '../../../features/common/time';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListItem } from '../../../components/ui/ListItem';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { WorkflowSummary } from '../../../domain/workflow/workflow.types';

const STATUS_FILTERS: WorkflowStatusFilter[] = ['ALL', 'PUBLISHED', 'PAUSED', 'DRAFT'];

export default function WorkflowsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const query = useInfiniteWorkflows();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WorkflowStatusFilter>('ALL');

  const loaded = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.totalElements ?? 0;
  const visible = useMemo(() => filterWorkflows(loaded, status, search), [loaded, status, search]);
  const filtering = status !== 'ALL' || search.trim() !== '';
  const partial = query.hasNextPage === true;

  const chips: ChipOption<WorkflowStatusFilter>[] = STATUS_FILTERS.map((value) => ({
    value,
    label: value === 'ALL' ? t('ui.filter.all') : t(`status.${value}`),
  }));

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('ALL');
  }, []);
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);
  const openAi = () => router.push('/(app)/ai/generator');

  const renderItem = ({ item }: { item: WorkflowSummary }) => (
    <ListItem
      title={item.name}
      subtitle={item.description?.trim() || t('wfl.noDescription')}
      meta={fill(t('wfl.updated'), { time: formatRelativeTime(item.updatedAt, language) })}
      trailing={<StatusBadge status={item.status} />}
      accessibilityHint={t('wfl.item.hint')}
      onPress={() => router.push(`/(app)/workflows/${item.workflowId}`)}
    />
  );

  const header = (
    <View style={styles.controls}>
      <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}>
        <Search size={18} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('wfl.search.placeholder')}
          placeholderTextColor={colors.textSubtle}
          accessibilityLabel={t('wfl.search.label')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[Typography.body, styles.searchInput, { color: colors.text }]}
        />
        {search !== '' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ui.clearSearch')}
            onPress={() => setSearch('')}
            style={styles.clear}
          >
            <X size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <FilterChips<WorkflowStatusFilter> options={chips} value={status} onChange={setStatus} accessibilityLabel={t('wfl.filter.label')} />
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

  let body: React.ReactNode;
  if (query.isPending) {
    body = <ListSkeleton />;
  } else if (query.isError && loaded.length === 0) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else if (loaded.length === 0) {
    body = (
      <EmptyState
        icon={<GitFork size={36} color={colors.textMuted} />}
        title={t('wfl.empty.title')}
        description={t('wfl.empty.body')}
        actionLabel={t('wfl.empty.action')}
        onAction={openAi}
      />
    );
  } else {
    body = (
      <FlatList
        data={visible}
        keyExtractor={(w) => w.workflowId}
        renderItem={renderItem}
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
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={t('wfl.title')}
        subtitle={query.data ? fill(t('wfl.count'), { n: total }) : undefined}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('wfl.create.ai')}
            onPress={openAi}
            style={[styles.ai, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]}
          >
            <Sparkles size={20} color={colors.primary} />
          </Pressable>
        }
      />
      {body}
    </SafeAreaView>
  );
}

const Separator = () => <View style={{ height: Spacing.two }} />;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.five },
  controls: { gap: Spacing.two, paddingTop: Spacing.three, paddingBottom: Spacing.three, marginHorizontal: -Spacing.three },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    marginHorizontal: Spacing.three,
    paddingLeft: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, minHeight: MinTouch },
  clear: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  footer: { gap: Spacing.two, paddingTop: Spacing.three, alignItems: 'center' },
  more: {
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  note: { textAlign: 'center' },
  ai: {
    width: MinTouch,
    height: MinTouch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});
