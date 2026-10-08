import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Link2Off,
  MessageCircle,
  PauseCircle,
  Plus,
} from 'lucide-react-native';
import { useAuthStore } from '../../../stores/auth.store';
import { selectActiveWorkspace, useWorkspaceStore } from '../../../stores/workspace.store';
import { useSwitchWorkspace } from '../../../features/workspace/hooks/useSwitchWorkspace';
import { useWorkflowNames } from '../../../features/workflows/hooks/useWorkflows';
import { useNotificationUnreadCount } from '../../../features/notifications/hooks/useNotifications';
import { useDashboard, TRIGGER_CHECK_LIMIT } from '../../../features/dashboard/hooks/useDashboard';
import type { AttentionItem } from '../../../features/dashboard/dashboard.stats';
import { fill } from '../../../features/common/fill';
import { durationBetween, formatRelativeTime } from '../../../features/common/time';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListItem } from '../../../components/ui/ListItem';
import { Group, SectionLabel } from '../../../components/ui/Section';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton } from '../../../components/ui/Skeleton';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { formatDuration } from '../../../components/ui/status';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { MinTouch, Radius, Spacing, Typography } from '../../../constants/theme';
import type { StatusTone } from '../../../constants/palette';
import type { ApiError } from '../../../domain/common/error.types';

const RECENT_RUNS_SHOWN = 5;

export default function HomeScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const selectWorkspace = useSwitchWorkspace();
  const { data: unread = 0 } = useNotificationUnreadCount();
  const names = useWorkflowNames();
  const dash = useDashboard();
  const [pickerOpen, setPickerOpen] = useState(false);

  const nameOf = (id: string) => names.get(id) ?? t('exl.unknownWorkflow');
  const firstName = (user?.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? '';

  const header = (
    <View style={[styles.header, { backgroundColor: colors.headerBg, borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fill(t('dash.workspace.change'), { name: activeWorkspace?.name ?? t('dash.workspace.none') })}
        onPress={() => setPickerOpen(true)}
        style={styles.switcher}
      >
        <View style={styles.switcherText}>
          <Text style={[Typography.section, { color: colors.textSubtle, textTransform: 'uppercase' }]}>
            {t('dash.workspace.label')}
          </Text>
          <Text numberOfLines={1} style={[Typography.title, { color: colors.text }]}>
            {activeWorkspace?.name ?? t('dash.workspace.none')}
          </Text>
        </View>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dash.notifications')}
        onPress={() => router.navigate('/(app)/(tabs)/notifications')}
        style={styles.bell}
      >
        <Bell size={20} color={colors.text} />
        {unread > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.danger }]}>
            <Text style={[styles.badgeText, { color: colors.card }]}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );

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
            <Text style={[Typography.body, styles.choiceText, { color: colors.text, fontWeight: selected ? '600' : '400' }]}>
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
    body = (
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={dash.isRefetching} onRefresh={() => void dash.refetch()} tintColor={colors.primary} />
        }
      >
        <Text accessibilityRole="header" style={[Typography.headline, styles.greeting, { color: colors.text }]}>
          {firstName ? fill(t('dash.greeting'), { name: firstName }) : t('dash.greetingAnon')}
        </Text>

        <View style={[styles.stats, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Stat
            label={t('dash.card.workflows')}
            value={String(dash.workflowTotal)}
            caption={fill(t('dash.card.workflows.detail'), {
              published: byStatus.PUBLISHED,
              draft: byStatus.DRAFT,
              paused: byStatus.PAUSED,
            })}
            onPress={() => router.navigate('/(app)/(tabs)/workflows')}
          />
          <Stat
            label={t('dash.card.success')}
            value={runs.successRate === null ? '-' : `${runs.successRate}%`}
            caption={
              runs.successRate === null
                ? t('dash.card.success.none')
                : fill(t('dash.card.success.detail'), { n: runs.success + runs.failed })
            }
            onPress={() => router.navigate('/(app)/(tabs)/executions')}
          />
          <Stat
            label={t('dash.card.active')}
            value={String(runs.active)}
            caption={fill(t('dash.card.runs.detail'), { n: runs.sample })}
            onPress={() => router.navigate('/(app)/(tabs)/executions')}
          />
          <Stat
            label={t('dash.card.failed')}
            value={String(runs.failed)}
            caption={fill(t('dash.card.runs.detail'), { n: runs.sample })}
            tone={runs.failed > 0 ? 'danger' : 'neutral'}
            last
            onPress={() => router.navigate('/(app)/(tabs)/executions')}
          />
        </View>
        <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>{fill(t('dash.note'), { n: runs.sample })}</Text>

        <SectionLabel title={t('dash.attention.title')} />
        <Group>
          {dash.attention.length === 0 ? (
            <ListItem
              leading={<Check size={18} color={colors.tones.success.fg} />}
              title={t('dash.attention.none')}
            />
          ) : (
            dash.attention.map((item) => (
              <AttentionRow key={item.key} item={item} nameOf={nameOf} language={language} />
            ))
          )}
        </Group>
        <Text style={[Typography.caption, styles.note, { color: colors.textSubtle }]}>
          {fill(t('dash.attention.note'), { n: TRIGGER_CHECK_LIMIT })}
        </Text>

        <SectionLabel
          title={t('dash.runs.title')}
          trailing={
            recent.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('dash.runs.seeAll')}
                onPress={() => router.navigate('/(app)/(tabs)/executions')}
                style={styles.link}
              >
                <Text style={[Typography.label, { color: colors.primary }]}>{t('dash.runs.seeAll')}</Text>
              </Pressable>
            ) : undefined
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            title={t('dash.runs.empty.title')}
            description={t('dash.runs.empty.body')}
            actionLabel={t('dash.runs.empty.action')}
            onAction={() => router.navigate('/(app)/(tabs)/workflows')}
          />
        ) : (
          <Group>
            {recent.map((e) => (
              <ListItem
                key={e.executionId}
                title={nameOf(e.workflowId)}
                subtitle={`${t(`execution.trigger.${e.triggerType}`)} · ${formatDuration(e.durationMs ?? durationBetween(e.startedAt, e.finishedAt))}`}
                meta={formatRelativeTime(e.createdAt, language)}
                trailing={<StatusBadge status={e.status} />}
                accessibilityHint={t('exl.item.hint')}
                onPress={() => router.push(`/(app)/executions/${e.workflowId}/${e.executionId}`)}
              />
            ))}
          </Group>
        )}

        <SectionLabel title={t('home.quick_actions')} />
        <Group>
          <ListItem
            leading={<MessageCircle size={20} color={colors.textMuted} />}
            title={t('dash.shortcut.assistant')}
            subtitle={t('dash.shortcut.assistant.sub')}
            trailing={<ChevronRight size={18} color={colors.textSubtle} />}
            onPress={() => router.push('/(app)/assistant')}
          />
          <ListItem
            leading={<Plus size={20} color={colors.textMuted} />}
            title={t('dash.shortcut.generate')}
            subtitle={t('dash.shortcut.generate.sub')}
            trailing={<ChevronRight size={18} color={colors.textSubtle} />}
            onPress={() => router.push('/(app)/ai/generator')}
          />
        </Group>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      {header}
      {body}
      {switcher}
    </SafeAreaView>
  );
}

