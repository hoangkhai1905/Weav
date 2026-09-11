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
import { useRouter } from 'expo-router';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react-native';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationUnreadCount,
} from '../../../features/notifications/hooks/useNotifications';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';

export default function NotificationsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const {
    data: notifications = [],
    isLoading,
    isError,
    isFetching,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useNotifications();
  const unread = useNotificationUnreadCount();

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const updating = markRead.isPending || markAllRead.isPending;

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    if (updating || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refetch(), unread.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const retryUpdate = () => {
    if (updating) return;
    if (markRead.isError && markRead.variables)
      markRead.mutate(markRead.variables);
    else markAllRead.mutate();
  };

  const handleTapNotif = (id: string, read: boolean, link?: string) => {
    if (markRead.isPending || markAllRead.isPending) return;
    const navigate = () => {
      if (link?.startsWith('/(app)/'))
        router.push(link as Parameters<typeof router.push>[0]);
    };
    if (!read) {
      markAllRead.reset();
      markRead.mutate(id, { onSuccess: navigate });
    } else {
      navigate();
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.text }]}>
            {t('notif.title')}
          </Text>
          {unread.data !== undefined && (
            <Text style={{ color: colors.textMuted }}>
              {unread.data} {t('notif.unread')}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notif.refresh')}
          disabled={isFetching || refreshing || updating}
          onPress={() => void onRefresh()}
          style={styles.refreshBtn}
        >
          <RefreshCw color={colors.primary} size={18} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={[
            styles.markAllBtn,
            (updating || unread.data === 0 || isLoading) && styles.disabled,
          ]}
          disabled={updating || unread.data === 0 || isLoading}
          onPress={() => {
            markRead.reset();
            markAllRead.mutate();
          }}
        >
          {markAllRead.isPending ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <CheckCheck color={colors.primary} size={16} />
          )}
          <Text style={[styles.markAllText, { color: colors.primary }]}>
            {t('notif.mark_all_read')}
          </Text>
        </Pressable>
      </View>

      {((isError && !isFetchNextPageError) ||
        unread.isError ||
        markRead.isError ||
        markAllRead.isError) && (
        <View
          accessibilityRole="alert"
          style={[styles.feedback, { backgroundColor: colors.dangerBg }]}
        >
          <Text style={{ color: colors.danger }}>
            {t(
              markRead.isError || markAllRead.isError
                ? 'notif.update_error'
                : isError
                  ? 'notif.error'
                  : 'notif.count_error',
            )}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={updating || refreshing}
            onPress={
              markRead.isError || markAllRead.isError
                ? retryUpdate
                : () => void onRefresh()
            }
          >
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
            {isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              !isError && <Bell size={32} color={colors.textSubtle} />
            )}
            {!isError && (
              <Text style={{ color: colors.textMuted }}>
                {t(isLoading ? 'notif.loading' : 'notif.empty')}
              </Text>
            )}
          </View>
        }
        ListFooterComponent={
          hasNextPage ? (
            <View style={styles.empty}>
              {isFetchNextPageError && (
                <Text
                  accessibilityRole="alert"
                  style={{ color: colors.danger }}
                >
                  {t('notif.error')}
                </Text>
              )}
              {isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={isFetching || updating}
                  onPress={() => void fetchNextPage()}
                  style={styles.refreshBtn}
                >
                  <Text style={{ color: colors.primary }}>
                    {t(isFetchNextPageError ? 'notif.retry' : 'notif.more')}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${t(item.read ? 'notif.read' : 'notif.mark_read')}`}
            disabled={markRead.isPending || markAllRead.isPending}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
              !item.read && {
                borderColor: colors.primaryBorder,
                backgroundColor: colors.primaryBg,
              },
            ]}
            onPress={() => handleTapNotif(item.id, item.read, item.link)}
          >
            <View style={styles.cardHeader}>
              <View style={styles.titleRow}>
                {!item.read && (
                  <View
                    style={[
                      styles.unreadDot,
                      { backgroundColor: colors.primary },
                    ]}
                  />
                )}
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {item.title}
                </Text>
              </View>
              <Text style={[styles.cardTime, { color: colors.textSubtle }]}>
                {Number.isNaN(Date.parse(item.timestamp))
                  ? item.timestamp
                  : new Date(item.timestamp).toLocaleString(
                      language === 'VI' ? 'vi-VN' : 'en-US',
                    )}
              </Text>
            </View>
            <Text style={[styles.cardMessage, { color: colors.textMuted }]}>
              {item.message}
            </Text>
            {markRead.isPending && markRead.variables === item.id && (
              <ActivityIndicator color={colors.primary} size="small" />
            )}
            {item.read && (
              <Text style={{ color: colors.textSubtle, fontSize: 10 }}>
                {t('notif.read')}
              </Text>
            )}
            {item.status && (
              <Text
                style={{
                  color:
                    item.status === 'FAILED'
                      ? colors.danger
                      : colors.textSubtle,
                  fontSize: 10,
                }}
              >
                {t(`notif.${item.status.toLowerCase()}`)}
              </Text>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  heading: { flex: 1, gap: 4 },
  actions: { paddingHorizontal: 18, paddingBottom: 14, alignItems: 'flex-end' },
  refreshBtn: { padding: 12 },
  disabled: { opacity: 0.45 },
  feedback: {
    marginHorizontal: 18,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  empty: { padding: 24, alignItems: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  title: { fontSize: 24, fontWeight: '900' },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markAllText: { fontSize: 12, fontWeight: '700' },
  listContent: { paddingHorizontal: 18, paddingBottom: 40, gap: 10 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { fontSize: 14, fontWeight: '800', flex: 1 },
  cardTime: { fontSize: 10 },
  cardMessage: { fontSize: 12, lineHeight: 16 },
});
