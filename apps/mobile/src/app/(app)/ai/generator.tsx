import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, CircleCheck, Lightbulb, TriangleAlert } from 'lucide-react-native';
import { useAiGenerator } from '../../../features/ai/hooks/useAiGenerator';
import { useSaveGeneratedWorkflow } from '../../../features/ai/hooks/useSaveGeneratedWorkflow';
import { QuestionsForm, initialValues } from '../../../features/ai/components/QuestionsForm';
import { buildAnswers, type Answers } from '../../../features/ai/ai.answers';
import { AI_PROMPT_MAX_LENGTH } from '../../../infrastructure/http/ai.http.contract';
import { FlowList, useNodeLabel } from '../../../features/workflows/components/FlowList';
import { PublishResultSheet } from '../../../features/workflows/components/PublishResultSheet';
import { usePublishWorkflow } from '../../../features/workflows/hooks/useWorkflows';
import { useWorkflowPermissions } from '../../../features/workflows/hooks/useWorkflowPermissions';
import { fill } from '../../../features/common/fill';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { deviceTimeZone } from '../../../features/common/timezone';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { AiGenerationResult } from '../../../domain/ai/ai.types';
import type { WorkflowPublication } from '../../../domain/workflow/workflow.types';

const EXAMPLE_KEYS = ['aig.example.1', 'aig.example.2', 'aig.example.3'] as const;
const EMPTY_ANSWERS: Answers = { answers: {}, connections: {} };

type Ready = Extract<AiGenerationResult, { status: 'ready' }>;
type NeedsInput = Extract<AiGenerationResult, { status: 'needs_input' }>;

