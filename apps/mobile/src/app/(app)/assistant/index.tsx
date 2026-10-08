import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MessageCircle, Plus, Trash2 } from 'lucide-react-native';
import { useConversations, useDeleteConversation } from '../../../features/assistant/hooks/useAssistant';
import { QuickQuestions } from '../../../features/assistant/components/QuickQuestions';
import { fill } from '../../../features/common/fill';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { formatRelativeTime } from '../../../features/common/time';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListItem } from '../../../components/ui/ListItem';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { MinTouch, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { AssistantConversation } from '../../../domain/assistant/assistant.types';

export default function AssistantListScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const query = useConversations();
  const remove = useDeleteConversation();
  const showToast = useUIStore((s) => s.showToast);
  const [toDelete, setToDelete] = useState<AssistantConversation | null>(null);

  const items = query.data ?? [];
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));
  const startChat = (q?: string) =>
    router.push(q ? { pathname: '/(app)/assistant/chat', params: { q } } : '/(app)/assistant/chat');
  const titleOf = (c: AssistantConversation) => c.title.trim() || t('asst.untitled');

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.conversationId);
    } catch (e) {
      showToast({ type: 'error', title: t('asst.delete.fail'), message: friendlyErrorMessage(e) });
    } finally {
      setToDelete(null);
    }
  };

  let body: React.ReactNode;
  if (!activeWorkspaceId) {
    body = <EmptyState title={t('asst.noWorkspace')} />;
  } else if (query.isPending) {
    body = <ListSkeleton rows={5} />;
  } else if (query.isError && items.length === 0) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else if (items.length === 0) {
    body = (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon={<MessageCircle size={36} color={colors.textMuted} />}
          title={t('asst.empty.title')}
          description={t('asst.empty.body')}
          actionLabel={t('asst.empty.action')}
          onAction={() => startChat()}
        />
        <View style={styles.chips}>
          <QuickQuestions onPick={startChat} />
        </View>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(c) => c.conversationId}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Button label={t('asst.new')} icon={<Plus size={18} color={colors.onPrimary} />} onPress={() => startChat()} />
            <QuickQuestions onPick={startChat} />
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
              {t('asst.list.title')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <View style={styles.itemMain}>
              <ListItem
                leading={<MessageCircle size={20} color={colors.primary} />}
                title={titleOf(item)}
                meta={fill(t('asst.item.updated'), { time: formatRelativeTime(item.updatedAt, language) })}
                accessibilityHint={t('asst.item.hint')}
                onPress={() => router.push({ pathname: '/(app)/assistant/chat', params: { conversationId: item.conversationId } })}
              />
            </View>
            {/* A sibling of the row (not a child): a button inside a button is invalid on web. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('asst.delete')}: ${titleOf(item)}`}
              onPress={() => setToDelete(item)}
              style={styles.trash}
            >
              <Trash2 size={20} color={colors.danger} />
            </Pressable>
          </View>
        )}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('asst.title')} onBack={back} />
      {body}
      <ConfirmSheet
        visible={toDelete !== null}
        title={t('asst.delete.title')}
        message={fill(t('asst.delete.body'), { title: toDelete ? titleOf(toDelete) : '' })}
        confirmLabel={t('asst.delete')}
        destructive
        busy={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setToDelete(null)}
      />
    </SafeAreaView>
  );
}

const Separator = () => <View style={{ height: Spacing.two }} />;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.three, paddingBottom: Spacing.three },
  emptyWrap: { flex: 1 },
  chips: { paddingHorizontal: Spacing.three },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  itemMain: { flex: 1 },
  trash: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
});
