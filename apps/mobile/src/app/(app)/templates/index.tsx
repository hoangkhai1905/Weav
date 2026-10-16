import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LayoutTemplate } from 'lucide-react-native';
import { useInfiniteTemplates, useTemplateByCode } from '../../../features/templates/hooks/useTemplates';
import { templateErrorKey } from '../../../features/templates/template.helpers';
import { fill } from '../../../features/common/fill';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListItem } from '../../../components/ui/ListItem';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { SearchField } from '../../../components/ui/SearchField';
import { TextField } from '../../../components/ui/TextField';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { TemplateScope, TemplateSummary } from '../../../domain/template/template.types';
import { TEMPLATE_CODE_MAX } from '../../../infrastructure/http/template.http.contract';

const TABS: TemplateScope[] = ['public', 'mine'];

export default function TemplatesScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [tab, setTab] = useState<TemplateScope>('public');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const lookup = useTemplateByCode();

  // The search runs on the server, so wait for a pause in typing instead of asking on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useInfiniteTemplates(tab, tab === 'public' ? q : '');
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const chips: ChipOption<TemplateScope>[] = TABS.map((value) => ({ value, label: t(`tpl.tab.${value}`) }));
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/workflows'));
  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const submitCode = () => {
    const trimmed = code.trim();
    if (!trimmed || lookup.isPending) return;
    lookup.mutate(trimmed, { onSuccess: (detail) => router.push(`/(app)/templates/${detail.id}`) });
  };

  const renderItem = ({ item }: { item: TemplateSummary }) => (
    <ListItem
      title={item.name}
      subtitle={item.authorName ? fill(t('tpl.byAuthor'), { name: item.authorName }) : item.description?.trim() || undefined}
      meta={fill(t('tpl.usedCount'), { n: item.usageCount })}
      trailing={
        tab === 'mine' ? (
          <Text style={[Typography.caption, { color: colors.textMuted }]}>{t(`tpl.visibility.${item.visibility}`)}</Text>
        ) : undefined
      }
      accessibilityHint={t('tpl.item.hint')}
      onPress={() => router.push(`/(app)/templates/${item.id}`)}
    />
  );

  const header = (
    <View style={[styles.controls, { borderBottomColor: colors.border }]}>
      <View style={styles.code}>
        <TextField
          label={t('tpl.code.label')}
          value={code}
          onChangeText={(value) => {
            setCode(value);
            if (lookup.isError) lookup.reset();
          }}
          placeholder={t('tpl.code.placeholder')}
          autoCapitalize="characters"
          maxLength={TEMPLATE_CODE_MAX}
          returnKeyType="search"
          onSubmitEditing={submitCode}
          error={lookup.isError ? t(templateErrorKey(lookup.error, 'lookup')) : null}
        />
        <Button label={t('tpl.code.find')} onPress={submitCode} busy={lookup.isPending} disabled={code.trim() === ''} />
      </View>
      <FilterChips<TemplateScope> options={chips} value={tab} onChange={setTab} accessibilityLabel={t('tpl.tabs.label')} />
      {tab === 'public' ? (
        <View style={styles.field}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('tpl.search.placeholder')}
            accessibilityLabel={t('tpl.search.label')}
          />
        </View>
      ) : null}
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
          style={[styles.more, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}
        >
          <Text style={[Typography.label, { color: colors.text }]}>{t('ui.loadMore')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // The header stays mounted in every state, so typing in the search box never loses focus.
  const emptyKey = tab === 'mine' ? 'mine' : q ? 'noMatch' : 'public';
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
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('tpl.title')} onBack={goBack} />
      <FlatList
        showsVerticalScrollIndicator={false}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={empty}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingBottom: Spacing.five },
  controls: { gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: 1 },
  code: { gap: Spacing.two, paddingHorizontal: Spacing.three },
  field: { paddingHorizontal: Spacing.three },
  footer: { gap: Spacing.two, paddingTop: Spacing.three, alignItems: 'center' },
  more: {
    minHeight: MinTouch,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});