export default function AiGeneratorScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const showToast = useUIStore((s) => s.showToast);
  const generate = useAiGenerator();
  const save = useSaveGeneratedWorkflow();
  const publish = usePublishWorkflow();
  const perms = useWorkflowPermissions();
  const labelOf = useNodeLabel();

  const [prompt, setPrompt] = useState(typeof params.prompt === 'string' ? params.prompt : '');
  const [result, setResult] = useState<AiGenerationResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [collected, setCollected] = useState<Answers>(EMPTY_ANSWERS);
  const [values, setValues] = useState<Record<string, string>>({});
  const [invalidKeys, setInvalidKeys] = useState<string[]>([]);
  const [urlErrorKeys, setUrlErrorKeys] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publication, setPublication] = useState<WorkflowPublication | null>(null);

  const promptLength = Array.from(prompt).length;
  const tooLong = promptLength > AI_PROMPT_MAX_LENGTH;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));

  const run = async (answers: Answers) => {
    setError(null);
    setFormError(null);
    try {
      const res = await generate.mutateAsync({
        prompt: prompt.trim(),
        timezone: deviceTimeZone(),
        ...(Object.keys(answers.answers).length > 0 ? { answers: answers.answers } : {}),
        ...(Object.keys(answers.connections).length > 0 ? { connections: answers.connections } : {}),
      });
      setResult(res);
      if (res.status === 'needs_input') {
        setValues(initialValues(res.questions, t));
        setInvalidKeys([]);
        setUrlErrorKeys([]);
      }
      if (res.status === 'ready') setName(res.name);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const startOver = () => {
    setResult(null);
    setError(null);
    setCollected(EMPTY_ANSWERS);
    setSavedId(null);
    save.forget();
  };

  const submitPrompt = () => {
    if (!prompt.trim() || tooLong) return;
    setCollected(EMPTY_ANSWERS);
    void run(EMPTY_ANSWERS);
  };

  const submitAnswers = (res: NeedsInput) => {
    const built = buildAnswers({ prompt: prompt.trim(), questions: res.questions, values, previous: collected });
    if (built.ok === false) {
      setInvalidKeys(built.keys);
      setUrlErrorKeys(built.urlKeys);
      setFormError(t(built.reason === 'missing' || built.reason === 'invalid_url' ? 'aig.err.missing' : built.reason === 'too_long' ? 'aig.err.tooLong' : 'aig.err.invalid'));
      return;
    }
    setInvalidKeys([]);
    setUrlErrorKeys([]);
    setCollected(built.value);
    void run(built.value);
  };

  const saveDraft = async (res: Ready) => {
    try {
      const id = await save.mutateAsync({
        name: name.trim(),
        definition: res.definition,
        layout: res.layout,
        labelOf: (node) => labelOf({ type: node.type, name: null }),
      });
      setSavedId(id);
    } catch (e) {
      showToast({ type: 'error', title: t('aig.ready.saveFail'), message: friendlyErrorMessage(e) });
    }
  };

  const doPublish = async () => {
    if (!savedId) return;
    try {
      const out = await publish.mutateAsync(savedId);
      setConfirmPublish(false);
      setPublication(out);
    } catch (e) {
      setConfirmPublish(false);
      showToast({ type: 'error', title: t('pub.failTitle'), message: friendlyErrorMessage(e) });
    }
  };

  const closePublication = () => {
    setPublication(null);
    publish.reset(); // drop the one-time webhook secrets
  };

  let body: React.ReactNode;
  if (!activeWorkspaceId) {
    body = <Text style={[Typography.body, { color: colors.textMuted }]}>{t('aig.noWorkspace')}</Text>;
  } else if (generate.isPending) {
    body = <GeneratingProgress />;
  } else if (savedId && result?.status === 'ready') {
    body = (
      <View style={styles.stack}>
        <View style={[styles.banner, { backgroundColor: colors.tones.success.bg, borderColor: colors.tones.success.border }]}>
          <CircleCheck size={22} color={colors.tones.success.fg} />
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>{t('aig.saved.title')}</Text>
            <Text style={[Typography.body, { color: colors.textMuted }]}>{t('aig.saved.body')}</Text>
          </View>
        </View>
        <Button label={t('aig.saved.open')} onPress={() => router.replace(`/(app)/workflows/${savedId}`)} />
        {perms.loaded && perms.canPublish ? (
          <Button label={t('aig.saved.publish')} variant="secondary" onPress={() => setConfirmPublish(true)} />
        ) : perms.loaded ? (
          <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('aig.saved.noPublish')}</Text>
        ) : null}
        <Button label={t('aig.saved.another')} variant="secondary" onPress={() => { setPrompt(''); startOver(); }} />
      </View>
    );
  } else if (result?.status === 'needs_input') {
    body = (
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>{t('aig.needs.title')}</Text>
        <Text style={[Typography.body, { color: colors.textMuted }]}>{t('aig.needs.hint')}</Text>
        <QuestionsForm
          questions={result.questions}
          values={values}
          invalidKeys={invalidKeys}
          urlErrorKeys={urlErrorKeys}
          onChange={(key, value) => {
            setValues((v) => ({ ...v, [key]: value }));
            setInvalidKeys((k) => k.filter((x) => x !== key));
            setUrlErrorKeys((k) => k.filter((x) => x !== key));
          }}
        />
        {formError ? <Text accessibilityRole="alert" style={[Typography.label, { color: colors.danger }]}>{formError}</Text> : null}
        {error ? <ErrorState error={error} onRetry={() => submitAnswers(result)} /> : null}
        <Button label={t('aig.needs.submit')} onPress={() => submitAnswers(result)} />
        <Button label={t('aig.editPrompt')} variant="secondary" onPress={startOver} />
      </View>
    );
  } else if (result?.status === 'unsupported') {
    body = (
      <View style={styles.stack}>
        <View style={[styles.banner, { backgroundColor: colors.tones.warning.bg, borderColor: colors.tones.warning.border }]}>
          <TriangleAlert size={22} color={colors.tones.warning.fg} />
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>{t('aig.unsupported.title')}</Text>
            {result.reasons.map((r) => (
              <Text key={r.code} style={[Typography.body, { color: colors.text }]}>{t(`aig.reason.${r.code}`)}</Text>
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
        <Button label={t('aig.editPrompt')} onPress={startOver} />
      </View>
    );
  } else if (result?.status === 'ready') {
    const emptyName = name.trim() === '';
    body = (
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>{t('aig.ready.title')}</Text>
        <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('aig.ready.note')}</Text>
        <View style={styles.field}>
          <Text style={[Typography.label, { color: colors.text }]}>{t('aig.ready.name')}</Text>
          <TextInput
            accessibilityLabel={t('aig.ready.name')}
            value={name}
            onChangeText={setName}
            maxLength={255}
            style={[styles.input, { backgroundColor: colors.card, borderColor: emptyName ? colors.danger : colors.borderStrong, color: colors.text }]}
          />
          {emptyName ? <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>{t('aig.ready.name.empty')}</Text> : null}
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[Typography.label, { color: colors.text }]}>{t('aig.ready.steps')}</Text>
          <FlowList workflow={result} />
        </View>
        <Button
          label={save.isError ? t('aig.ready.saveRetry') : t('aig.ready.save')}
          busy={save.isPending}
          disabled={emptyName}
          icon={<Check size={18} color={colors.onPrimary} />}
          onPress={() => void saveDraft(result)}
        />
        <Button label={t('aig.regenerate')} variant="secondary" onPress={() => void run(collected)} />
        <Button label={t('aig.editPrompt')} variant="secondary" onPress={startOver} />
      </View>
    );
  } else {
    body = (
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>{t('aig.prompt.title')}</Text>
        <TextInput
          accessibilityLabel={t('aig.prompt.label')}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder={t('aig.prompt.placeholder')}
          placeholderTextColor={colors.textSubtle}
          style={[styles.prompt, { backgroundColor: colors.card, borderColor: tooLong ? colors.danger : colors.borderStrong, color: colors.text }]}
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
        {error ? <ErrorState error={error} onRetry={submitPrompt} /> : null}
        <Button
          label={t('aig.generate')}

          disabled={!prompt.trim() || tooLong}
          onPress={submitPrompt}
        />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('aig.title')} onBack={back} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmSheet
        visible={confirmPublish}
        title={t('pub.confirm.title')}
        message={t('pub.confirm.body')}
        confirmLabel={t('pub.confirm.action')}
        busy={publish.isPending}
        onConfirm={() => void doPublish()}
        onClose={() => setConfirmPublish(false)}
      />
      <PublishResultSheet publication={publication} onClose={closePublication} />
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
                  { color: active ? colors.text : done ? colors.textMuted : colors.textSubtle, fontWeight: active ? '700' : '400' },
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
  field: { gap: Spacing.one },
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
  input: { minHeight: MinTouch, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: Radius.md, fontSize: 15 },
  counter: { textAlign: 'right' },
  examples: { gap: Spacing.two },
  example: { minHeight: MinTouch, justifyContent: 'center', padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  stageIcon: { width: 24, alignItems: 'center' },
});
