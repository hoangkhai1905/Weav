import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { KeyRound, MonitorSmartphone, UserRound } from 'lucide-react-native';
import { useAuthSessions } from '../../../features/auth/hooks/useAuthSessions';
import { useOAuthAccounts, useRevokeOtherSessions } from '../../../features/profile/hooks/useAccount';
import { expireAuthSession } from '../../../features/auth/auth-session.runtime';
import {
  createChangePasswordSubmissionGate,
  isChangePasswordScopeCurrent,
  type ChangePasswordValidationErrors,
  validateChangePassword,
} from '../../../features/auth/change-password.utils';
import { describeUserAgent } from '../../../features/auth/user-agent';
import { captureAuthSessionScope, isAuthSessionScopeCurrent } from '../../../features/auth/auth-session.scope';
import { friendlyErrorMessage } from '../../../features/common/friendly-error';
import { localizeValidation } from '../../../features/common/validation-copy';
import { formatDateTime, formatRelativeTime } from '../../../features/common/time';
import { showMilestoneToastForSession } from '../../../features/feedback/milestone-toast';
import { authRepository } from '../../../infrastructure/repository-factory';
import { Button } from '../../../components/ui/Button';
import { ConfirmSheet } from '../../../components/ui/ConfirmSheet';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ListSkeleton } from '../../../components/ui/ListSkeleton';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Sheet } from '../../../components/ui/Sheet';
import { TextField } from '../../../components/ui/TextField';
import type { ApiError } from '../../../domain/common/error.types';
import { Radius, Spacing, Typography } from '../../../constants/theme';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useTranslation } from '../../../hooks/useTranslation';
import { useAuthStore } from '../../../stores/auth.store';
import { useUIStore } from '../../../stores/ui.store';

type SessionConfirm = { kind: 'one'; id: string; current: boolean } | { kind: 'others' } | null;

