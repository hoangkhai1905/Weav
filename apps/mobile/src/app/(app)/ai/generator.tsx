import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Sparkles, CheckCircle2, AlertTriangle, Layers, ExternalLink } from 'lucide-react-native';
import { useAiGenerator } from '../../../features/ai/hooks/useAiGenerator';
import { useUIStore } from '../../../stores/ui.store';
import { useThemeColors } from '../../../hooks/useThemeColors';
import type { AiGenerationResult } from '../../../domain/ai/ai.types';

const SAMPLE_PROMPTS = [
  'Nhận webhook hoá đơn, dùng AI trích xuất tổng tiền và lưu vào Google Sheets.',
  'Daily cron 6 PM fetch sales API, AI summarize insight and send to Telegram.',
  'Listen to Telegram webhook, classify intent with AI LLM, and log to sheet.',
];

export default function AiGeneratorScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const generateMutation = useAiGenerator();
  const showToast = useUIStore((s) => s.showToast);

  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]);
  const [result, setResult] = useState<AiGenerationResult | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showToast({ type: 'warning', title: 'Prompt Required', message: 'Please enter a description for AI.' });
      return;
    }
    try {
      const res = await generateMutation.mutateAsync(prompt);
      setResult(res);
      showToast({ type: 'success', title: 'Workflow Generated ✨', message: 'AI DAG generated successfully.' });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Generation Error', message: e.message });
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>AI Workflow Generator</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Prompt Input Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Sparkles color={colors.primary} size={20} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Describe Your Automation Intent</Text>
          </View>

          <TextInput
            style={[styles.promptInput, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong, color: colors.text }]}
            multiline
            numberOfLines={4}
            placeholder="e.g. Receive email webhook, extract total with AI, append to Google Sheets..."
            placeholderTextColor={colors.textSubtle}
            value={prompt}
            onChangeText={setPrompt}
          />

          {/* Sample Prompts */}
          <Text style={[styles.samplesTitle, { color: colors.textMuted }]}>Try Sample Prompts:</Text>
          <View style={styles.samplesList}>
            {SAMPLE_PROMPTS.map((p, idx) => (
              <Pressable key={idx} style={[styles.sampleChip, { backgroundColor: colors.cardSecondary }]} onPress={() => setPrompt(p)}>
                <Text style={[styles.sampleText, { color: colors.text }]} numberOfLines={1}>{p}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={styles.generateBtn}
            onPress={handleGenerate}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Sparkles color="#ffffff" size={16} />
                <Text style={styles.generateBtnText}>Generate Workflow Preview</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* AI Result Preview Card */}
        {result && (
          <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
            <Text style={[styles.resultWfName, { color: colors.text }]}>{result.workflowPreview.name}</Text>
            <Text style={[styles.resultReasoning, { color: colors.textMuted }]}>{result.reasoning}</Text>

            {/* Validation Banner */}
            <View style={[styles.valBanner, result.validation.valid ? styles.valSuccess : styles.valWarning]}>
              {result.validation.valid ? (
                <CheckCircle2 color={colors.success} size={18} />
              ) : (
                <AlertTriangle color={colors.warning} size={18} />
              )}
              <Text style={[styles.valTitle, { color: colors.text }]}>
                {result.validation.valid ? 'Valid Workflow DAG' : 'Validation Warnings'}
              </Text>
            </View>

            {result.validation.warnings.map((w, i) => (
              <Text key={i} style={[styles.warningText, { color: colors.warning }]}>• {w}</Text>
            ))}

            {/* Generated Node Chain Preview */}
            <Text style={[styles.chainTitle, { color: colors.text }]}>Generated Node Chain:</Text>
            <View style={styles.nodesChain}>
              {result.workflowPreview.nodes?.map((node) => (
                <View key={node.id} style={[styles.chainNode, { backgroundColor: colors.cardSecondary }]}>
                  <View style={[styles.chainIcon, { backgroundColor: colors.card }]}>
                    <Layers color={colors.primary} size={14} />
                  </View>
                  <View style={styles.chainTextGroup}>
                    <Text style={[styles.chainNodeName, { color: colors.text }]}>{node.name}</Text>
                    <Text style={[styles.chainNodeType, { color: colors.textSubtle }]}>{node.type}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Action Buttons */}
            <View style={styles.resultActions}>
              <Pressable style={styles.saveDraftBtn} onPress={() => router.push('/(app)/(tabs)/workflows')}>
                <Text style={styles.saveDraftText}>Save Draft</Text>
              </Pressable>
              <Pressable style={[styles.webHintBtn, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]} onPress={() => showToast({ type: 'info', title: 'Open on Web', message: 'Full node editor available on WEAV Web Platform.' })}>
                <ExternalLink color={colors.primary} size={14} />
                <Text style={[styles.webHintText, { color: colors.primary }]}>Open in Web</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 10 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },
  card: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  promptInput: { borderRadius: 14, borderWidth: 1, padding: 14, fontSize: 13, textAlignVertical: 'top', minHeight: 90 },
  samplesTitle: { fontSize: 11, fontWeight: '700' },
  samplesList: { gap: 6 },
  sampleChip: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  sampleText: { fontSize: 11 },
  generateBtn: { backgroundColor: '#7c3aed', borderRadius: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 },
  generateBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  resultCard: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
  resultWfName: { fontSize: 18, fontWeight: '900' },
  resultReasoning: { fontSize: 12, lineHeight: 16 },
  valBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
  valSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)' },
  valWarning: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.3)' },
  valTitle: { fontSize: 13, fontWeight: '700' },
  warningText: { fontSize: 11 },
  chainTitle: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  nodesChain: { gap: 8 },
  chainNode: { borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chainIcon: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  chainTextGroup: { flex: 1 },
  chainNodeName: { fontSize: 12, fontWeight: '700' },
  chainNodeType: { fontSize: 10, fontFamily: 'monospace' },
  resultActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  saveDraftBtn: { flex: 1, backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  saveDraftText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  webHintBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderWidth: 1 },
  webHintText: { fontSize: 13, fontWeight: '700' },
});
