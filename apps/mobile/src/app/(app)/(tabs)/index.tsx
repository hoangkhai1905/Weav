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
  Sparkles,
} from 'lucide-react-native';
import { useAuthStore } from '../../../stores/auth.store';
import { selectActiveWorkspace, useWorkspaceStore } from '../../../stores/workspace.store';
import { useWorkflowNames } from '../../../features/workflows/hooks/useWorkflows';
import { useNotificationUnreadCount } from '../../../features/notifications/hooks/useNotifications';
import { useDashboard, TRIGGER_CHECK_LIMIT } from '../../../features/dashboard/hooks/useDashboard';
import type { AttentionItem } from '../../../features/dashboard/dashboard.stats';
import { fill } from '../../../features/common/fill';
import { durationBetween, formatRelativeTime } from '../../../features/common/time';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListItem } from '../../../components/ui/ListItem';
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
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace);
  const { data: unread = 0 } = useNotificationUnreadCount();
  const names = useWorkflowNames();
  const dash = useDashboard();
  const [pickerOpen, setPickerOpen] = useState(false);

  const nameOf = (id: string) => names.get(id) ?? t('exl.unknownWorkflow');
  const firstName = (user?.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? '';

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fill(t('dash.workspace.change'), { name: activeWorkspace?.name ?? t('dash.workspace.none') })}
        onPress={() => setPickerOpen(true)}
        style={[styles.switcher, { backgroundColor: colors.card, borderColor: colors.borderStrong }]}
      >
        <Building2 size={18} color={colors.primary} />
        <View style={styles.switcherText}>
          <Text style={[Typography.caption, { color: colors.textMuted }]}>{t('dash.workspace.label')}</Text>
          <Text numberOfLines={1} style={[Typography.label, { color: colors.text }]}>
            {activeWorkspace?.name ?? t('dash.workspace.none')}
          </Text>
        </View>
        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dash.notifications')}
        onPress={() => router.navigate('/(app)/(tabs)/notifications')}
        style={[styles.bell, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Bell size={20} color={colors.text} />
        {unread > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.danger }]}>
            <Text style={[styles.badgeText, { color: colors.onPrimary }]}>{unread > 9 ? '9+' : unread}</Text>
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
            style={[
              styles.choice,
              {
                backgroundColor: selected ? colors.primaryBg : colors.card,
                borderColor: selected ? colors.primaryBorder : colors.border,
              },
            ]}
          >
            <Text style={[Typography.body, styles.choiceText, { color: colors.text, fontWeight: selected ? '700' : '400' }]}>
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
        style={[styles.choice, { borderColor: colors.borderStrong, backgroundColor: colors.card }]}
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
        <Text accessibilityRole="header" style={[Typography.headline, { color: colors.text }]}>
          {firstName ? fill(t('dash.greeting'), { name: firstName }) : t('dash.greetingAnon')}
        </Text>

        <View style={styles.shortcuts}>
          <Shortcut
            icon={<MessageCircle size={22} color={colors.primary} />}
            title={t('dash.shortcut.assistant')}
            subtitle={t('dash.shortcut.assistant.sub')}
            onPress={() => router.push('/(app)/assistant')}
          />
          <Shortcut
            icon={<Sparkles size={22} color={colors.primary} />}
            title={t('dash.shortcut.generate')}
            subtitle={t('dash.shortcut.generate.sub')}
            onPress={() => router.push('/(app)/ai/generator')}
          />
        </View>

        <Section title={t('dash.overview')}>
          <View style={styles.grid}>
            <StatCard
              label={t('dash.card.workflows')}
              value={String(dash.workflowTotal)}
              caption={fill(t('dash.card.workflows.detail'), {
                published: byStatus.PUBLISHED,
                draft: byStatus.DRAFT,
                paused: byStatus.PAUSED,
              })}
              onPress={() => router.navigate('/(app)/(tabs)/workflows')}
            />
            <StatCard
              label={t('dash.card.success')}
              value={runs.successRate === null ? '-' : `${runs.successRate}%`}
              caption={
                runs.successRate === null
                  ? t('dash.card.success.none')
                  : fill(t('dash.card.success.detail'), { n: runs.success + runs.failed })
              }
              tone={runs.successRate === null ? 'neutral' : runs.successRate >= 80 ? 'success' : 'warning'}
              onPress={() => router.navigate('/(app)/(tabs)/executions')}
            />
            <StatCard
              label={t('dash.card.active')}
              value={String(runs.active)}
              caption={fill(t('dash.card.runs.detail'), { n: runs.sample })}
              tone={runs.active > 0 ? 'info' : 'neutral'}
              onPress={() => router.navigate('/(app)/(tabs)/executions')}
            />
            <StatCard
              label={t('dash.card.failed')}
              value={String(runs.failed)}
              caption={fill(t('dash.card.runs.detail'), { n: runs.sample })}
              tone={runs.failed > 0 ? 'danger' : 'neutral'}
              onPress={() => router.navigate('/(app)/(tabs)/executions')}
            />
          </View>
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>{fill(t('dash.note'), { n: runs.sample })}</Text>
        </Section>

        <Section title={t('dash.attention.title')}>
          {dash.attention.length === 0 ? (
            <View style={[styles.ok, { backgroundColor: colors.tones.success.bg, borderColor: colors.tones.success.border }]}>
              <Check size={18} color={colors.tones.success.fg} />
              <Text style={[Typography.body, styles.okText, { color: colors.text }]}>{t('dash.attention.none')}</Text>
            </View>
          ) : (
            dash.attention.map((item) => (
              <AttentionRow key={item.key} item={item} nameOf={nameOf} language={language} />
            ))
          )}
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>
            {fill(t('dash.attention.note'), { n: TRIGGER_CHECK_LIMIT })}
          </Text>
        </Section>

        <Section
          title={t('dash.runs.title')}
          action={recent.length > 0 ? { label: t('dash.runs.seeAll'), onPress: () => router.navigate('/(app)/(tabs)/executions') } : undefined}
        >
          {recent.length === 0 ? (
            <EmptyState
              title={t('dash.runs.empty.title')}
              description={t('dash.runs.empty.body')}
              actionLabel={t('dash.runs.empty.action')}
              onAction={() => router.navigate('/(app)/(tabs)/workflows')}
            />
          ) : (
            recent.map((e) => (
              <ListItem
                key={e.executionId}
                title={nameOf(e.workflowId)}
                subtitle={`${t(`execution.trigger.${e.triggerType}`)} · ${formatDuration(e.durationMs ?? durationBetween(e.startedAt, e.finishedAt))}`}
                meta={formatRelativeTime(e.createdAt, language)}
                trailing={<StatusBadge status={e.status} />}
                accessibilityHint={t('exl.item.hint')}
                onPress={() => router.push(`/(app)/executions/${e.workflowId}/${e.executionId}`)}
              />
            ))
          )}
        </Section>
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

