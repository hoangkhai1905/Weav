import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Bot, Check, Send } from 'lucide-react-native';
import { useAssistantChat, useConversationMessages } from '../../../features/assistant/hooks/useAssistant';
import { MessageText } from '../../../features/assistant/components/MessageText';
import { QuickQuestions } from '../../../features/assistant/components/QuickQuestions';
import { useSaveGeneratedWorkflow } from '../../../features/ai/hooks/useSaveGeneratedWorkflow';
import { FlowList, useNodeLabel } from '../../../features/workflows/components/FlowList';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';
import type { AssistantDraft } from '../../../domain/assistant/assistant.types';

const MESSAGE_MAX = 4000;

export default function AssistantChatScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationId?: string; q?: string }>();
  const openedId = typeof params.conversationId === 'string' ? params.conversationId : undefined;
  const startQuestion = typeof params.q === 'string' ? params.q : undefined;
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const history = useConversationMessages(openedId);
  const chat = useAssistantChat(openedId);
  const [text, setText] = useState('');
  const scroller = useRef<ScrollView>(null);
  const sentStart = useRef(false);

  useEffect(() => {
    if (startQuestion && !sentStart.current && activeWorkspaceId) {
      sentStart.current = true;
      void chat.send(startQuestion);
    }
  }, [startQuestion, activeWorkspaceId, chat]);

  const past = openedId ? history.data?.messages ?? [] : [];
  const empty = past.length === 0 && chat.turns.length === 0 && !chat.pendingUser;
  const loadingHistory = !!openedId && history.isPending;

  const submit = (value: string) => {
    const message = value.trim();
    if (!message || chat.sending) return;
    setText('');
    void chat.send(message);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(app)/assistant'));

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={history.data?.title || t('asst.title')} onBack={back} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {loadingHistory ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={t('ui.loading')} style={styles.stack}>
              <Skeleton height={56} radius={Radius.lg} />
              <Skeleton height={96} radius={Radius.lg} />
            </View>
          ) : openedId && history.isError ? (
            <ErrorState error={history.error as unknown as ApiError} onRetry={() => void history.refetch()} />
          ) : (
            <>
              {empty ? (
                <View style={styles.welcome}>
                  <Bot size={36} color={colors.primary} />
                  <Text accessibilityRole="header" style={[Typography.title, styles.center, { color: colors.text }]}>
                    {t('asst.welcome.title')}
                  </Text>
                  <Text style={[Typography.body, styles.center, { color: colors.textMuted }]}>{t('asst.welcome.body')}</Text>
                  <QuickQuestions onPick={submit} />
                </View>
              ) : null}
              {past.map((m, i) => (
                <Bubble key={`h${i}`} role={m.role} content={m.content} />
              ))}
              {chat.turns.map((turn) => (
                <View key={turn.id} style={styles.stack}>
                  <Bubble role={turn.role} content={turn.content} />
                  {turn.draft ? <DraftCard draft={turn.draft} /> : null}
                </View>
              ))}
              {chat.pendingUser ? <Bubble role="user" content={chat.pendingUser} /> : null}
              {chat.reply ? (
                chat.reply.text ? (
                  <Bubble role="assistant" content={chat.reply.text} streaming />
                ) : (
                  <Status label={chat.reply.tool ? t('asst.tool') : t('asst.thinking')} />
                )
              ) : null}
              {chat.reply?.draft ? <DraftCard draft={chat.reply.draft} /> : null}
              {chat.failed ? (
                <View style={[styles.errorBox, { borderColor: colors.tones.danger.border, backgroundColor: colors.dangerBg }]}>
                  <Text accessibilityRole="alert" style={[Typography.label, { color: colors.danger }]}>
                    {t('asst.error.title')}
                  </Text>
                  <Text style={[Typography.body, { color: colors.text }]}>{friendlyErrorMessage(chat.failed.error)}</Text>
                  <Button label={t('ui.retry')} variant="secondary" onPress={chat.retry} />
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          <TextInput
            accessibilityLabel={t('asst.input.label')}
            value={text}
            onChangeText={setText}
            placeholder={t('asst.input.placeholder')}
            placeholderTextColor={colors.textSubtle}
            multiline
            maxLength={MESSAGE_MAX}
            editable={!chat.sending}
            onSubmitEditing={() => submit(text)}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.borderStrong, color: colors.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('asst.send')}
            accessibilityState={{ disabled: chat.sending || !text.trim() }}
            disabled={chat.sending || !text.trim()}
            onPress={() => submit(text)}
            style={[styles.send, { backgroundColor: colors.primary, opacity: chat.sending || !text.trim() ? 0.5 : 1 }]}
          >
            <Send size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const Bubble: React.FC<{ role: 'user' | 'assistant'; content: string; streaming?: boolean }> = ({
  role,
  content,
  streaming = false,
}) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const mine = role === 'user';
  return (
    <View style={[styles.bubbleRow, mine ? styles.right : styles.left]}>
      <View
        accessible
        accessibilityLabel={`${mine ? t('asst.you') : t('asst.assistant')}: ${content}`}
        accessibilityLiveRegion={streaming ? 'polite' : 'none'}
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.primary }
            : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
        ]}
      >
        <MessageText content={content} color={mine ? colors.onPrimary : colors.text} />
      </View>
    </View>
  );
};

