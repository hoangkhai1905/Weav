import React from 'react';
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Building2, Mail } from 'lucide-react-native';
import type { MyInvitation } from '../../../domain/workspace/workspace.types';
import type { ApiError } from '../../../domain/common/error.types';
import {
  useAcceptInvitation,
  useDeclineInvitation,
  useMyInvitations,
} from '../../../features/workspace/hooks/useInvitations';
import { VerifyEmailCard } from '../../../features/workspace/components/VerifyEmailCard';
import { invitationErrorKey, invitationListIsStale } from '../../../features/workspace/invitation.helpers';
import { fill } from '../../../features/common/fill';
import { formatRelativeTime } from '../../../features/common/time';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useUIStore } from '../../../stores/ui.store';

export default function InvitationsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const query = useMyInvitations();
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const [declineTarget, setDeclineTarget] = React.useState<MyInvitation | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const busy = accept.isPending || decline.isPending;
  const items = query.data?.items ?? [];
  const unverified = query.data?.emailVerified === false;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));

  const fail = (title: string, error: unknown) => {
    showToast({ type: 'error', title, message: t(invitationErrorKey(error, 'respond')) });
    // The invitation may have expired, been revoked or the e-mail check may have lapsed: reload the list.
    if (invitationListIsStale(error)) void query.refetch();
  };

  const handleAccept = async (invitation: MyInvitation) => {
    if (busy) return;
    try {
      await accept.mutateAsync(invitation.id);
    } catch (error) {
      fail(t('inv.accept.failTitle'), error);
      return;
    }
    showToast({ type: 'success', title: fill(t('inv.accepted'), { workspace: invitation.workspaceName }) });
    router.replace('/(app)/(tabs)');
  };

  const handleDecline = async () => {
    const invitation = declineTarget;
    if (!invitation || busy) return;
    try {
      await decline.mutateAsync(invitation.id);
      showToast({ type: 'success', title: t('inv.declined') });
    } catch (error) {
      fail(t('inv.decline.failTitle'), error);
    } finally {
      setDeclineTarget(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  let body: React.ReactNode;
  if (query.isPending) {
    body = <ListSkeleton rows={3} />;
  } else if (query.error && !query.data) {
    body = <ErrorState error={query.error as unknown as ApiError} onRetry={() => void query.refetch()} />;
  } else if (unverified) {
    body = <VerifyEmailCard />;
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<Mail size={32} color={colors.textSubtle} />}
        title={t('inv.empty.title')}
        description={t('inv.empty.body')}
      />
    );
  } else {
    body = (
      <View testID="invitations-list" style={styles.list}>
        {items.map((invitation) => (
          <View
            key={invitation.id}
            testID={`invitation-${invitation.id}`}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.top}>
              <Building2 size={20} color={colors.textSubtle} />
              <View style={styles.who}>
                <Text style={[Typography.body, styles.name, { color: colors.text }]} numberOfLines={2}>
                  {invitation.workspaceName}
                </Text>
                <Text style={[Typography.caption, { color: colors.textMuted }]} numberOfLines={1}>
                  {fill(t('inv.invitedBy'), { name: invitation.invitedByName })}
                </Text>
                <Text style={[Typography.caption, { color: colors.textSubtle }]} numberOfLines={1}>
                  {fill(t('inv.expires'), { when: formatRelativeTime(invitation.expiresAt, language) })}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button
                  variant="secondary"
                  label={t('inv.decline')}
                  disabled={busy}
                  accessibilityHint={invitation.workspaceName}
                  onPress={() => setDeclineTarget(invitation)}
                />
              </View>
              <View style={styles.action}>
                <Button
                  testID={`invitation-accept-${invitation.id}`}
                  label={t('inv.accept')}
                  busy={accept.isPending && accept.variables === invitation.id}
                  disabled={busy}
                  accessibilityHint={invitation.workspaceName}
                  onPress={() => void handleAccept(invitation)}
                />
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('inv.title')} onBack={goBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.safe}>
        <ScrollView showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {body}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmSheet
        visible={declineTarget !== null}
        title={t('inv.decline.title')}
        message={fill(t('inv.decline.message'), { workspace: declineTarget?.workspaceName ?? '' })}
        confirmLabel={t('inv.decline')}
        destructive
        busy={decline.isPending}
        onConfirm={() => void handleDecline()}
        onClose={() => setDeclineTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.five },
  list: { gap: Spacing.three },
  card: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  who: { flex: 1, gap: Spacing.half },
  name: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
