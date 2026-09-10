import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, RefreshControl, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, Play, Pause, ExternalLink, X, Sparkles } from 'lucide-react-native';
import { useWorkflows, usePauseWorkflow, useResumeWorkflow } from '../../../features/workflows/hooks/useWorkflows';
import { useRunWorkflow } from '../../../features/workflows/hooks/useRunWorkflow';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import type { Workflow } from '../../../domain/workflow/workflow.types';

export default function WorkflowsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { data: workflows, isLoading, refetch } = useWorkflows();

  const pauseMutation = usePauseWorkflow();
  const resumeMutation = useResumeWorkflow();
  const runMutation = useRunWorkflow();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PUBLISHED' | 'PAUSED' | 'DRAFT'>('ALL');
  const [refreshing, setRefreshing] = useState(false);

  const [selectedWfToRun, setSelectedWfToRun] = useState<Workflow | null>(null);
  const [payloadInput, setPayloadInput] = useState('');

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const filtered = (workflows || []).filter((w) => {
    const matchesSearch = w.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filter === 'ALL' || w.status === filter;
    return matchesSearch && matchesStatus;
  });

  const handleConfirmRun = async () => {
    if (!selectedWfToRun) return;
    let input: Record<string, unknown> | undefined;
    if (payloadInput.trim()) {
      try {
        input = JSON.parse(payloadInput);
      } catch (e) {
        input = { rawPayload: payloadInput };
      }
    }
    const res = await runMutation.mutateAsync({ id: selectedWfToRun.id, input });
    setSelectedWfToRun(null);
    setPayloadInput('');
    if (res?.executionId) {
      router.push(`/(app)/executions/${res.executionId}`);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{t('workflows.title')}</Text>
        <Pressable style={styles.aiButton} onPress={() => router.push('/(app)/ai/generator')}>
          <Sparkles color="#ffffff" size={14} />
          <Text style={styles.aiButtonText}>AI Generator</Text>
        </Pressable>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Search color={colors.textSubtle} size={16} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={t('workflows.search_placeholder')}
          placeholderTextColor={colors.textSubtle}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')}>
            <X color={colors.textSubtle} size={16} />
          </Pressable>
        ) : null}
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {(['ALL', 'PUBLISHED', 'PAUSED', 'DRAFT'] as const).map((tab) => (
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

      {/* Workflows List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push(`/(app)/workflows/${item.id}`)}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardInfo}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.cardMeta, { color: colors.textSubtle }]}>{item.triggerType} • v{item.version}</Text>
              </View>
              <StatusBadge status={item.status} />
            </View>

            {item.description ? (
              <Text style={[styles.cardDesc, { color: colors.textMuted }]} numberOfLines={2}>{item.description}</Text>
            ) : null}

            {item.status === 'DRAFT' && (
              <View style={[styles.draftHint, { backgroundColor: colors.cardSecondary }]}>
                <Text style={[styles.draftHintText, { color: colors.textMuted }]}>{t('workflows.draft_hint')}</Text>
              </View>
            )}

            <View style={styles.cardActions}>
              {item.status === 'PUBLISHED' && (
                <>
                  <Pressable
                    style={[styles.actionBtn, styles.runBtn]}
                    onPress={() => setSelectedWfToRun(item)}
                  >
                    <Play color="#ffffff" size={13} />
                    <Text style={styles.runBtnText}>{t('workflows.run_now')}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: colors.cardSecondary }]}
                    onPress={() => pauseMutation.mutate(item.id)}
                  >
                    <Pause color={colors.warning} size={13} />
                    <Text style={[styles.actionBtnText, { color: colors.warning }]}>{t('workflows.pause')}</Text>
                  </Pressable>
                </>
              )}

              {item.status === 'PAUSED' && (
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: colors.successBg, borderColor: colors.success, borderWidth: 1 }]}
                  onPress={() => resumeMutation.mutate(item.id)}
                >
                  <Play color={colors.success} size={13} />
                  <Text style={[styles.resumeBtnText, { color: colors.success }]}>{t('workflows.resume')}</Text>
                </Pressable>
              )}

              <Pressable
                style={[styles.actionBtn, { backgroundColor: colors.cardSecondary }]}
                onPress={() => router.push(`/(app)/workflows/${item.id}`)}
              >
                <ExternalLink color={colors.primary} size={13} />
                <Text style={[styles.actionBtnText, { color: colors.primary }]}>{t('workflows.view')}</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />

      {/* Run Workflow Modal */}
      <Modal visible={!!selectedWfToRun} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Run Workflow</Text>
              <Pressable onPress={() => setSelectedWfToRun(null)}>
                <X color={colors.textMuted} size={20} />
              </Pressable>
            </View>

            {selectedWfToRun && (
              <View style={styles.modalBody}>
                <Text style={[styles.modalWfName, { color: colors.primary }]}>{selectedWfToRun.name}</Text>
                <Text style={[styles.modalLabel, { color: colors.textMuted }]}>Trigger: {selectedWfToRun.triggerType}</Text>

                <Text style={[styles.modalLabel, { color: colors.textMuted, marginTop: 12 }]}>Input Payload (Optional JSON):</Text>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong, color: colors.text }]}
                  multiline
                  numberOfLines={4}
                  placeholder={`{\n  "orderId": "ORD-991",\n  "amount": 500000\n}`}
                  placeholderTextColor={colors.textSubtle}
                  value={payloadInput}
                  onChangeText={setPayloadInput}
                />

                <View style={styles.modalButtons}>
                  <Pressable style={[styles.cancelBtn, { backgroundColor: colors.cardSecondary }]} onPress={() => setSelectedWfToRun(null)}>
                    <Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.confirmRunBtn} onPress={handleConfirmRun}>
                    <Text style={styles.confirmRunText}>Execute Workflow</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '900' },
  aiButton: { backgroundColor: '#7c3aed', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  searchBar: { marginHorizontal: 18, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 13 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginBottom: 14 },
  filterChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6 },
  filterText: { fontSize: 11, fontWeight: '700' },
  listContent: { paddingHorizontal: 18, paddingBottom: 40, gap: 12 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardInfo: { flex: 1, marginRight: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardMeta: { fontSize: 11, marginTop: 2 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
  draftHint: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  draftHintText: { fontSize: 11, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  actionBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
  runBtn: { backgroundColor: '#7c3aed' },
  runBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  resumeBtnText: { fontSize: 12, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, gap: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalBody: { gap: 10 },
  modalWfName: { fontSize: 15, fontWeight: '700' },
  modalLabel: { fontSize: 12 },
  modalInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: 'monospace', fontSize: 12, textAlignVertical: 'top' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 13, fontWeight: '700' },
  confirmRunBtn: { flex: 2, backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmRunText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