const Section: React.FC<{
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}> = ({ title, action, children }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
          {title}
        </Text>
        {action ? (
          <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} style={styles.link}>
            <Text style={[Typography.label, { color: colors.primary }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
};

const Shortcut: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; onPress: () => void }> = ({
  icon,
  title,
  subtitle,
  onPress,
}) => {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.shortcut,
        { backgroundColor: pressed ? colors.cardSecondary : colors.card, borderColor: colors.border },
      ]}
    >
      {icon}
      <Text style={[Typography.label, { color: colors.text }]}>{title}</Text>
      <Text style={[Typography.caption, { color: colors.textMuted }]}>{subtitle}</Text>
    </Pressable>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string;
  caption: string;
  tone?: StatusTone;
  onPress: () => void;
}> = ({ label, value, caption, tone = 'neutral', onPress }) => {
  const colors = useThemeColors();
  const tc = colors.tones[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${caption}`}
      onPress={onPress}
      style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[Typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: tone === 'neutral' ? colors.text : tc.fg }]}>{value}</Text>
      <Text style={[Typography.caption, { color: colors.textMuted }]}>{caption}</Text>
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
      <View style={styles.shortcuts}>
        <Skeleton height={96} radius={Radius.lg} style={styles.flex} />
        <Skeleton height={96} radius={Radius.lg} style={styles.flex} />
      </View>
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Skeleton width="50%" height={12} />
            <Skeleton width="40%" height={30} />
            <Skeleton width="80%" height={12} />
          </View>
        ))}
      </View>
      <Skeleton height={64} radius={Radius.md} />
      <Skeleton height={64} radius={Radius.md} />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  switcher: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch + 8,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  switcherText: { flex: 1 },
  bell: {
    width: MinTouch + 8,
    height: MinTouch + 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  choiceText: { flex: 1 },
  content: { gap: Spacing.four, padding: Spacing.three, paddingBottom: Spacing.six },
  shortcuts: { flexDirection: 'row', gap: Spacing.two },
  shortcut: {
    flex: 1,
    gap: Spacing.one,
    minHeight: 96,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  section: { gap: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MinTouch - 8 },
  link: { minHeight: MinTouch, justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: Spacing.one,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  statValue: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  ok: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  okText: { flex: 1 },
});