const Status: React.FC<{ label: string }> = ({ label }) => {
  const colors = useThemeColors();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.bubbleRow, styles.left]}>
      <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
        <Text style={[Typography.body, { color: colors.textMuted }]}>{label}...</Text>
      </View>
    </View>
  );
};

/** A proposal from the assistant: nothing is saved until the user taps save. */
const DraftCard: React.FC<{ draft: AssistantDraft }> = ({ draft }) => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();
  const labelOf = useNodeLabel();
  const save = useSaveGeneratedWorkflow();
  const showToast = useUIStore((s) => s.showToast);
  const [savedId, setSavedId] = useState<string | null>(null);
  const flow = useMemo(
    () => ({
      nodes: draft.definition.nodes.map((n) => ({ ...n, name: null, position: null })),
      edges: draft.definition.edges,
    }),
    [draft],
  );

  const onSave = async () => {
    try {
      setSavedId(
        await save.mutateAsync({
          name: draft.name,
          definition: draft.definition,
          layout: draft.layout,
          labelOf: (node) => labelOf({ type: node.type, name: null }),
        }),
      );
    } catch (e) {
      showToast({ type: 'error', title: t('aig.ready.saveFail'), message: friendlyErrorMessage(e) });
    }
  };

  return (
    <View style={[styles.draft, { backgroundColor: colors.card, borderColor: colors.primaryBorder }]}>
      <Text style={[Typography.label, { color: colors.primary }]}>{t('asst.draft.title')}</Text>
      <Text style={[Typography.title, { color: colors.text }]}>{draft.name}</Text>
      <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('asst.draft.note')}</Text>
      <FlowList workflow={flow} />
      {savedId ? (
        <>
          <View style={styles.saved}>
            <Check size={18} color={colors.tones.success.fg} />
            <Text style={[Typography.label, { color: colors.text }]}>{t('asst.draft.saved')}</Text>
          </View>
          <Button label={t('asst.draft.open')} variant="secondary" onPress={() => router.push(`/(app)/workflows/${savedId}`)} />
        </>
      ) : (
        <Button label={t('asst.draft.save')} busy={save.isPending} onPress={() => void onSave()} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.three, flexGrow: 1 },
  stack: { gap: Spacing.three },
  center: { textAlign: 'center' },
  welcome: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  bubbleRow: { flexDirection: 'row' },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '88%', padding: Spacing.three, borderRadius: Radius.lg },
  errorBox: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  draft: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  saved: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: MinTouch,
    maxHeight: 140,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.lg,
    fontSize: 15,
  },
  send: { width: MinTouch, height: MinTouch, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
});
