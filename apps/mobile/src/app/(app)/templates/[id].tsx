import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTemplate, useUseTemplate } from '../../../features/templates/hooks/useTemplates';
import { reconnectCount, templateErrorKey } from '../../../features/templates/template.helpers';
import { FlowList } from '../../../features/workflows/components/FlowList';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../../features/auth/auth-session.scope';
import { useActiveWorkspaceId } from '../../../features/workspace/active-workspace';
import { fill } from '../../../features/common/fill';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Group, SectionLabel } from '../../../components/ui/Section';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';

export default function TemplateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const workspaceId = useActiveWorkspaceId();
  const query = useTemplate(id ?? '');
  const createDraft = useUseTemplate();
  const template = query.data;

  // FlowList wants workflow nodes; a template only has id and type, so it shows them in stored order.
  const flow = useMemo(
    () => ({
      nodes: (template?.nodes ?? []).map((n) => ({ ...n, config: {}, name: null, position: null })),
      edges: [],
    }),
    [template],
  );

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(app)/templates'));

  const handleUse = async () => {
    if (!template || createDraft.isPending) return;
    const scope = captureAuthSessionScope();
    try {
      const { workflowId } = await createDraft.mutateAsync({ id: template.id });
      if (!isAuthSessionScopeCurrent(scope)) return;
      showToast({ type: 'success', title: t('tpl.use.done') });
      router.replace(`/(app)/workflows/${workflowId}`);
    } catch (error) {
      if (isAuthSessionScopeCurrent(scope)) {
        showToast({ type: 'error', title: t('tpl.use.failed'), message: t(templateErrorKey(error, 'use')) });
      }
    }
  };

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <View style={styles.skeleton}>
        <Skeleton height={28} width="70%" />
        <Skeleton height={16} width="90%" />
        <Skeleton height={96} />
        <Skeleton height={96} />
      </View>
    );
  } else if (!template) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else {
    const reconnect = reconnectCount(template.nodes);
    body = (
      <>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isPending}
              onRefresh={() => void query.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <Group padded>
            <Text accessibilityRole="header" style={[Typography.headline, { color: colors.text }]}>
              {template.name}
            </Text>
            {template.authorName ? (
              <Text style={[Typography.label, { color: colors.textMuted }]}>
                {fill(t('tpl.byAuthor'), { name: template.authorName })}
              </Text>
            ) : null}
            <Text style={[Typography.body, { color: colors.textMuted }]}>
              {template.description?.trim() || t('tpl.noDescription')}
            </Text>
            <Text style={[Typography.caption, { color: colors.textSubtle }]}>
              {fill(t('tpl.usedCount'), { n: template.usageCount })}
            </Text>
          </Group>

          <SectionLabel title={t('tpl.visibility.label')} />
          <Group padded>
            <Text style={[Typography.label, { color: colors.text }]}>{t(`tpl.visibility.${template.visibility}`)}</Text>
            <Text style={[Typography.caption, { color: colors.textMuted }]}>
              {t(`tpl.visibility.hint.${template.visibility}`)}
            </Text>
          </Group>

          {template.owned && template.shareCode ? (
            <>
              <SectionLabel title={t('tpl.shareCode')} />
              <Group padded>
                <Text selectable style={[Typography.title, { color: colors.text }]}>
                  {template.shareCode}
                </Text>
              </Group>
            </>
          ) : null}

          <SectionLabel title={t('tpl.steps')} />
          <Group padded>
            <FlowList workflow={flow} />
          </Group>

          {reconnect > 0 ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.note,
                { backgroundColor: colors.tones.warning.bg, borderColor: colors.tones.warning.border },
              ]}
            >
              <Text style={[Typography.body, { color: colors.tones.warning.fg }]}>
                {fill(t('tpl.reconnect.note'), { n: reconnect })}
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.bar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <Button
            label={t('tpl.use')}
            accessibilityHint={t('tpl.use.hint')}
            onPress={() => void handleUse()}
            busy={createDraft.isPending}
            disabled={!workspaceId}
          />
          {!workspaceId ? (
            <Text style={[Typography.caption, styles.center, { color: colors.textMuted }]}>{t('ai.no_workspace')}</Text>
          ) : null}
        </View>
      </>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('tpl.detail.title')} onBack={goBack} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: Spacing.five },
  skeleton: { gap: Spacing.three, padding: Spacing.three },
  note: { margin: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  bar: { gap: Spacing.two, padding: Spacing.three, borderTopWidth: 1 },
  center: { textAlign: 'center' },
});