/** Security screen (route /settings, also the target of SECURITY_SETTINGS notifications). */
export default function SecurityScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { t, language } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const sessions = useAuthSessions();
  const oauth = useOAuthAccounts();
  const revokeOthers = useRevokeOtherSessions();
  const sessionPage = sessions.data;
  const busy = sessions.revokeSessionMutation.isPending || revokeOthers.isPending;

  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<ChangePasswordValidationErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [changing, setChanging] = React.useState(false);
  const [confirm, setConfirm] = React.useState<SessionConfirm>(null);
  const gate = React.useRef(createChangePasswordSubmissionGate());

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'));

  const closePassword = () => {
    setPasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setFormError(null);
  };

  const handleChangePassword = async () => {
    if (!gate.current.tryStart()) return;
    try {
      const errors = validateChangePassword({ currentPassword, newPassword, confirmPassword });
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setFormError(null);
        return;
      }
      const auth = useAuthStore.getState();
      const userId = auth.user?.id;
      const refreshToken = auth.tokens?.refreshToken;
      const scope = captureAuthSessionScope();
      if (!auth.isAuthenticated || !userId || !refreshToken || !scope) {
        setFormError(t('ui.error.UNAUTHORIZED'));
        return;
      }
      setFieldErrors({});
      setFormError(null);
      setChanging(true);
      try {
        await authRepository.changePassword(currentPassword, newPassword);
        const now = useAuthStore.getState();
        if (
          !isAuthSessionScopeCurrent(scope) ||
          !isChangePasswordScopeCurrent(userId, refreshToken, now.user?.id ?? null, now.tokens?.refreshToken ?? null, now.isAuthenticated)
        ) {
          return;
        }
        closePassword();
        showMilestoneToastForSession(scope, 'auth.password_changed');
        // The backend ends every session after a password change: sign in again.
        await expireAuthSession();
        router.replace('/(auth)/login');
      } catch (error) {
        const now = useAuthStore.getState();
        if (
          isAuthSessionScopeCurrent(scope) &&
          isChangePasswordScopeCurrent(userId, refreshToken, now.user?.id ?? null, now.tokens?.refreshToken ?? null, now.isAuthenticated)
        ) {
          const status = (error as { status?: number } | null)?.status;
          setFormError(t(status === 400 || status === 401 || status === 403 ? 'sec.pw.wrongCurrent' : 'sec.pw.failed'));
        }
      } finally {
        setChanging(false);
      }
    } finally {
      gate.current.finish();
    }
  };

  const handleConfirm = async () => {
    const action = confirm;
    if (!action) return;
    try {
      if (action.kind === 'one') {
        await sessions.revokeSessionMutation.mutateAsync({ sessionId: action.id, current: action.current });
        if (!action.current) showToast({ type: 'success', title: t('sec.session.revoked') });
      } else {
        const count = await revokeOthers.mutateAsync();
        showToast({ type: 'success', title: t('sec.others.done').replace('{n}', String(count)) });
      }
    } catch (error) {
      showToast({ type: 'error', title: t('sec.session.failed'), message: friendlyErrorMessage(error) });
    } finally {
      setConfirm(null);
    }
  };

  const hasOthers = Boolean(sessionPage?.items.some((s) => !s.current)) || (sessionPage?.totalPages ?? 0) > 1;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('sec.title')} onBack={goBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <KeyRound size={20} color={colors.primary} />
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
              {t('sec.pw.title')}
            </Text>
          </View>
          <Text style={[Typography.body, { color: colors.textMuted }]}>{t('sec.pw.desc')}</Text>
          <Button testID="security-change-password" label={t('sec.pw.change')} variant="secondary" onPress={() => setPasswordOpen(true)} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <UserRound size={20} color={colors.primary} />
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
              {t('sec.linked.title')}
            </Text>
          </View>
          {oauth.isPending ? (
            <ListSkeleton rows={1} />
          ) : oauth.isError ? (
            <ErrorState error={oauth.error as unknown as ApiError} onRetry={() => void oauth.refetch()} />
          ) : oauth.data.length === 0 ? (
            <Text style={[Typography.body, { color: colors.textMuted }]}>{t('sec.linked.none')}</Text>
          ) : (
            oauth.data.map((account) => (
              <View key={account.id} style={styles.linked}>
                <Text style={[Typography.body, { color: colors.text, fontWeight: '600' }]}>{t('sec.linked.google')}</Text>
                <Text style={[Typography.caption, { color: colors.textMuted }]}>
                  {account.providerEmail ?? t('sec.linked.noEmail')}
                  {account.createdAt ? ` · ${t('sec.linked.since')} ${formatDateTime(account.createdAt)}` : ''}
                </Text>
              </View>
            ))
          )}
          <Text style={[Typography.caption, { color: colors.textSubtle }]}>{t('sec.linked.webNote')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <MonitorSmartphone size={20} color={colors.primary} />
            <Text accessibilityRole="header" style={[Typography.title, { color: colors.text }]}>
              {t('sec.sessions.title')}
            </Text>
          </View>
          <Text style={[Typography.body, { color: colors.textMuted }]}>{t('sec.sessions.desc')}</Text>

          {sessions.isLoading ? (
            <ListSkeleton rows={2} />
          ) : sessions.isError ? (
            <ErrorState error={sessions.error as unknown as ApiError} onRetry={() => void sessions.refetch()} />
          ) : !sessionPage || sessionPage.items.length === 0 ? (
            <EmptyState title={t('sec.sessions.empty')} />
          ) : (
            <>
              {sessionPage.items.map((session) => {
                const device = describeUserAgent(session.userAgent);
                const name = [device.browser, device.os].filter(Boolean).join(' · ') || t('sec.session.unknown');
                return (
                  <View
                    key={session.id}
                    testID={`auth-session-${session.id}`}
                    style={[styles.session, { borderColor: colors.border, backgroundColor: colors.cardSecondary }]}
                  >
                    <View style={styles.sessionText}>
                      <Text style={[Typography.body, { color: colors.text, fontWeight: '600' }]}>{name}</Text>
                      <Text style={[Typography.caption, { color: colors.textMuted }]}>
                        {t('sec.session.lastUsed')}: {formatRelativeTime(session.lastUsedAt ?? session.createdAt, language)}
                      </Text>
                      {session.current ? (
                        <Text style={[Typography.caption, { color: colors.success, fontWeight: '700' }]}>
                          {t('sec.session.current')}
                        </Text>
                      ) : null}
                    </View>
                    {session.current ? null : (
                      <Button
                        variant="danger"
                        label={t('sec.session.signOut')}
                        disabled={busy}
                        onPress={() => setConfirm({ kind: 'one', id: session.id, current: false })}
                      />
                    )}
                  </View>
                );
              })}
              {sessionPage.totalPages > 1 ? (
                <View style={styles.pager}>
                  <Button
                    variant="secondary"
                    label={t('sec.page.prev')}
                    disabled={!sessions.hasPreviousPage || busy}
                    onPress={() => sessions.setPage(Math.max(0, sessions.page - 1))}
                  />
                  <Text style={[Typography.caption, { color: colors.textMuted }]}>
                    {sessionPage.page + 1}/{sessionPage.totalPages}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t('sec.page.next')}
                    disabled={!sessions.hasNextPage || busy}
                    onPress={() => sessions.setPage(sessions.page + 1)}
                  />
                </View>
              ) : null}
              {hasOthers ? (
                <Button
                  testID="auth-sessions-sign-out-others"
                  variant="danger"
                  label={t('sec.others.button')}
                  busy={revokeOthers.isPending}
                  onPress={() => setConfirm({ kind: 'others' })}
                />
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      <Sheet visible={passwordOpen} onClose={closePassword} title={t('sec.pw.change')}>
        <Text style={[Typography.body, { color: colors.textMuted }]}>{t('sec.pw.note')}</Text>
        <TextField
          testID="change-password-current"
          label={t('sec.pw.current')}
          secure
          value={currentPassword}
          onChangeText={(v) => {
            setCurrentPassword(v);
            setFieldErrors((e) => ({ ...e, currentPassword: undefined }));
          }}
          error={localizeValidation(fieldErrors.currentPassword)}
        />
        <TextField
          testID="change-password-new"
          label={t('sec.pw.new')}
          hint={t('sec.pw.newHint')}
          secure
          value={newPassword}
          onChangeText={(v) => {
            setNewPassword(v);
            setFieldErrors((e) => ({ ...e, newPassword: undefined }));
          }}
          error={localizeValidation(fieldErrors.newPassword)}
        />
        <TextField
          testID="change-password-confirm"
          label={t('sec.pw.confirm')}
          secure
          value={confirmPassword}
          onChangeText={(v) => {
            setConfirmPassword(v);
            setFieldErrors((e) => ({ ...e, confirmPassword: undefined }));
          }}
          error={localizeValidation(fieldErrors.confirmPassword)}
        />
        {formError ? (
          <Text accessibilityRole="alert" style={[Typography.caption, { color: colors.danger }]}>
            {formError}
          </Text>
        ) : null}
        <Button label={t('sec.pw.submit')} busy={changing} onPress={() => void handleChangePassword()} />
      </Sheet>

      <ConfirmSheet
        visible={confirm !== null}
        title={t(confirm?.kind === 'others' ? 'sec.others.title' : 'sec.session.signOutTitle')}
        message={t(confirm?.kind === 'others' ? 'sec.others.message' : 'sec.session.signOutMessage')}
        confirmLabel={t(confirm?.kind === 'others' ? 'sec.others.button' : 'sec.session.signOut')}
        destructive
        busy={busy}
        onConfirm={() => void handleConfirm()}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.three, paddingBottom: Spacing.five },
  card: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.lg },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  linked: { gap: Spacing.half },
  session: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderRadius: Radius.md },
  sessionText: { gap: Spacing.half },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
