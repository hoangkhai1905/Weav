import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, CheckCheck, RefreshCw, ExternalLink } from 'lucide-react-native';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationUnreadCount,
} from '../../../features/notifications/hooks/useNotifications';
import { useNotificationTargetNavigator } from '../../../features/notifications/hooks/useNotificationTargetNavigator';
import { getSafeNotificationRoute } from '../../../features/notifications/notification.target';
import { useAuthStore } from '../../../stores/auth.store';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../../features/auth/auth-session.scope';
import type { NotificationCategoryFilter } from '../../../domain/notification/notification.types';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';

const CATEGORIES: Array<NotificationCategoryFilter | null> = [
  null,
  'WORKFLOW',
  'WORKSPACE',
  'CONNECTION',
  'SECURITY',
];

export default function NotificationsScreen() {
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const locale = language === 'VI' ? 'vi' : 'en';
  const [category, setCategory] = React.useState<NotificationCategoryFilter | null>(null);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  const sessionGeneration = useAuthStore((state) => state.sessionGeneration);
  const notificationsQuery = useNotifications({ locale, category, unreadOnly });
  const unread = useNotificationUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const targetNavigator = useNotificationTargetNavigator();
  const notifications = notificationsQuery.data ?? [];
  const updating = markRead.isPending || markAllRead.isPending;

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

  const handleMarkRead = async (id: string) => {
    if (updating) return;
    const scope = currentScope();
    if (!scope) return;
    try {
      await markRead.mutateAsync({ id, locale, scope });
    } catch {
      // The mutation state renders the localized retry message in the inbox.
    }
  };

  const handleOpen = async (item: (typeof notifications)[number]) => {
    if (updating || openingId) return;
    const scope = currentScope();
    if (!scope) return;
    setOpeningId(item.id);
    try {
      let currentItem = item;
      if (!item.readAt) {
        currentItem = await markRead.mutateAsync({ id: item.id, locale, scope });
      }
      if (!isAuthSessionScopeCurrent(scope)) return;
      await targetNavigator.navigate(currentItem, scope);
    } catch {
      // The mutation state renders read failures; navigation failures never fall back to a URL.
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
    if (markRead.isError && markRead.variables)
      markRead.mutate(markRead.variables);
    else if (markAllRead.isError && markAllRead.variables)
      markAllRead.mutate(markAllRead.variables);
    else void onRefresh();
  };

  const hasMainError =
    notificationsQuery.isError || unread.isError || markRead.isError || markAllRead.isError;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.text }]}>{t('notif.title')}</Text>
          {unread.data !== undefined && (
            <Text accessibilityLabel={`${unread.data} ${t('notif.unread')}`} style={{ color: colors.textMuted }}>
              {unread.data} {t('notif.unread')}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notif.refresh')}
          testID="notifications-refresh"
          disabled={notificationsQuery.isFetching || refreshing || updating}
          onPress={() => void onRefresh()}
          style={styles.refreshBtn}
        >
          <RefreshCw color={colors.primary} size={18} />
        </Pressable>
      </View>

      <View style={styles.filterBlock}>
        <Text style={[styles.filterLabel, { color: colors.textSubtle }]}>{t('notif.category')}</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
          data={CATEGORIES}
          keyExtractor={(item) => item ?? 'all'}
          renderItem={({ item }) => {
            const selected = item === category;
            const label = t(item ? `notif.category.${item.toLowerCase()}` : 'notif.category.all');
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`notification-category-${item?.toLowerCase() ?? 'all'}`}
                onPress={() => setCategory(item)}
                style={[
                  styles.categoryChip,
                  { borderColor: selected ? colors.primary : colors.border },
                  selected && { backgroundColor: colors.primaryBg },
                ]}
              >
                <Text style={{ color: selected ? colors.primary : colors.textMuted }}>{label}</Text>
              </Pressable>
            );
          }}
        />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: unreadOnly }}
            testID="notification-unread-filter"
            style={[styles.filterButton, { borderColor: unreadOnly ? colors.primary : colors.border }]}
            onPress={() => setUnreadOnly((value) => !value)}
          >
            <Text style={{ color: unreadOnly ? colors.primary : colors.textMuted }}>{t('notif.unread_only')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notif.mark_all_read')}
            testID="notification-mark-all-read"
            style={[
              styles.markAllBtn,
              { borderColor: colors.border },
              (updating || unread.data === 0 || notificationsQuery.isLoading) && styles.disabled,
            ]}
            disabled={updating || unread.data === 0 || notificationsQuery.isLoading}
            onPress={handleMarkAll}
          >
            {markAllRead.isPending ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <CheckCheck color={colors.primary} size={16} />
            )}
            <Text style={[styles.markAllText, { color: colors.primary }]}>{t('notif.mark_all_read')}</Text>
          </Pressable>
        </View>
      </View>

      {hasMainError && (
        <View accessibilityRole="alert" style={[styles.feedback, { backgroundColor: colors.dangerBg }]}>
          <Text style={{ color: colors.danger }}>
            {markRead.isError || markAllRead.isError
              ? t('notif.update_error')
              : notificationsQuery.isError
                ? t('notif.error')
                : t('notif.count_error')}
          </Text>
          <Pressable accessibilityRole="button" disabled={updating || refreshing} onPress={retryUpdate}>
            <Text style={{ color: colors.primary }}>{t('notif.retry')}</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            enabled={!updating}
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {notificationsQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              !notificationsQuery.isError && <Bell size={32} color={colors.textSubtle} />
            )}
            {!notificationsQuery.isError && (
              <Text style={{ color: colors.textMuted }}>
                {t(notificationsQuery.isLoading ? 'notif.loading' : 'notif.empty')}
              </Text>
            )}
          </View>
        }
        ListFooterComponent={
          notificationsQuery.hasNextPage ? (
            <View style={styles.empty}>
              {notificationsQuery.isFetchNextPageError && (
                <Text accessibilityRole="alert" style={{ color: colors.danger }}>{t('notif.error')}</Text>
              )}
              {notificationsQuery.isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  testID="notifications-load-more"
                  disabled={notificationsQuery.isFetching || updating}
                  onPress={() => void notificationsQuery.fetchNextPage()}
                  style={styles.refreshBtn}
                >
                  <Text style={{ color: colors.primary }}>
                    {t(notificationsQuery.isFetchNextPageError ? 'notif.retry' : 'notif.more')}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isRead = item.readAt !== null;
          const canOpen = getSafeNotificationRoute(item.target) !== null && item.eventType !== 'workspace.member_removed';
          return (
            <View
              testID={`notification-item-${item.id}`}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                !isRead && { borderColor: colors.primaryBorder, backgroundColor: colors.primaryBg },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  {!isRead && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                </View>
                <Text style={[styles.cardTime, { color: colors.textSubtle }]}>
                  {new Date(item.occurredAt).toLocaleString(language === 'VI' ? 'vi-VN' : 'en-US')}
                </Text>
              </View>
              <Text style={[styles.cardMessage, { color: colors.textMuted }]}>{item.message}</Text>
              <View style={styles.itemActions}>
                {!isRead && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('notif.mark_read')}: ${item.title}`}
                    testID={`notification-read-${item.id}`}
                    disabled={updating || openingId !== null}
                    onPress={() => void handleMarkRead(item.id)}
                    style={[styles.itemAction, { borderColor: colors.border }]}
                  >
                    {markRead.isPending && markRead.variables?.id === item.id ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Text style={{ color: colors.primary }}>{t('notif.mark_read')}</Text>
                    )}
                  </Pressable>
                )}
                {canOpen && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('notif.open')}: ${item.title}`}
                    testID={`notification-open-${item.id}`}
                    disabled={updating || openingId !== null}
                    onPress={() => void handleOpen(item)}
                    style={[styles.itemAction, { borderColor: colors.primary }]}
                  >
                    {openingId === item.id ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <>
                        <ExternalLink color={colors.primary} size={14} />
                        <Text style={{ color: colors.primary }}>{t('notif.open')}</Text>
                      </>
                    )}
                  </Pressable>
                )}
                {isRead && <Text style={{ color: colors.textSubtle, fontSize: 10 }}>{t('notif.read')}</Text>}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  heading: { flex: 1, gap: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  refreshBtn: { padding: 12 },
  disabled: { opacity: 0.45 },
  feedback: { marginHorizontal: 18, marginBottom: 12, padding: 12, borderRadius: 12, gap: 8 },
  empty: { padding: 24, alignItems: 'center', gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '900' },
  filterBlock: { gap: 8, paddingHorizontal: 18, paddingBottom: 10 },
  filterLabel: { fontSize: 11, fontWeight: '700' },
  categoryList: { gap: 8, paddingRight: 10 },
  categoryChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  filterButton: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  markAllText: { fontSize: 11, fontWeight: '700' },
  listContent: { paddingHorizontal: 18, paddingBottom: 40, gap: 10 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { fontSize: 14, fontWeight: '800', flex: 1 },
  cardTime: { fontSize: 10 },
  cardMessage: { fontSize: 12, lineHeight: 16 },
  itemActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, minHeight: 34 },
  itemAction: { minHeight: 34, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
});
