import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, ChevronRight, CheckCheck, CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { format } from 'date-fns';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationUnreadCount,
} from '../../../features/notifications/hooks/useNotifications';
import { useNotificationTargetNavigator } from '../../../features/notifications/hooks/useNotificationTargetNavigator';
import { getSafeNotificationRoute } from '../../../features/notifications/notification.target';
import { groupByDay, type DayGroup } from '../../../features/notifications/notification.grouping';
import { formatRelativeTime } from '../../../features/common/time';
import { useAuthStore } from '../../../stores/auth.store';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../../features/auth/auth-session.scope';
import type {
  NotificationCategoryFilter,
  NotificationItem,
  NotificationSeverity,
} from '../../../domain/notification/notification.types';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { FilterChips, type ChipOption } from '../../../components/ui/FilterChips';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import type { ApiError } from '../../../domain/common/error.types';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';

type CategoryChip = 'ALL' | NotificationCategoryFilter;
type ReadChip = 'ALL' | 'UNREAD';
type Row = { kind: 'header'; group: DayGroup<NotificationItem> } | { kind: 'item'; item: NotificationItem };

const SEVERITY_ICON: Record<NotificationSeverity, { icon: LucideIcon; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  INFO: { icon: Info, tone: 'info' },
  SUCCESS: { icon: CircleCheck, tone: 'success' },
  WARNING: { icon: TriangleAlert, tone: 'warning' },
  ERROR: { icon: CircleX, tone: 'danger' },
  UNKNOWN: { icon: Bell, tone: 'neutral' },
};

