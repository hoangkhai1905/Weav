import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  LayoutTemplate,
  Link2Off,
  Mail,
  PauseCircle,
  Sparkles,
  TriangleAlert,
} from 'lucide-react-native';
import { useAuthStore } from '../../../stores/auth.store';
import { selectActiveWorkspace, useWorkspaceStore } from '../../../stores/workspace.store';
import { useSwitchWorkspace } from '../../../features/workspace/hooks/useSwitchWorkspace';
import { useMyInvitations } from '../../../features/workspace/hooks/useInvitations';
import { useWorkflowNames } from '../../../features/workflows/hooks/useWorkflows';
import { useDashboard } from '../../../features/dashboard/hooks/useDashboard';
import type { AttentionItem } from '../../../features/dashboard/dashboard.stats';
import { fill } from '../../../features/common/fill';
import {
  dayPart,
  durationBetween,
  formatHourMinute,
  formatRelativeTime,
  formatWeekdayDate,
} from '../../../features/common/time';
import { initialsOf } from '../../../components/ui/Avatar';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { HeaderActions } from '../../../components/ui/HeaderActions';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton } from '../../../components/ui/Skeleton';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { StepTile, StepTileText } from '../../../components/ui/StepTile';
import { TriggerTile } from '../../../components/ui/TriggerTile';
import { formatDuration } from '../../../components/ui/status';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { FontFamily, MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { ApiError } from '../../../domain/common/error.types';

const RECENT_RUNS_SHOWN = 4;

export default function HomeScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const selectWorkspace = useSwitchWorkspace();
  const names = useWorkflowNames();
  const dash = useDashboard();
  // Once a minute while this tab is in front; a failed check just hides the banner.
  const invitationCount = useMyInvitations({ poll: true }).data?.items.length ?? 0;
  const [pickerOpen, setPickerOpen] = useState(false);

  const nameOf = (id: string) => names.get(id) ?? t('exl.unknownWorkflow');
  const firstName = (user?.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? '';
  const workspaceName = activeWorkspace?.name ?? t('dash.workspace.none');
  const openHistory = (filter?: 'failed' | 'running') =>
    router.navigate({ pathname: '/(app)/(tabs)/executions', params: filter ? { filter } : {} });

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fill(t('dash.workspace.change'), { name: workspaceName })}
        onPress={() => setPickerOpen(true)}
        style={styles.switcher}
      >
        <StepTileText kind="action" size={28} label={initialsOf(workspaceName)} />
        <Text numberOfLines={1} style={[styles.workspaceName, { color: colors.text }]}>
          {workspaceName}
        </Text>
        <ChevronDown size={16} strokeWidth={1.75} color={colors.textSubtle} />
      </Pressable>
      <HeaderActions />
    </View>
  );

  const invitationBanner =
    invitationCount > 0 ? (
      <Pressable
        testID="home-invitations-banner"
        accessibilityRole="button"
        accessibilityLabel={fill(t(invitationCount === 1 ? 'inv.banner.one' : 'inv.banner'), { count: invitationCount })}
        accessibilityHint={t('inv.banner.hint')}
        onPress={() => router.push('/(app)/invitations')}
        style={[styles.banner, { backgroundColor: colors.tones.info.bg, borderColor: colors.tones.info.border }]}
      >
        <Mail size={20} strokeWidth={1.75} color={colors.tones.info.fg} />
        <View style={styles.bannerText}>
          <Text style={[Typography.body, { color: colors.text }]}>
            {fill(t(invitationCount === 1 ? 'inv.banner.one' : 'inv.banner'), { count: invitationCount })}
          </Text>
          <Text style={[Typography.label, { color: colors.tones.info.fg }]}>{t('inv.banner.action')}</Text>
        </View>
        <ChevronRight size={18} strokeWidth={1.75} color={colors.tones.info.fg} />
      </Pressable>
    ) : null;

  const switcher = (
    <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t('dash.workspace.pick')}>
      {workspaces.map((w) => {
        const selected = w.id === activeWorkspace?.id;
        return (
          <Pressable
            key={w.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={w.name}
            onPress={() => {
              selectWorkspace(w.id);
              setPickerOpen(false);
            }}
            style={[styles.choice, { borderBottomColor: colors.border, backgroundColor: selected ? colors.cardSecondary : colors.card }]}
          >
            <Text
              style={[Typography.body, styles.choiceText, { color: colors.text, fontFamily: selected ? FontFamily.semibold : FontFamily.regular }]}
            >
              {w.name}
            </Text>
            {selected ? <Check size={18} color={colors.primary} /> : null}
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dash.workspace.manage')}
        onPress={() => {
          setPickerOpen(false);
          router.push('/(app)/workspace');
        }}
        style={[styles.choice, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
      >
        <Text style={[Typography.label, styles.choiceText, { color: colors.primary }]}>{t('dash.workspace.manage')}</Text>
        <ChevronRight size={18} color={colors.primary} />
      </Pressable>
    </Sheet>
  );

  let body: React.ReactNode;
  if (!activeWorkspace) {
    body = (
      <EmptyState
        icon={<Building2 size={36} color={colors.textMuted} />}
        title={t('dash.noWorkspace.title')}
        description={t('dash.noWorkspace.body')}
        actionLabel={t('dash.noWorkspace.action')}
        onAction={() => router.push('/(app)/workspace')}
      />
    );
  } else if (dash.isPending) {
    body = <HomeSkeleton />;
  } else if (dash.error && dash.workflowTotal === 0) {
    body = <ErrorState error={dash.error as ApiError} onRetry={() => void dash.refetch()} />;
  } else {
    const { runs, byStatus } = dash;
    const recent = (dash.recentRuns ?? []).slice(0, RECENT_RUNS_SHOWN);
    const latestFailed = (dash.recentRuns ?? [])
      .filter((e) => e.status === 'FAILED')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    // Failed runs are listed in the alert card; the "needs attention" list keeps what is left.
    const attention = dash.attention.filter((item) => item.kind !== 'RUN_FAILED');
    const part = dayPart();
    body = (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={dash.isRefetching} onRefresh={() => void dash.refetch()} tintColor={colors.primary} />
        }
      >
        <View style={styles.greetingBox}>
          <Text accessibilityRole="header" style={[styles.greeting, { color: colors.text }]}>
            {firstName ? fill(t(`hm.greet.${part}`), { name: firstName }) : t(`hm.greet.${part}.anon`)}
          </Text>
          <Text style={[Typography.body, { color: colors.textMuted }]}>{formatWeekdayDate(language)}</Text>
        </View>

        {runs.failed > 0 ? (
          <Pressable
            testID="home-failed-card"
            accessibilityRole="button"
            accessibilityLabel={fill(t('hm.alert.title'), { n: runs.failed })}
            accessibilityHint={t('hm.alert.hint')}
            onPress={() => openHistory('failed')}
            style={[styles.alert, { backgroundColor: colors.dangerBg }]}
          >
            <View style={[styles.alertTile, { backgroundColor: colors.card }]}>
              <TriangleAlert size={20} strokeWidth={1.75} color={colors.danger} />
            </View>
            <View style={styles.alertText}>
              <Text style={[Typography.label, { color: colors.text }]}>{fill(t('hm.alert.title'), { n: runs.failed })}</Text>
              {latestFailed ? (
                <Text numberOfLines={1} style={[Typography.caption, { color: colors.textMuted }]}>
                  {fill(t('hm.alert.last'), { name: nameOf(latestFailed.workflowId), time: formatHourMinute(latestFailed.createdAt) })}
                </Text>
              ) : null}
            </View>
            <ChevronRight size={18} strokeWidth={1.75} color={colors.textSubtle} />
          </Pressable>
        ) : null}

        <View accessibilityLabel={t('hm.stats.label')} style={styles.stats}>
          <Stat
            label={t('hm.stat.success')}
            value={runs.successRate === null ? '-' : `${runs.successRate}%`}
            onPress={() => openHistory()}
          />
          <Stat
            label={t('hm.stat.failed')}
            value={String(runs.failed)}
            tone={runs.failed > 0 ? 'danger' : undefined}
            onPress={() => openHistory('failed')}
          />
          <Stat
            label={t('hm.stat.on')}
            value={String(byStatus.PUBLISHED)}
            total={dash.workflowTotal}
            onPress={() => router.navigate('/(app)/(tabs)/workflows')}
          />
          <Stat
            label={t('hm.stat.running')}
            value={String(runs.active)}
            tone={runs.active > 0 ? 'info' : undefined}
            onPress={() => openHistory('running')}
          />
        </View>
        {runs.sample > 0 ? (
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>{fill(t('hm.stats.note'), { n: runs.sample })}</Text>
        ) : null}

        {attention.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
              {t('dash.attention.title')}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {attention.map((item, i) => (
                <AttentionRow key={item.key} item={item} last={i === attention.length - 1} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
              {t('dash.runs.title')}
            </Text>
            {recent.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('dash.runs.seeAll')}
                onPress={() => openHistory()}
                style={styles.link}
              >
                <Text style={[Typography.label, { color: colors.primary }]}>{t('hm.runs.seeAll')}</Text>
              </Pressable>
            ) : null}
          </View>
          {recent.length === 0 ? (
            <EmptyState
              title={t('dash.runs.empty.title')}
              description={t('dash.runs.empty.body')}
              actionLabel={t('dash.runs.empty.action')}
              onAction={() => router.navigate('/(app)/(tabs)/workflows')}
            />
          ) : (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {recent.map((e, i) => {
                const active = e.status === 'QUEUED' || e.status === 'RUNNING' || e.status === 'WAITING';
                const duration = e.durationMs ?? durationBetween(e.startedAt, e.finishedAt);
                const when = `${formatHourMinute(e.createdAt)} · ${active ? t('hm.run.inProgress') : formatDuration(duration)}`;
                return (
                  <Pressable
                    key={e.executionId}
                    accessibilityRole="button"
                    accessibilityLabel={`${nameOf(e.workflowId)}, ${formatRelativeTime(e.createdAt, language)}`}
                    accessibilityHint={t('exl.item.hint')}
                    onPress={() => router.push(`/(app)/executions/${e.workflowId}/${e.executionId}`)}
                    style={({ pressed }) => [
                      styles.runRow,
                      i < recent.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      pressed && { backgroundColor: colors.cardSecondary },
                    ]}
                  >
                    <TriggerTile type={e.triggerType} />
                    <View style={styles.runText}>
                      <Text numberOfLines={1} style={[Typography.body, { color: colors.text, fontFamily: FontFamily.medium }]}>
                        {nameOf(e.workflowId)}
                      </Text>
                      <Text style={[Typography.mono, { color: colors.textSubtle }]}>{when}</Text>
                    </View>
                    <StatusBadge status={e.status} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
            {t('hm.new.title')}
          </Text>
          <View style={styles.createRow}>
            <Pressable
              testID="home-create-ai"
              accessibilityRole="button"
              accessibilityLabel={t('hm.new.ai')}
              onPress={() => router.push('/(app)/ai/generator')}
              style={[styles.createCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <StepTile kind="ai">{(color) => <Sparkles size={18} strokeWidth={1.75} color={color} />}</StepTile>
              <Text style={[Typography.body, { color: colors.text, fontFamily: FontFamily.medium }]}>{t('hm.new.ai')}</Text>
            </Pressable>
            <Pressable
              testID="home-create-template"
              accessibilityRole="button"
              accessibilityLabel={t('hm.new.template')}
              onPress={() => router.navigate({ pathname: '/(app)/(tabs)/workflows', params: { segment: 'templates' } })}
              style={[styles.createCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <StepTile kind="logic">{(color) => <LayoutTemplate size={18} strokeWidth={1.75} color={color} />}</StepTile>
              <Text style={[Typography.body, { color: colors.text, fontFamily: FontFamily.medium }]}>{t('hm.new.template')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      {header}
      {invitationBanner}
      {body}
      {switcher}
    </SafeAreaView>
  );
}

const Stat: React.FC<{
  label: string;
  value: string;
  total?: number;
  tone?: 'danger' | 'info';
  onPress: () => void;
}> = ({ label, value, total, tone, onPress }) => {
  const colors = useThemeColors();
  const valueColor = tone === 'danger' ? colors.danger : tone === 'info' ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${total === undefined ? value : `${value} / ${total}`}`}
      onPress={onPress}
      style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[Typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: valueColor }]}>
        {value}
        {total === undefined ? null : <Text style={[styles.statTotal, { color: colors.textSubtle }]}>{` / ${total}`}</Text>}
      </Text>
    </Pressable>
  );
};

const AttentionRow: React.FC<{ item: AttentionItem; last: boolean }> = ({ item, last }) => {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const warn = colors.tones.warning.fg;
  const rowStyle = ({ pressed }: { pressed: boolean }) => [
    styles.runRow,
    !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
    pressed && { backgroundColor: colors.cardSecondary },
  ];

  if (item.kind === 'TRIGGER_DISABLED') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('dash.attention.hint')}
        onPress={() => router.push(`/(app)/workflows/${item.workflowId}`)}
        style={rowStyle}
      >
        <PauseCircle size={20} strokeWidth={1.75} color={warn} />
        <View style={styles.runText}>
          <Text style={[Typography.body, { color: colors.text }]}>{fill(t('dash.attention.trigger'), { name: item.workflowName })}</Text>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>
            {item.reasonCode ? t(`trigger.reason.${item.reasonCode}`) : t('dash.attention.trigger.generic')}
          </Text>
        </View>
      </Pressable>
    );
  }
  if (item.kind === 'CONNECTION_INVALID') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('dash.attention.hint')}
        onPress={() => router.push('/(app)/connections')}
        style={rowStyle}
      >
        <Link2Off size={20} strokeWidth={1.75} color={warn} />
        <View style={styles.runText}>
          <Text style={[Typography.body, { color: colors.text }]}>{fill(t('dash.attention.conn'), { name: item.name })}</Text>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>
            {fill(t('dash.attention.conn.sub'), { provider: t(`provider.${item.provider}`) })}
          </Text>
        </View>
      </Pressable>
    );
  }
  return null;
};

const HomeSkeleton: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t('ui.loading')} style={[styles.content, styles.skeleton]}>
      <Skeleton width="55%" height={28} />
      <Skeleton height={64} radius={Radius.lg} />
      <View style={styles.stats}>
        <Skeleton width="48%" height={72} radius={Radius.lg} />
        <Skeleton width="48%" height={72} radius={Radius.lg} />
      </View>
      <Skeleton height={200} radius={Radius.lg} />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  switcher: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: MinTouch },
  workspaceName: { flexShrink: 1, fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 22 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
  },
  choiceText: { flex: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  bannerText: { flex: 1, gap: Spacing.half },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, paddingBottom: Spacing.four, gap: 18 },
  skeleton: { gap: Spacing.three },
  greetingBox: { gap: Spacing.half },
  greeting: { fontFamily: FontFamily.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: 14, borderRadius: Radius.lg, minHeight: MinTouch },
  alertTile: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  alertText: { flex: 1, gap: Spacing.half },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  stat: { width: '48.5%', gap: Spacing.one, padding: 14, borderWidth: 1, borderRadius: Radius.lg, minHeight: MinTouch },
  statValue: { fontFamily: FontFamily.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  statTotal: { fontFamily: FontFamily.medium, fontSize: 15 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: FontFamily.semibold, fontSize: 16, lineHeight: 22 },
  link: { minHeight: MinTouch, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingHorizontal: 14 },
  runText: { flex: 1, minWidth: 0 },
  createRow: { flexDirection: 'row', gap: 10 },
  createCard: { flex: 1, gap: 10, padding: 14, borderWidth: 1, borderRadius: Radius.lg, minHeight: MinTouch },
});