const Stat: React.FC<{
  label: string;
  value: string;
  caption: string;
  tone?: StatusTone;
  last?: boolean;
  onPress: () => void;
}> = ({ label, value, caption, tone = 'neutral', last = false, onPress }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${caption}`}
      onPress={onPress}
      style={[styles.stat, !last && { borderRightWidth: 1, borderRightColor: colors.border }]}
    >
      <Text style={[Typography.number, { color: tone === 'neutral' ? colors.text : colors.tones[tone].fg }]}>{value}</Text>
      <Text numberOfLines={2} style={[Typography.caption, styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
};

const AttentionRow: React.FC<{
  item: AttentionItem;
  nameOf: (id: string) => string;
  language: 'VI' | 'EN';
}> = ({ item, nameOf, language }) => {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const danger = colors.tones.danger.fg;
  const warn = colors.tones.warning.fg;

  if (item.kind === 'RUN_FAILED') {
    return (
      <ListItem
        leading={<CircleAlert size={20} color={danger} />}
        title={fill(t('dash.attention.run'), { name: nameOf(item.workflowId) })}
        subtitle={fill(t('dash.attention.run.sub'), { time: formatRelativeTime(item.createdAt, language) })}
        accessibilityHint={t('dash.attention.hint')}
        onPress={() => router.push(`/(app)/executions/${item.workflowId}/${item.executionId}`)}
      />
    );
  }
  if (item.kind === 'TRIGGER_DISABLED') {
    return (
      <ListItem
        leading={<PauseCircle size={20} color={warn} />}
        title={fill(t('dash.attention.trigger'), { name: item.workflowName })}
        subtitle={item.reasonCode ? t(`trigger.reason.${item.reasonCode}`) : t('dash.attention.trigger.generic')}
        accessibilityHint={t('dash.attention.hint')}
        onPress={() => router.push(`/(app)/workflows/${item.workflowId}`)}
      />
    );
  }
  return (
    <ListItem
      leading={<Link2Off size={20} color={warn} />}
      title={fill(t('dash.attention.conn'), { name: item.name })}
      subtitle={fill(t('dash.attention.conn.sub'), { provider: t(`provider.${item.provider}`) })}
      accessibilityHint={t('dash.attention.hint')}
      onPress={() => router.push('/(app)/connections')}
    />
  );
};

const HomeSkeleton: React.FC = () => {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t('ui.loading')} style={styles.content}>
      <Skeleton width="55%" height={28} />
      <Skeleton height={76} radius={Radius.md} />
      <Skeleton height={64} radius={Radius.md} />
      <Skeleton height={64} radius={Radius.md} />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    minHeight: MinTouch + 8,
    borderBottomWidth: 1,
  },
  switcher: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: MinTouch },
  switcherText: { flex: 1 },
  bell: { width: MinTouch, height: MinTouch, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
  },
  choiceText: { flex: 1 },
  content: { paddingBottom: Spacing.six },
  greeting: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.three },
  stats: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1 },
  stat: { flex: 1, gap: Spacing.half, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, minHeight: MinTouch },
  statLabel: { fontSize: 12, lineHeight: 16 },
  note: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  link: { minHeight: MinTouch, justifyContent: 'center' },
});
