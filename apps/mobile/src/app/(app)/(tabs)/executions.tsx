import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Clock, ChevronRight } from 'lucide-react-native';
import { useExecutions } from '../../../features/executions/hooks/useExecutions';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';

export default function ExecutionsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { data: executions, isLoading, refetch } = useExecutions();

  const [filter, setFilter] = useState<'ALL' | 'RUNNING' | 'SUCCESS' | 'FAILED'>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const filtered = (executions || []).filter((e) => {
    if (filter === 'ALL') return true;
    if (filter === 'RUNNING') return e.status === 'RUNNING' || e.status === 'QUEUED';
    return e.status === filter;
  });

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{t('executions.title')}</Text>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {(['ALL', 'RUNNING', 'SUCCESS', 'FAILED'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.filterChip,
              { backgroundColor: colors.card, borderColor: colors.border },
              filter === tab && { backgroundColor: colors.primaryBg, borderColor: colors.primary },
            ]}
            onPress={() => setFilter(tab)}
          >
            <Text
              style={[
                styles.filterText,
                { color: colors.textSubtle },
                filter === tab && { color: colors.primary },
              ]}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Execution Cards List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/(app)/executions/${item.id}`)}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardInfo}>
                <Text style={[styles.wfName, { color: colors.text }]} numberOfLines={1}>{item.workflowName}</Text>
                <Text style={[styles.execId, { color: colors.textSubtle }]}>{item.id} • {item.triggerType}</Text>
              </View>
              <StatusBadge status={item.status} />
            </View>

            <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
              <View style={styles.metaItem}>
                <Clock color={colors.textSubtle} size={13} />
                <Text style={[styles.metaText, { color: colors.textMuted }]}>
                  {item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : 'Processing...'}
                </Text>
              </View>
              <View style={styles.detailLink}>
                <Text style={[styles.linkText, { color: colors.primary }]}>{t('executions.view_details')}</Text>
                <ChevronRight color={colors.primary} size={14} />
              </View>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '900' },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginBottom: 14 },
  filterChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  filterText: { fontSize: 11, fontWeight: '700' },
  listContent: { paddingHorizontal: 18, paddingBottom: 40, gap: 12 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1, marginRight: 10 },
  wfName: { fontSize: 15, fontWeight: '800' },
  execId: { fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11 },
  detailLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkText: { fontSize: 11, fontWeight: '700' },
});
