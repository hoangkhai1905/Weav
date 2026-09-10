import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  Sparkles,
  Play,
  Activity,
  Link2,
  Bell,
  ChevronRight,
  Building2,
  TrendingUp,
  ArrowRight,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
} from 'lucide-react-native';
import { useAuthStore } from '../../../stores/auth.store';
import { useWorkspaceStore } from '../../../stores/workspace.store';
import { useWorkflows } from '../../../features/workflows/hooks/useWorkflows';
import { useExecutions } from '../../../features/executions/hooks/useExecutions';
import { useNotificationUnreadCount } from '../../../features/notifications/hooks/useNotifications';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { Logo } from '../../../components/common/Logo';
import { ActivitySparkline } from '../../../components/common/ActivitySparkline';

export default function HomeScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  const { data: workflows, isLoading: loadingWfs, refetch: refetchWfs } = useWorkflows();
  const { data: executions, isLoading: loadingExecs, refetch: refetchExecs } = useExecutions();
  const { data: unreadNotifCount = 0 } = useNotificationUnreadCount();

  const [refreshing, setRefreshing] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState('');

  // Pulsing animation for running status indicator
  const pulseOpacity = useSharedValue(0.4);
  useEffect(() => {
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWfs(), refetchExecs()]);
    setRefreshing(false);
  };

  const totalWfs = workflows?.length || 0;
  const publishedWfs = workflows?.filter((w) => w.status === 'PUBLISHED').length || 0;
  const runningExecs = executions?.filter((e) => e.status === 'RUNNING' || e.status === 'QUEUED').length || 0;
  const failedExecs = executions?.filter((e) => e.status === 'FAILED').length || 0;
  const queuedWfs = workflows?.filter((w) => w.status === 'DRAFT').length || 0;

  const recentWfs = workflows?.slice(0, 3) || [];
  const recentExecs = executions?.slice(0, 4) || [];

  const handleAiQuickSubmit = () => {
    if (aiPrompt.trim()) {
      router.push({ pathname: '/(app)/ai/generator', params: { prompt: aiPrompt } });
    } else {
      router.push('/(app)/ai/generator');
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      {/* Ambient background decoration */}
      <View
        style={[
          styles.ambientOrb,
          { backgroundColor: colors.isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.05)' },
        ]}
        pointerEvents="none"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* 1. HEADER */}
        <View style={styles.header}>
          <Logo size="md" showSubtitle={true} />

          <Pressable
            style={[styles.notifBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/(app)/(tabs)/notifications')}
          >
            <Bell color={colors.textMuted} size={18} />
            {unreadNotifCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* 2. GREETING */}
        <View style={styles.greetingBox}>
          <Text style={[styles.greetingSub, { color: colors.textMuted }]}>{t('home.greeting')}</Text>
          <Text style={[styles.userName, { color: colors.text }]}>{user?.name || 'Nguyễn Anh Xuân Trường'}</Text>
          <Text style={[styles.readySub, { color: colors.textSubtle }]}>{t('home.ready_sub')}</Text>
        </View>

        {/* 3. WORKSPACE SELECTOR */}
        <Pressable
          style={[styles.workspaceCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push('/(app)/workspace')}
        >
          <View style={styles.wsRow}>
            <View style={[styles.wsIconCircle, { backgroundColor: colors.cardSecondary }]}>
              <Building2 color={colors.primary} size={16} />
            </View>
            <View style={styles.wsTitleGroup}>
              <Text style={[styles.wsName, { color: colors.text }]}>{activeWorkspace.name}</Text>
              <Text style={[styles.wsEnv, { color: colors.textSubtle }]}>Production Environment • {activeWorkspace.memberCount} Members</Text>
            </View>
          </View>
          <ChevronRight color={colors.textSubtle} size={16} />
        </Pressable>

        {/* 4. MAIN OVERVIEW CARD & SPARKLINE */}
        <View style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.overviewHeader}>
            <View>
              <Text style={[styles.overviewTitle, { color: colors.textMuted }]}>{t('home.overview')}</Text>
              <Text style={[styles.totalNumber, { color: colors.text }]}>{totalWfs} workflows</Text>
            </View>

            <View style={[styles.trendBadge, { backgroundColor: colors.successBg, borderColor: colors.isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(5, 150, 105, 0.3)' }]}>
              <TrendingUp color={colors.success} size={12} />
              <Text style={[styles.trendText, { color: colors.success }]}>+24% ↑</Text>
            </View>
          </View>

          {/* Mini Line Chart / Sparkline Graph */}
          <ActivitySparkline height={42} />

          <Text style={[styles.activitySubText, { color: colors.textSubtle }]}>{t('home.activity_subtitle')}</Text>
        </View>

        {/* 5. WORKFLOW STATUS ROW WITH PULSING RUNNING INDICATOR */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusRow}>
          {/* Published */}
          <View style={[styles.statusChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.statusCount, { color: colors.text }]}>{publishedWfs}</Text>
            <Text style={[styles.statusLabel, { color: colors.textMuted }]}>{t('home.published')}</Text>
          </View>

          {/* Running (With Pulse) */}
          <View style={[styles.statusChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Animated.View style={[styles.statusDot, { backgroundColor: colors.primary }, pulseStyle]} />
            <Text style={[styles.statusCount, { color: colors.primary }]}>{runningExecs}</Text>
            <Text style={[styles.statusLabel, { color: colors.textMuted }]}>{t('home.running')}</Text>
          </View>

          {/* Failed */}
          <View style={[styles.statusChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.danger }]} />
            <Text style={[styles.statusCount, { color: colors.danger }]}>{failedExecs}</Text>
            <Text style={[styles.statusLabel, { color: colors.textMuted }]}>{t('home.failed')}</Text>
          </View>

          {/* Queued / Draft */}
          <View style={[styles.statusChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.textSubtle }]} />
            <Text style={[styles.statusCount, { color: colors.text }]}>{queuedWfs}</Text>
            <Text style={[styles.statusLabel, { color: colors.textMuted }]}>{t('home.queued')}</Text>
          </View>
        </ScrollView>

        {/* 6. QUICK ACTIONS CARDS */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.quick_actions')}</Text>
        </View>

        <View style={styles.actionsGrid}>
          {/* Action 1: Create with AI (Featured) */}
          <Pressable
            style={[
              styles.actionCard,
              styles.featuredActionCard,
              { backgroundColor: colors.card, borderColor: colors.primaryBorder },
            ]}
            onPress={() => router.push('/(app)/ai/generator')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: colors.primaryBg }]}>
              <Sparkles color={colors.primary} size={18} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>{t('home.generate_ai')}</Text>
            <Text style={[styles.actionCardSub, { color: colors.textMuted }]}>AI-assisted DAG build</Text>
          </Pressable>

          {/* Action 2: Run Workflow */}
          <Pressable
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/(app)/(tabs)/workflows')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: colors.successBg }]}>
              <Play color={colors.success} size={18} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>{t('home.run_workflow')}</Text>
            <Text style={[styles.actionCardSub, { color: colors.textMuted }]}>Execute published node</Text>
          </Pressable>

          {/* Action 3: View Activity */}
          <Pressable
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/(app)/(tabs)/executions')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: colors.cardSecondary }]}>
              <Activity color={colors.primary} size={18} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>{t('home.view_executions')}</Text>
            <Text style={[styles.actionCardSub, { color: colors.textMuted }]}>Live log streams</Text>
          </Pressable>

          {/* Action 4: Connections */}
          <Pressable
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/(app)/connections')}
          >
            <View style={[styles.actionIconCircle, { backgroundColor: colors.cardSecondary }]}>
              <Link2 color="#60a5fa" size={18} />
            </View>
            <Text style={[styles.actionCardTitle, { color: colors.text }]}>{t('home.connections')}</Text>
            <Text style={[styles.actionCardSub, { color: colors.textMuted }]}>API & Credentials</Text>
          </Pressable>
        </View>

        {/* 7. AI QUICK CREATE COMPONENT */}
        <View style={[styles.aiQuickCard, { backgroundColor: colors.card, borderColor: colors.primaryBorder }]}>
          <View style={styles.aiQuickHeader}>
            <Sparkles color={colors.primary} size={16} />
            <Text style={[styles.aiQuickTitle, { color: colors.text }]}>{t('home.ai_quick_title')}</Text>
          </View>

          <Text style={[styles.aiQuickDesc, { color: colors.textMuted }]}>{t('home.ai_quick_desc')}</Text>

          <View style={[styles.aiInputRow, { backgroundColor: colors.cardSecondary, borderColor: colors.borderStrong }]}>
            <TextInput
              style={[styles.aiInput, { color: colors.text }]}
              placeholder="e.g. Send daily sales report via Telegram..."
              placeholderTextColor={colors.textSubtle}
              value={aiPrompt}
              onChangeText={setAiPrompt}
              onSubmitEditing={handleAiQuickSubmit}
            />
            <Pressable style={[styles.aiSendBtn, { backgroundColor: colors.primary }]} onPress={handleAiQuickSubmit}>
              <ArrowRight color="#ffffff" size={14} />
            </Pressable>
          </View>
        </View>

        {/* 8. RECENT WORKFLOWS WITH MINI NODE FLOW */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.recent_workflows')}</Text>
          <Pressable onPress={() => router.push('/(app)/(tabs)/workflows')}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>{t('home.see_all')}</Text>
          </Pressable>
        </View>

        {totalWfs === 0 ? (
          /* 10. EMPTY STATE */
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Zap color={colors.primary} size={32} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('home.empty_title')}</Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>{t('home.empty_sub')}</Text>
            <Pressable style={[styles.emptyBtn, { backgroundColor: colors.primary }]} onPress={() => router.push('/(app)/ai/generator')}>
              <Sparkles color="#ffffff" size={14} />
              <Text style={styles.emptyBtnText}>{t('home.generate_ai')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.listGap}>
            {recentWfs.map((wf) => (
              <Pressable
                key={wf.id}
                style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/(app)/workflows/${wf.id}`)}
              >
                <View style={styles.itemCardHeader}>
                  <View style={styles.itemTitleGroup}>
                    <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={1}>{wf.name}</Text>
                    <Text style={[styles.itemMeta, { color: colors.textSubtle }]}>v{wf.version} • {wf.triggerType}</Text>
                  </View>
                  <StatusBadge status={wf.status} />
                </View>

                {/* Mini Node Flow Diagram Representation: Trigger -> AI -> Action */}
                <View style={[styles.miniFlowRow, { backgroundColor: colors.cardSecondary }]}>
                  <View style={styles.miniFlowStep}>
                    <Text style={[styles.miniFlowStepText, { color: colors.textMuted }]}>○ Webhook</Text>
                  </View>
                  <Text style={[styles.miniFlowArrow, { color: colors.primary }]}>➔</Text>
                  <View style={styles.miniFlowStep}>
                    <Text style={[styles.miniFlowStepText, { color: colors.primary }]}>✦ AI Extract</Text>
                  </View>
                  <Text style={[styles.miniFlowArrow, { color: colors.primary }]}>➔</Text>
                  <View style={styles.miniFlowStep}>
                    <Text style={[styles.miniFlowStepText, { color: colors.textMuted }]}>□ Sheets</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* 9. LIVE ACTIVITY STREAM */}
        <View style={[styles.sectionHeader, { marginTop: 24 }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('home.live_activity')}</Text>
          <Pressable onPress={() => router.push('/(app)/(tabs)/executions')}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>{t('home.see_all')}</Text>
          </Pressable>
        </View>

        <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {recentExecs.map((exec) => {
            let Icon = Clock;
            let iconColor = colors.textSubtle;
            if (exec.status === 'SUCCESS') {
              Icon = CheckCircle2;
              iconColor = colors.success;
            } else if (exec.status === 'FAILED') {
              Icon = XCircle;
              iconColor = colors.danger;
            }

            return (
              <Pressable
                key={exec.id}
                style={styles.activityRow}
                onPress={() => router.push(`/(app)/executions/${exec.id}`)}
              >
                {exec.status === 'RUNNING' || exec.status === 'QUEUED' ? (
                  <Animated.View style={[styles.activeDot, pulseStyle]} />
                ) : (
                  <Icon color={iconColor} size={16} />
                )}

                <View style={styles.activityMain}>
                  <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={1}>{exec.workflowName}</Text>
                  <Text style={[styles.activityMeta, { color: colors.textSubtle }]}>
                    {exec.durationMs ? `${(exec.durationMs / 1000).toFixed(1)}s` : 'Running...'} • {exec.triggerType}
                  </Text>
                </View>

                <StatusBadge status={exec.status} size="sm" />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, position: 'relative' },
  ambientOrb: {
    position: 'absolute',
    top: -60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },

  // 1. Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notifBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  notifBadge: { position: 'absolute', top: -3, right: -3, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  notifBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },

  // 2. Greeting
  greetingBox: { gap: 2, marginVertical: 4 },
  greetingSub: { fontSize: 13, fontWeight: '600' },
  userName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  readySub: { fontSize: 12, marginTop: 2 },

  // 3. Workspace Card
  workspaceCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  wsIconCircle: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  wsTitleGroup: { flex: 1 },
  wsName: { fontSize: 13, fontWeight: '800' },
  wsEnv: { fontSize: 10 },

  // 4. Main Overview & Sparkline
  overviewCard: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 10 },
  overviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  overviewTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  totalNumber: { fontSize: 24, fontWeight: '900', marginTop: 2 },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  trendText: { fontSize: 10, fontWeight: '800' },
  activitySubText: { fontSize: 10, marginTop: 4 },

  // 5. Workflow Status Row
  statusRow: { gap: 10, paddingBottom: 4 },
  statusChip: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusCount: { fontSize: 15, fontWeight: '900' },
  statusLabel: { fontSize: 11, fontWeight: '600' },

  // 6. Quick Actions Grid
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  seeAll: { fontSize: 12, fontWeight: '700' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: { flex: 1, minWidth: '45%', borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  featuredActionCard: { borderWidth: 1.5 },
  actionIconCircle: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionCardTitle: { fontSize: 13, fontWeight: '800' },
  actionCardSub: { fontSize: 10 },

  // 7. AI Quick Create Card
  aiQuickCard: { borderRadius: 18, borderWidth: 1.5, padding: 16, gap: 10 },
  aiQuickHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiQuickTitle: { fontSize: 14, fontWeight: '800' },
  aiQuickDesc: { fontSize: 12, lineHeight: 16 },
  aiInputRow: { borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  aiInput: { flex: 1, fontSize: 12 },
  aiSendBtn: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  // 8. Recent Workflows & Node Flow Diagram
  listGap: { gap: 10 },
  itemCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  itemCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemTitleGroup: { flex: 1, marginRight: 8 },
  itemTitle: { fontSize: 14, fontWeight: '800' },
  itemMeta: { fontSize: 11, marginTop: 2 },
  miniFlowRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  miniFlowStep: { paddingHorizontal: 6, paddingVertical: 2 },
  miniFlowStepText: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  miniFlowArrow: { fontSize: 10 },

  // 9. Live Activity Stream
  activityCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34d399' },
  activityMain: { flex: 1 },
  activityTitle: { fontSize: 12, fontWeight: '700' },
  activityMeta: { fontSize: 10 },

  // 10. Empty State
  emptyCard: { borderRadius: 20, borderWidth: 1, padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySub: { fontSize: 12, textAlign: 'center' },
  emptyBtn: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  emptyBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
