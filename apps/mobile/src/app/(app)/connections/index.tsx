import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, Mail, FileSpreadsheet, Send, Globe } from 'lucide-react-native';
import { useConnections, useTestConnection } from '../../../features/connections/hooks/useConnections';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useUIStore } from '../../../stores/ui.store';
import { useThemeColors } from '../../../hooks/useThemeColors';
import type { ConnectionProvider } from '../../../domain/connection/connection.types';

export default function ConnectionsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { data: connections, isLoading, refetch } = useConnections();
  const testMutation = useTestConnection();
  const showToast = useUIStore((s) => s.showToast);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleTest = async (id: string, name: string) => {
    setTestingId(id);
    try {
      const res = await testMutation.mutateAsync(id);
      if (res.success) {
        showToast({ type: 'success', title: 'Ping Test Successful ⚡', message: res.message });
      } else {
        showToast({ type: 'warning', title: 'Connection Warning', message: res.message });
      }
    } catch (err: any) {
      showToast({ type: 'error', title: 'Ping Test Failed', message: err.message || 'Could not test connection.' });
    } finally {
      setTestingId(null);
    }
  };

  const getProviderIcon = (provider: ConnectionProvider) => {
    switch (provider) {
      case 'gmail':
        return <Mail color="#f43f5e" size={20} />;
      case 'sheets':
        return <FileSpreadsheet color="#10b981" size={20} />;
      case 'telegram':
        return <Send color="#0ea5e9" size={20} />;
      case 'http':
        return <Globe color={colors.primary} size={20} />;
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Service Connections</Text>
      </View>

      <FlatList
        data={connections || []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardTop}>
              <View style={[styles.iconCircle, { backgroundColor: colors.cardSecondary }]}>
                {getProviderIcon(item.provider)}
              </View>
              <View style={styles.cardInfo}>
                <Text style={[styles.connName, { color: colors.text }]}>{item.name}</Text>
                <Text style={[styles.connProvider, { color: colors.textSubtle }]}>{item.provider.toUpperCase()} Credential</Text>
              </View>
              <StatusBadge status={item.status} />
            </View>

            <View style={[styles.cardMeta, { borderTopColor: colors.border }]}>
              <Text style={[styles.metaText, { color: colors.textMuted }]}>Created by: {item.createdBy}</Text>
              <Text style={[styles.metaText, { color: colors.textMuted }]}>Created: {new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>

            <View style={styles.cardFooter}>
              <Pressable
                style={[styles.testBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}
                onPress={() => handleTest(item.id, item.name)}
                disabled={testingId === item.id}
              >
                <RefreshCw color={colors.text} size={13} />
                <Text style={[styles.testBtnText, { color: colors.text }]}>
                  {testingId === item.id ? 'Pinging...' : 'Test Connection'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 10 },
  listContent: { padding: 18, paddingBottom: 40, gap: 12 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cardInfo: { flex: 1 },
  connName: { fontSize: 15, fontWeight: '800' },
  connProvider: { fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  cardMeta: { paddingTop: 8, borderTopWidth: 1, gap: 2 },
  metaText: { fontSize: 11 },
  cardFooter: { paddingTop: 4 },
  testBtn: { borderRadius: 10, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderWidth: 1 },
  testBtnText: { fontSize: 12, fontWeight: '700' },
});