export default function NotificationsScreen() {
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const locale = language === 'VI' ? 'vi' : 'en';
  const [category, setCategory] = React.useState<CategoryChip>('ALL');
  const [readFilter, setReadFilter] = React.useState<ReadChip>('ALL');
  const [refreshing, setRefreshing] = React.useState(false);
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  const sessionGeneration = useAuthStore((state) => state.sessionGeneration);
  const unreadOnly = readFilter === 'UNREAD';
  const notificationsQuery = useNotifications({
    locale,
    category: category === 'ALL' ? null : category,
    unreadOnly,
  });
  const unread = useNotificationUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const targetNavigator = useNotificationTargetNavigator();
  const notifications = notificationsQuery.data;
  const updating = markRead.isPending || markAllRead.isPending;
  const filtered = category !== 'ALL' || unreadOnly;

  const categoryOptions: ChipOption<CategoryChip>[] = [
    { value: 'ALL', label: t('notif.category.all') },
    { value: 'WORKFLOW', label: t('notif.category.workflow') },
    { value: 'WORKSPACE', label: t('notif.category.workspace') },
    { value: 'CONNECTION', label: t('notif.category.connection') },
    { value: 'SECURITY', label: t('notif.category.security') },
  ];
  const readOptions: ChipOption<ReadChip>[] = [
    { value: 'ALL', label: t('ntf.show.all') },
    { value: 'UNREAD', label: t('ntf.show.unread') },
  ];

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groupByDay(notifications ?? [], (n) => n.occurredAt)) {
      out.push({ kind: 'header', group });
      for (const item of group.items) out.push({ kind: 'item', item });
    }
    return out;
  }, [notifications]);

  const onRefresh = async () => {
    if (updating || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([notificationsQuery.refetch(), unread.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const currentScope = () => {
    const scope = captureAuthSessionScope();
    return scope?.generation === sessionGeneration ? scope : null;
  };

  /** Tap: mark as read, then follow the target (EXECUTION via the lookup resolver; NONE stays here). */
  const handleOpen = async (item: NotificationItem) => {
    if (updating || openingId) return;
    const scope = currentScope();
    if (!scope) return;
    setOpeningId(item.id);
    try {
      let current = item;
      if (!item.readAt) current = await markRead.mutateAsync({ id: item.id, locale, scope });
      if (!isAuthSessionScopeCurrent(scope)) return;
      if (getSafeNotificationRoute(current.target) !== null && current.eventType !== 'workspace.member_removed') {
        await targetNavigator.navigate(current, scope);
      }
    } catch {
      // markRead.isError renders the retry banner; a failed navigation never falls back to a URL.
    } finally {
      setOpeningId(null);
    }
  };

  const handleMarkAll = () => {
    if (updating) return;
    const scope = currentScope();
    if (!scope) return;
    markRead.reset();
    markAllRead.reset();
    markAllRead.mutate(scope);
  };

  const retryUpdate = () => {
    if (updating) return;
    if (markRead.isError && markRead.variables) markRead.mutate(markRead.variables);
    else if (markAllRead.isError && markAllRead.variables) markAllRead.mutate(markAllRead.variables);
    else void onRefresh();
  };

  const unreadCount = unread.data;
  const updateFailed = markRead.isError || markAllRead.isError;

  const renderRow = ({ item: row }: { item: Row }) => {
    if (row.kind === 'header') {
      const { bucket, date } = row.group;
      const label =
        bucket === 'today' ? t('ntf.today') : bucket === 'yesterday' ? t('ntf.yesterday') : format(date, 'dd/MM/yyyy');
      return (
        <Text accessibilityRole="header" style={[Typography.section, styles.dayHeader, { color: colors.textSubtle }]}>
          {label}
        </Text>
      );
    }
    const item = row.item;
    const isRead = item.readAt !== null;
    const canOpen = getSafeNotificationRoute(item.target) !== null && item.eventType !== 'workspace.member_removed';
    const sev = SEVERITY_ICON[item.severity] ?? SEVERITY_ICON.UNKNOWN;
    const tone = colors.tones[sev.tone];
    const Icon = sev.icon;
    const busy = openingId === item.id;
    return (
      <Pressable
        testID={`notification-item-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${isRead ? '' : `${t('ntf.unreadMark')}. `}${item.title}. ${item.message}`}
        accessibilityHint={t(canOpen ? 'ntf.hint.open' : isRead ? 'ntf.hint.none' : 'ntf.hint.markRead')}
        disabled={updating || openingId !== null}
        onPress={() => void handleOpen(item)}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: pressed ? colors.cardSecondary : colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Icon size={18} color={tone.fg} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {!isRead ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
            <Text style={[Typography.body, styles.title, { color: colors.text, fontWeight: isRead ? '400' : '600' }]}>{item.title}</Text>
          </View>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>{item.message}</Text>
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>
            {formatRelativeTime(item.occurredAt, language)}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : canOpen ? (
          <ChevronRight size={18} color={colors.textSubtle} />
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title={t('notif.title')}
        subtitle={unreadCount !== undefined ? `${unreadCount} ${t('notif.unread')}` : undefined}
        trailing={
          <Pressable
            testID="notification-mark-all-read"
            accessibilityRole="button"
            accessibilityLabel={t('notif.mark_all_read')}
            accessibilityState={{ disabled: updating || unreadCount === 0 }}
            disabled={updating || unreadCount === 0 || notificationsQuery.isLoading}
            onPress={handleMarkAll}
            style={[styles.markAll, { opacity: updating || unreadCount === 0 ? 0.45 : 1 }]}
          >
            {markAllRead.isPending ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <CheckCheck size={20} color={colors.primary} />
            )}
          </Pressable>
        }
      />
      <View style={styles.filters}>
        <FilterChips options={categoryOptions} value={category} onChange={(v) => setCategory(v)} accessibilityLabel={t('notif.category')} />
        <FilterChips options={readOptions} value={readFilter} onChange={(v) => setReadFilter(v)} accessibilityLabel={t('ntf.show.label')} />
      </View>

      {updateFailed ? (
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.dangerBg }]}>
          <Text style={[Typography.caption, styles.bannerText, { color: colors.danger }]}>{t('notif.update_error')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('ui.retry')} onPress={retryUpdate} style={styles.bannerBtn}>
            <Text style={[Typography.label, { color: colors.primary }]}>{t('ui.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {notificationsQuery.isPending ? (
        <ListSkeleton rows={5} />
      ) : notificationsQuery.isError && rows.length === 0 ? (
        <ErrorState error={notificationsQuery.error as unknown as ApiError} onRetry={() => void onRefresh()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => (row.kind === 'header' ? `h-${row.group.key}` : row.item.id)}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl enabled={!updating} refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon={<Bell size={32} color={colors.textSubtle} />}
              title={t(filtered ? 'ntf.empty.filteredTitle' : 'ntf.empty.title')}
              description={t(filtered ? 'ntf.empty.filteredDesc' : 'ntf.empty.desc')}
              actionLabel={filtered ? t('ui.clearFilters') : t('notif.refresh')}
              onAction={
                filtered
                  ? () => {
                      setCategory('ALL');
                      setReadFilter('ALL');
                    }
                  : () => void onRefresh()
              }
            />
          }
          ListFooterComponent={
            notificationsQuery.hasNextPage ? (
              <View style={styles.footer}>
                {notificationsQuery.isFetchNextPageError ? (
                  <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>
                    {t('notif.error')}
                  </Text>
                ) : null}
                {notificationsQuery.isFetchingNextPage ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Pressable
                    testID="notifications-load-more"
                    accessibilityRole="button"
                    accessibilityLabel={t(notificationsQuery.isFetchNextPageError ? 'ui.retry' : 'ui.loadMore')}
                    disabled={notificationsQuery.isFetching || updating}
                    onPress={() => void notificationsQuery.fetchNextPage()}
                    style={[styles.moreBtn, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}
                  >
                    <Text style={[Typography.label, { color: colors.text }]}>
                      {t(notificationsQuery.isFetchNextPageError ? 'ui.retry' : 'ui.loadMore')}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  filters: { paddingVertical: Spacing.one },
  markAll: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginHorizontal: Spacing.three, marginBottom: Spacing.two, paddingLeft: Spacing.three, borderRadius: Radius.md },
  bannerText: { flex: 1 },
  bannerBtn: { minHeight: MinTouch, paddingHorizontal: Spacing.three, justifyContent: 'center' },
  list: { paddingBottom: Spacing.five },
  dayHeader: { textTransform: 'uppercase', paddingHorizontal: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch, paddingVertical: 14, paddingHorizontal: Spacing.three, borderBottomWidth: 1 },
  body: { flex: 1, gap: Spacing.half },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1 },
  footer: { alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  moreBtn: { minHeight: MinTouch, paddingHorizontal: Spacing.four, justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1 },
});
