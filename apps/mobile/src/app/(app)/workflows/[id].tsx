import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Play, Pause, Layers, X } from 'lucide-react-native';
import { useWorkflowDetail } from '../../../features/workflows/hooks/useWorkflowDetail';
import { usePauseWorkflow, useResumeWorkflow } from '../../../features/workflows/hooks/useWorkflows';
import { useRunWorkflow } from '../../../features/workflows/hooks/useRunWorkflow';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';

export default function WorkflowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const { data: workflow, isLoading } = useWorkflowDetail(id || '');

  const pauseMutation = usePauseWorkflow();
  const resumeMutation = useResumeWorkflow();
  const runMutation = useRunWorkflow();

  const [showRunModal, setShowRunModal] = useState(false);
  const [payloadInput, setPayloadInput] = useState('');

  if (isLoading || !workflow) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const handleRunConfirm = async () => {
    let input: Record<string, unknown> | undefined;
    if (payloadInput.trim()) {
      try {
        input = JSON.parse(payloadInput);
      } catch (e) {
        input = { rawPayload: payloadInput };
      }
    }
    const res = await runMutation.mutateAsync({ id: workflow.id, input });
    setShowRunModal(false);
    setPayloadInput('');
    if (res?.executionId) {
      router.push(`/(app)/executions/${res.executionId}`);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)/workflows');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>Workflow Details</Text>
        <StatusBadge status={workflow.status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Main Info Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.wfName, { color: colors.text }]}>{workflow.name}</Text>
          <Text style={[styles.wfDesc, { color: colors.textMuted }]}>{workflow.description || 'No description provided.'}</Text>

          <View style={[styles.infoGrid, { borderTopColor: colors.border }]}>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Trigger Type</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{workflow.triggerType}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Version</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>v{workflow.version}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Owner</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{workflow.ownerName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Last Run</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {workflow.lastRunAt ? new Date(workflow.lastRunAt).toLocaleTimeString() : 'Never'}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Controls Card */}
        <View style={styles.actionsCard}>
          {workflow.status === 'PUBLISHED' && (
            <>
              <Pressable style={styles.runBtn} onPress={() => setShowRunModal(true)}>
                <Play color="#ffffff" size={16} />
                <Text style={styles.runBtnText}>Run Workflow Now</Text>
              </Pressable>
              <Pressable style={[styles.pauseBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]} onPress={() => pauseMutation.mutate(workflow.id)}>
                <Pause color={colors.warning} size={16} />
                <Text style={[styles.pauseBtnText, { color: colors.warning }]}>Pause Workflow</Text>
              </Pressable>
            </>
          )}

          {workflow.status === 'PAUSED' && (
            <Pressable style={[styles.resumeBtn, { backgroundColor: colors.successBg, borderColor: colors.success }]} onPress={() => resumeMutation.mutate(workflow.id)}>
              <Play color={colors.success} size={16} />
              <Text style={[styles.resumeBtnText, { color: colors.success }]}>Resume Workflow</Text>
            </Pressable>
          )}

          {workflow.status === 'DRAFT' && (
            <View style={[styles.draftBox, { backgroundColor: colors.cardSecondary }]}>
              <Text style={[styles.draftText, { color: colors.textMuted }]}>
                This workflow is currently a Draft. Full DAG node editing and publishing are available on the WEAV Web App.
              </Text>
            </View>
          )}
        </View>

        {/* Vertical Workflow Structure Representation */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Workflow Node Structure</Text>
        </View>

        <View style={[styles.nodesTimeline, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(workflow.nodes || [
            { id: 'n-1', name: 'Trigger Event', type: workflow.triggerType },
            { id: 'n-2', name: 'AI Action Processing', type: 'ai.extract' },
            { id: 'n-3', name: 'Service Output', type: 'sheets.append' },
          ]).map((node, index, arr) => (
            <View key={node.id} style={styles.nodeItem}>
              <View style={styles.nodeRow}>
                <View style={[styles.nodeBadge, { backgroundColor: colors.cardSecondary }]}>
                  <Layers color={colors.primary} size={16} />
                </View>
                <View style={styles.nodeMain}>
                  <Text style={[styles.nodeName, { color: colors.text }]}>{node.name}</Text>
                  <Text style={[styles.nodeType, { color: colors.textSubtle }]}>{node.type}</Text>
                </View>
              </View>
              {index < arr.length - 1 && <View style={[styles.timelineConnector, { backgroundColor: colors.borderStrong }]} />}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Run Modal */}
      <Modal visible={showRunModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Run Workflow</Text>
              <Pressable onPress={() => setShowRunModal(false)}>
                <X color={colors.textMuted} size={20} />
              </Pressable>
            </View>

            <Text style={[styles.modalWfName, { color: colors.primary }]}>{workflow.name}</Text>
            <Text style={[styles.modalLabel, { color: colors.textMuted }]}>Optional Input Payload (JSON):</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong, color: colors.text }]}
              multiline
              numberOfLines={4}
              placeholder={`{\n  "source": "mobile_demo"\n}`}
              placeholderTextColor={colors.textSubtle}
              value={payloadInput}
              onChangeText={setPayloadInput}
            />

            <View style={styles.modalButtons}>
              <Pressable style={[styles.cancelBtn, { backgroundColor: colors.cardSecondary }]} onPress={() => setShowRunModal(false)}>
                <Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.confirmRunBtn} onPress={handleRunConfirm}>
                <Text style={styles.confirmRunText}>Execute Now</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 16, fontWeight: '800', flex: 1, marginHorizontal: 10 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 10 },
  wfName: { fontSize: 20, fontWeight: '900' },
  wfDesc: { fontSize: 13, lineHeight: 18 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, paddingTop: 12, borderTopWidth: 1 },
  infoItem: { minWidth: '45%' },
  infoLabel: { fontSize: 11, fontWeight: '600' },
  infoValue: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  actionsCard: { gap: 10 },
  runBtn: { backgroundColor: '#7c3aed', borderRadius: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  runBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  pauseBtn: { borderRadius: 14, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderWidth: 1 },
  pauseBtnText: { fontSize: 13, fontWeight: '700' },
  resumeBtn: { borderRadius: 14, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, borderWidth: 1 },
  resumeBtnText: { fontSize: 13, fontWeight: '700' },
  draftBox: { borderRadius: 14, padding: 14 },
  draftText: { fontSize: 12, lineHeight: 16 },
  sectionHeader: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  nodesTimeline: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 4 },
  nodeItem: { position: 'relative' },
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nodeBadge: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  nodeMain: { flex: 1 },
  nodeName: { fontSize: 14, fontWeight: '700' },
  nodeType: { fontSize: 11, fontFamily: 'monospace' },
  timelineConnector: { width: 2, height: 20, marginLeft: 17, marginVertical: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, gap: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalWfName: { fontSize: 15, fontWeight: '700' },
  modalLabel: { fontSize: 12 },
  modalInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: 'monospace', fontSize: 12, textAlignVertical: 'top' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 13, fontWeight: '700' },
  confirmRunBtn: { flex: 2, backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmRunText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
