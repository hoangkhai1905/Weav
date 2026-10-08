import React from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Info, PlugZap } from 'lucide-react-native';
import { useConnections, useDisableConnection, useTestConnection } from '../../../features/connections/hooks/useConnections';
import { ConnectionCard, type TestResult } from '../../../features/connections/components/ConnectionCard';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../../features/auth/auth-session.scope';
import type { ConnectionItem } from '../../../domain/connection/connection.types';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import type { ApiError } from '../../../domain/common/error.types';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';

export default function ConnectionsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const query = useConnections();
  const testMutation = useTestConnection();
  const disableMutation = useDisableConnection();
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, TestResult>>({});
  const [toDisable, setToDisable] = React.useState<ConnectionItem | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const handleTest = async (item: ConnectionItem) => {
    if (testingId) return;
    const scope = captureAuthSessionScope();
    setTestingId(item.id);
    try {
      const outcome = await testMutation.mutateAsync(item.id);
      if (isAuthSessionScopeCurrent(scope)) setResults((r) => ({ ...r, [item.id]: { outcome } }));
    } catch (error) {
      if (isAuthSessionScopeCurrent(scope)) {
        setResults((r) => ({ ...r, [item.id]: { error: friendlyErrorMessage(error) } }));
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleDisable = async () => {
    const item = toDisable;
    if (!item) return;
    try {
      await disableMutation.mutateAsync(item.id);
      showToast({ type: 'success', title: t('conn.disabled').replace('{name}', item.name) });
    } catch (error) {
      showToast({ type: 'error', title: t('conn.disableFailed'), message: friendlyErrorMessage(error) });
    } finally {
      setToDisable(null);
    }
  };

  const connections = query.data ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('conn.title')} onBack={goBack} />
      {query.isPending ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={connections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={[styles.note, { backgroundColor: colors.cardSecondary, borderColor: colors.border }]}>
              <Info size={16} color={colors.textMuted} />
              <Text style={[Typography.caption, styles.noteText, { color: colors.textMuted }]}>{t('conn.webNote')}</Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon={<PlugZap size={32} color={colors.textSubtle} />}
              title={t('conn.empty.title')}
              description={t('conn.empty.desc')}
              actionLabel={t('ui.retry')}
              onAction={() => void query.refetch()}
            />
          }
          renderItem={({ item }) => (
            <ConnectionCard
              item={item}
              testing={testingId === item.id}
              result={results[item.id]}
              onTest={() => void handleTest(item)}
              onDisable={() => setToDisable(item)}
            />
          )}
        />
      )}
      <ConfirmSheet
        visible={toDisable !== null}
        title={t('conn.disable.title')}
        message={t('conn.disable.message').replace('{name}', toDisable?.name ?? '')}
        confirmLabel={t('conn.disable')}
        destructive
        busy={disableMutation.isPending}
        onConfirm={() => void handleDisable()}
        onClose={() => setToDisable(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.five },
  note: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md, marginBottom: Spacing.one },
  noteText: { flex: 1 },
});
