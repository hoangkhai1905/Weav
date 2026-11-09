import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Lightbulb, TriangleAlert } from 'lucide-react-native';
import { useAiGenerator } from '../../../features/ai/hooks/useAiGenerator';
import { useSaveGeneratedWorkflow } from '../../../features/ai/hooks/useSaveGeneratedWorkflow';
import { questionLabel } from '../../../features/ai/ai.answers';
import { autoPickConnections, requiredConnectionProvider } from '../../../features/ai/auto-pick';
import { buildGenerateRequest } from '../../../features/ai/generate-request';
import { useConnections } from '../../../features/connections/hooks/useConnections';
import { AI_PROMPT_MAX_LENGTH } from '../../../infrastructure/http/ai.http.contract';
import { useNodeLabel } from '../../../features/workflows/components/FlowList';
import { fill } from '../../../features/common/fill';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { deviceTimeZone } from '../../../features/common/timezone';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { FontFamily, MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { AiGenerationResult } from '../../../domain/ai/ai.types';

const EXAMPLE_KEYS = ['aig.example.1', 'aig.example.2', 'aig.example.3'] as const;

type Notice = Exclude<AiGenerationResult, { status: 'ready' }>;

export default function AiGeneratorScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const showToast = useUIStore((s) => s.showToast);
  const generate = useAiGenerator();
  const save = useSaveGeneratedWorkflow();
  const labelOf = useNodeLabel();
  const connections = useConnections();
  // Read at save time (generation takes up to a minute), not captured at submit.
  const connectionsRef = useRef(connections.data);
  useEffect(() => {
    connectionsRef.current = connections.data;
  }, [connections.data]);

  const [prompt, setPrompt] = useState(typeof params.prompt === 'string' ? params.prompt : '');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const promptLength = Array.from(prompt).length;
  const tooLong = promptLength > AI_PROMPT_MAX_LENGTH;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));

  /** Generate (blanks allowed) -> attach the single matching connections -> save the draft -> open it. */
  const submitPrompt = async () => {
    if (inFlight.current || !prompt.trim() || tooLong) return;
    inFlight.current = true;
    const workspaceId = activeWorkspaceId;
    const stale = () => useWorkspaceStore.getState().activeWorkspaceId !== workspaceId;
    setBusy(true);
    setError(null);
    setNotice(null);
    let stage: 'generate' | 'save' = 'generate';
    try {
      const res = await generate.mutateAsync(buildGenerateRequest(prompt, deviceTimeZone()));
      if (stale()) return;
      if (res.status !== 'ready') {
        setNotice(res);
        return;
      }
      stage = 'save';
      const definition = autoPickConnections(res.definition, connectionsRef.current ?? [], requiredConnectionProvider);
      const id = await save.mutateAsync({
        name: res.name.trim().slice(0, 255) || prompt.trim().slice(0, 60),
        definition,
        layout: res.layout,
        labelOf: (node) => labelOf({ type: node.type, name: null }),
      });
      if (stale()) {
        save.forget(); // the half-made workflow belongs to the other workspace
        return;
      }
      router.replace(`/(app)/workflows/${id}`);
    } catch (e) {
      if (stale()) return;
      if (stage === 'generate') setError(e as ApiError);
      else showToast({ type: 'error', title: t('aig.ready.saveFail'), message: friendlyErrorMessage(e) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!activeWorkspaceId) {
    body = <Text style={[Typography.body, { color: colors.textMuted }]}>{t('aig.noWorkspace')}</Text>;
  } else if (busy) {
    body = <GeneratingProgress />;
  } else {
    body = (
      <View style={styles.stack}>
        {notice?.status === 'needs_input' ? (
          <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.tones.warning.bg, borderColor: colors.tones.warning.border }]}>
            <TriangleAlert size={22} color={colors.tones.warning.fg} />
            <View style={styles.flex}>
              <Text style={[Typography.label, { color: colors.text }]}>{t('aig.needs.heading')}</Text>
              {notice.questions.map((q) => (
                <Text key={`${q.code}:${q.field}`} style={[Typography.body, { color: colors.text }]}>• {questionLabel(q, t)}</Text>
              ))}
            </View>
          </View>
        ) : null}
        {notice?.status === 'unsupported' ? (
          <>
            <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.tones.warning.bg, borderColor: colors.tones.warning.border }]}>
              <TriangleAlert size={22} color={colors.tones.warning.fg} />
              <View style={styles.flex}>
                <Text style={[Typography.label, { color: colors.text }]}>{t('aig.unsupported.heading')}</Text>
                {notice.reasons.map((r) => (
                  <Text key={r.code} style={[Typography.body, { color: colors.text }]}>• {t(`aig.reason.${r.code}`)}</Text>
                ))}
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.row}>
                <Lightbulb size={18} color={colors.primary} />
                <Text style={[Typography.label, { color: colors.text }]}>{t('aig.hints.title')}</Text>
              </View>
              {['aig.hint.1', 'aig.hint.2', 'aig.hint.3'].map((k) => (
                <Text key={k} style={[Typography.body, { color: colors.textMuted }]}>• {t(k)}</Text>
              ))}
            </View>
          </>
        ) : null}
        <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>{t('aig.prompt.title')}</Text>
        <TextInput
          accessibilityLabel={t('aig.prompt.label')}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder={t('aig.prompt.placeholder')}
          placeholderTextColor={colors.textSubtle}
          style={[styles.prompt, { backgroundColor: colors.card, borderColor: tooLong ? colors.danger : colors.borderStrong, color: colors.text, outlineColor: colors.primary }]}
        />
        <Text
          accessibilityLiveRegion="polite"
          style={[Typography.caption, styles.counter, { color: tooLong ? colors.danger : colors.textMuted }]}
        >
          {tooLong
            ? fill(t('aig.prompt.tooLong'), { max: AI_PROMPT_MAX_LENGTH })
            : fill(t('aig.prompt.counter'), { n: promptLength, max: AI_PROMPT_MAX_LENGTH })}
        </Text>
        <View style={styles.examples}>
          <Text style={[Typography.label, { color: colors.textMuted }]}>{t('aig.examples.title')}</Text>
          {EXAMPLE_KEYS.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={t(k)}
              onPress={() => setPrompt(t(k))}
              style={[styles.example, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[Typography.body, { color: colors.text }]}>{t(k)}</Text>
            </Pressable>
          ))}
        </View>
        {error ? <ErrorState error={error} onRetry={() => void submitPrompt()} /> : null}
        <Button label={t('aig.generate')} disabled={!prompt.trim() || tooLong} onPress={() => void submitPrompt()} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('aig.title')} onBack={back} />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const STAGES = [0, 8, 25, 50] as const; // seconds at which each progress stage starts

