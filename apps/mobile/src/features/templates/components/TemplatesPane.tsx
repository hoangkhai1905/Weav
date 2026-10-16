import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, LayoutTemplate } from 'lucide-react-native';
import { useInfiniteTemplates } from '../hooks/useTemplates';
import { TEMPLATE_GROUPS, templateGroup, type TemplateGroup } from '../template.helpers';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { SearchField } from '../../../components/ui/SearchField';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import { TemplateCard } from './TemplateCard';

type GroupFilter = 'all' | TemplateGroup;

/** "Mẫu có sẵn": the public gallery with a search box (server side) and group chips (on the loaded pages). */
export const TemplatesPane: React.FC = () => {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<GroupFilter>('all');

  // The search runs on the server, so wait for a pause in typing instead of asking on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useInfiniteTemplates('public', q);
  const loaded = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const items = useMemo(
    () => (group === 'all' ? loaded : loaded.filter((item) => templateGroup(item.nodeTypes) === group)),
    [loaded, group],
  );
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const chips: ChipOption<GroupFilter>[] = [
    { value: 'all', label: t('tpl.group.all'), count: loaded.length },
    ...TEMPLATE_GROUPS.map((value) => ({
      value,
      label: t(`tpl.group.${value}`),
      count: loaded.filter((item) => templateGroup(item.nodeTypes) === value).length,
    })).filter((chip) => chip.count > 0 || chip.value === group),
  ];

  const header = (
    <View style={styles.controls}>
      <View style={styles.field}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('tpl.pane.search')}
          accessibilityLabel={t('tpl.search.label')}
        />
      </View>
      <FilterChips<GroupFilter> options={chips} value={group} onChange={setGroup} accessibilityLabel={t('tpl.group.label')} />
      <Pressable
        testID="templates-more"
        accessibilityRole="button"
        accessibilityLabel={t('tpl.more')}
        onPress={() => router.push('/(app)/templates')}
        style={styles.more}
      >
        <Text style={[Typography.label, styles.moreLabel, { color: colors.primary }]}>{t('tpl.more')}</Text>
        <ChevronRight size={16} strokeWidth={1.75} color={colors.primary} />
      </Pressable>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
      {query.hasNextPage && !query.isFetchingNextPage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('ui.loadMore')}
          onPress={loadMore}
          style={[styles.loadMore, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}
        >
          <Text style={[Typography.label, { color: colors.text }]}>{t('ui.loadMore')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // The header stays mounted in every state, so typing in the search box never loses focus.
  const emptyKey = q || group !== 'all' ? 'noMatch' : 'public';
  const empty = query.isPending ? (
    <ListSkeleton />
  ) : query.isError ? (
    <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyState
      icon={<LayoutTemplate size={36} color={colors.textMuted} />}
      title={t(`tpl.empty.${emptyKey}.title`)}
      description={t(`tpl.empty.${emptyKey}.body`)}
    />
  );

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <TemplateCard template={item} onOpen={() => router.push(`/(app)/templates/${item.id}`)} />
        </View>
      )}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
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
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: MinTouch, paddingHorizontal: Spacing.three },
  moreLabel: { flexShrink: 1 },
  footer: { gap: Spacing.two, paddingTop: Spacing.three, alignItems: 'center' },
  loadMore: { minHeight: MinTouch, paddingHorizontal: Spacing.four, justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1 },
});
