import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, X, Terminal } from 'lucide-react-native';
import { useExecutionDetail, useRetryExecution } from '../../../features/executions/hooks/useExecutionDetail';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import type { NodeExecutionResult } from '../../../domain/execution/execution.types';

export default function ExecutionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const { data: execution, isLoading } = useExecutionDetail(id || '');
  const retryMutation = useRetryExecution();

  const [selectedNode, setSelectedNode] = useState<NodeExecutionResult | null>(null);

  if (isLoading || !execution) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const nodeResultsList = Object.values(execution.nodeResults || {});

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)/executions');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>Execution Progress</Text>
        <StatusBadge status={execution.status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Workflow & Execution Metadata Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.wfName, { color: colors.text }]}>{execution.workflowName}</Text>
          <Text style={[styles.execId, { color: colors.textSubtle }]}>{execution.id}</Text>

          <View style={[styles.infoGrid, { borderTopColor: colors.border }]}>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Started At</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {new Date(execution.startedAt).toLocaleTimeString()}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Duration</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {execution.durationMs ? `${(execution.durationMs / 1000).toFixed(1)}s` : 'Running...'}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Trigger</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{execution.triggerType}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={[styles.infoLabel, { color: colors.textSubtle }]}>Status</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>{execution.status}</Text>
            </View>
          </View>
        </View>

        {/* Failed Banner & Retry Action */}
        {execution.status === 'FAILED' && (
          <View style={[styles.failedCard, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
            <View style={styles.failedHeader}>
              <AlertTriangle color={colors.danger} size={20} />
              <Text style={[styles.failedTitle, { color: colors.danger }]}>Execution Failed</Text>
            </View>
            <Text style={[styles.failedError, { color: colors.danger }]}>{execution.error || 'An error occurred during step execution.'}</Text>

            <Pressable
              style={[styles.retryBtn, { backgroundColor: colors.danger }]}
              onPress={() => retryMutation.mutate(execution.id)}
              disabled={retryMutation.isPending}
            >
              <RefreshCw color="#ffffff" size={14} />
              <Text style={styles.retryText}>{retryMutation.isPending ? 'Retrying...' : 'Retry Execution'}</Text>
            </Pressable>
          </View>
        )}

        {/* Execution Progress */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Execution Step Progress</Text>
          <Text style={[styles.sectionSub, { color: colors.textSubtle }]}>Tap any node for input/output inspection</Text>
        </View>

        <View style={[styles.timelineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {nodeResultsList.length > 0 ? (
            nodeResultsList.map((node, index) => {
              let Icon = Clock;
              let iconColor = colors.textSubtle;
              if (node.status === 'SUCCESS') {
                Icon = CheckCircle2;
                iconColor = colors.success;
              } else if (node.status === 'FAILED') {
                Icon = XCircle;
                iconColor = colors.danger;
              } else if (node.status === 'RUNNING') {
                Icon = RefreshCw;
                iconColor = colors.primary;
              }

              return (
                <Pressable
                  key={node.nodeId}
                  style={styles.timelineStep}
                  onPress={() => setSelectedNode(node)}
                >
                  <View style={styles.stepLeft}>
                    <Icon color={iconColor} size={20} />
                    {index < nodeResultsList.length - 1 && <View style={[styles.stepConnector, { backgroundColor: colors.borderStrong }]} />}
                  </View>

                  <View style={styles.stepMain}>
                    <View style={styles.stepHeader}>
                      <Text style={[styles.stepName, { color: colors.text }]}>{node.nodeName}</Text>
                      <StatusBadge status={node.status} />
                    </View>

                    <Text style={[styles.stepMeta, { color: colors.textSubtle }]}>
                      {node.durationMs ? `${node.durationMs}ms` : 'Processing...'}
                      {node.retryCount ? ` • ${node.retryCount} retries` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSubtle }]}>No node execution results yet.</Text>
          )}
        </View>

        {/* Execution Event Logs Stream */}
        {execution.logs && execution.logs.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Logs Stream</Text>
            </View>

            <View style={[styles.logsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {execution.logs.map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <Terminal color={colors.textSubtle} size={13} />
                  <Text style={[styles.logTime, { color: colors.textSubtle }]}>{log.timestamp}</Text>
                  <Text style={[styles.logMessage, { color: colors.textMuted }]} numberOfLines={2}>
                    {log.message}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Node Details Bottom Sheet Modal */}
      <Modal visible={!!selectedNode} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Node Execution Details</Text>
              <Pressable onPress={() => setSelectedNode(null)}>
                <X color={colors.textMuted} size={20} />
              </Pressable>
            </View>

            {selectedNode && (
              <ScrollView contentContainerStyle={styles.modalBody}>
                <View style={styles.nodeHeaderRow}>
                  <Text style={[styles.modalNodeName, { color: colors.primary }]}>{selectedNode.nodeName}</Text>
                  <StatusBadge status={selectedNode.status} />
                </View>

                <Text style={[styles.modalLabel, { color: colors.textMuted }]}>Node ID: {selectedNode.nodeId}</Text>
                {selectedNode.durationMs && (
                  <Text style={[styles.modalLabel, { color: colors.textMuted }]}>Duration: {selectedNode.durationMs}ms</Text>
                )}

                {selectedNode.input && (
                  <View style={[styles.codeBlockGroup, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}>
                    <Text style={[styles.codeBlockTitle, { color: colors.primary }]}>Input Data Payload:</Text>
                    <Text style={[styles.codeBlockText, { color: colors.text }]}>{JSON.stringify(selectedNode.input, null, 2)}</Text>
                  </View>
                )}

                {selectedNode.output && (
                  <View style={[styles.codeBlockGroup, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}>
                    <Text style={[styles.codeBlockTitle, { color: colors.primary }]}>Output Result Payload:</Text>
                    <Text style={[styles.codeBlockText, { color: colors.text }]}>{JSON.stringify(selectedNode.output, null, 2)}</Text>
                  </View>
                )}

                {selectedNode.error && (
                  <View style={[styles.codeBlockGroup, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
                    <Text style={[styles.codeBlockTitle, { color: colors.danger }]}>Error Exception:</Text>
                    <Text style={[styles.codeBlockText, { color: colors.danger }]}>{selectedNode.error}</Text>
                  </View>
                )}

                <Pressable style={[styles.closeBtn, { backgroundColor: colors.cardSecondary }]} onPress={() => setSelectedNode(null)}>
                  <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>Close Inspection</Text>
                </Pressable>
              </ScrollView>
            )}
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
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 8 },
  wfName: { fontSize: 18, fontWeight: '900' },
  execId: { fontSize: 11, fontFamily: 'monospace' },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingTop: 10, borderTopWidth: 1 },
  infoItem: { minWidth: '45%' },
  infoLabel: { fontSize: 11, fontWeight: '600' },
  infoValue: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  failedCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  failedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failedTitle: { fontSize: 15, fontWeight: '800' },
  failedError: { fontSize: 12, lineHeight: 16 },
  retryBtn: { borderRadius: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 },
  retryText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  sectionHeader: { marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  sectionSub: { fontSize: 11, marginTop: 2 },
  timelineCard: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 4 },
  timelineStep: { flexDirection: 'row', gap: 12 },
  stepLeft: { alignItems: 'center', width: 24 },
  stepConnector: { width: 2, flex: 1, marginVertical: 4 },
  stepMain: { flex: 1, paddingBottom: 16 },
  stepHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepName: { fontSize: 14, fontWeight: '700' },
  stepMeta: { fontSize: 11, marginTop: 2 },
  emptyText: { fontSize: 12 },
  logsCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 8 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logTime: { fontSize: 10, fontFamily: 'monospace' },
  logMessage: { fontSize: 11, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalBody: { gap: 12 },
  nodeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalNodeName: { fontSize: 16, fontWeight: '800' },
  modalLabel: { fontSize: 12 },
  codeBlockGroup: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  codeBlockTitle: { fontSize: 11, fontWeight: '700' },
  codeBlockText: { fontSize: 11, fontFamily: 'monospace' },
  closeBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  closeBtnText: { fontSize: 13, fontWeight: '700' },
});