/** The generate call can take up to ~80 s, so show what is happening and how long we have waited. */
const GeneratingProgress: React.FC = () => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const current = STAGES.reduce((acc, start, i) => (seconds >= start ? i : acc), 0);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${t('aig.loading.title')}. ${t(`aig.stage.${current + 1}`)}`}
      accessibilityLiveRegion="polite"
      style={styles.stack}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[Typography.title, styles.center, { color: colors.text }]}>{t('aig.loading.title')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {STAGES.map((_, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <View key={i} style={styles.row}>
              <View style={styles.stageIcon}>
                {done ? <Check size={18} color={colors.tones.success.fg} /> : active ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              </View>
              <Text
                style={[
                  Typography.body,
                  { color: active ? colors.text : done ? colors.textMuted : colors.textSubtle, fontFamily: active ? FontFamily.bold : FontFamily.regular },
                ]}
              >
                {t(`aig.stage.${i + 1}`)}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={[Typography.caption, styles.center, { color: colors.textMuted }]}>{t('aig.loading.hint')}</Text>
      <Text style={[Typography.caption, styles.center, { color: colors.textSubtle }]}>{fill(t('aig.loading.elapsed'), { n: seconds })}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.six },
  stack: { gap: Spacing.three },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  banner: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  prompt: {
    minHeight: 140,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  counter: { textAlign: 'right' },
  examples: { gap: Spacing.two },
  example: { minHeight: MinTouch, justifyContent: 'center', padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  stageIcon: { width: 24, alignItems: 'center' },
});
