import React, { useRef, useState } from 'react';
import { Alert, ActivityIndicator, View, Text, StyleSheet, ScrollView, Pressable, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Moon, Sun, Bell, Shield, Info, LogOut, Globe, Lock, RefreshCw } from 'lucide-react-native';
import { useUIStore } from '../../../stores/ui.store';
import { useTranslation } from '../../../hooks/useTranslation';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { expireAuthSession, logoutAuthSession } from '../../../features/auth/auth-session.runtime';
import {
  createChangePasswordSubmissionGate,
  isChangePasswordScopeCurrent,
  type ChangePasswordValidationErrors,
  validateChangePassword,
} from '../../../features/auth/change-password.utils';
import { authRepository } from '../../../infrastructure/repository-factory';
import { useAuthStore } from '../../../stores/auth.store';
import { useAuthSessions } from '../../../features/auth/hooks/useAuthSessions';
import { isAuthSessionScopeCurrent } from '../../../features/auth/session-management.utils';

function formatSessionDate(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function getSessionErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Session service unavailable. Please try again.';
}

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { toggleTheme, showToast } = useUIStore();
  const { language, toggleLanguage, t } = useTranslation();

  const [pushNotifs, setPushNotifs] = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordErrors, setChangePasswordErrors] = useState<ChangePasswordValidationErrors>({});
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const changePasswordGate = useRef(createChangePasswordSubmissionGate());
  const {
    data: sessionPage,
    isLoading: isSessionsLoading,
    isError: isSessionsError,
    error: sessionsError,
    refetch: refetchSessions,
    page: sessionPageIndex,
    setPage: setSessionPage,
    hasPreviousPage,
    hasNextPage,
    revokeSessionMutation,
    revokeAllMutation,
  } = useAuthSessions();

  const isSessionMutationPending = revokeSessionMutation.isPending || revokeAllMutation.isPending;

  const handleLogout = () => {
    void logoutAuthSession();
    router.replace('/(auth)/login');
  };

  const handleToggleLang = () => {
    toggleLanguage();
    showToast({
      type: 'success',
      title: language === 'VI' ? 'Switched to English 🇬🇧' : 'Đã chuyển sang Tiếng Việt 🇻🇳',
      message: language === 'VI' ? 'System language updated to English' : 'Đã cập nhật ngôn ngữ hệ thống sang Tiếng Việt',
    });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  const handleChangePassword = async () => {
    if (!changePasswordGate.current.tryStart()) return;

    const validationErrors = validateChangePassword({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (Object.keys(validationErrors).length > 0) {
      setChangePasswordErrors(validationErrors);
      setChangePasswordError(null);
      changePasswordGate.current.finish();
      return;
    }

    const capturedAuth = useAuthStore.getState();
    const capturedUserId = capturedAuth.user?.id;
    const capturedRefreshToken = capturedAuth.tokens?.refreshToken;
    if (!capturedAuth.isAuthenticated || !capturedUserId || !capturedRefreshToken) {
      setChangePasswordError('Your session is no longer valid. Please sign in again.');
      changePasswordGate.current.finish();
      return;
    }

    setChangePasswordErrors({});
    setChangePasswordError(null);
    setIsChangingPassword(true);

    try {
      await authRepository.changePassword(currentPassword, newPassword);
      const current = useAuthStore.getState();
      if (
        !isChangePasswordScopeCurrent(
          capturedUserId,
          capturedRefreshToken,
          current.user?.id ?? null,
          current.tokens?.refreshToken ?? null,
          current.isAuthenticated,
        )
      ) {
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await expireAuthSession();
      showToast({
        type: 'success',
        title: 'Password changed / Đã đổi mật khẩu',
        message: 'All sessions were revoked. Please sign in again.',
      });
      router.replace('/(auth)/login');
    } catch (error: unknown) {
      const current = useAuthStore.getState();
      if (
        isChangePasswordScopeCurrent(
          capturedUserId,
          capturedRefreshToken,
          current.user?.id ?? null,
          current.tokens?.refreshToken ?? null,
          current.isAuthenticated,
        )
      ) {
        const message =
          typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
            ? error.message
            : 'Password change service unavailable. Please try again.';
        setChangePasswordError(message);
      }
    } finally {
      setIsChangingPassword(false);
      changePasswordGate.current.finish();
    }
  };

  const revokeSession = async (sessionId: string, current: boolean) => {
    const capturedAuth = useAuthStore.getState();
    const capturedUserId = capturedAuth.user?.id ?? null;
    const capturedRefreshToken = capturedAuth.tokens?.refreshToken ?? null;
    const isScopeCurrent = () => isAuthSessionScopeCurrent(
      capturedUserId,
      capturedRefreshToken,
      useAuthStore.getState().user?.id ?? null,
      useAuthStore.getState().tokens?.refreshToken ?? null,
      useAuthStore.getState().isAuthenticated,
    );

    try {
      await revokeSessionMutation.mutateAsync({ sessionId, current });
      if (isScopeCurrent() && !current) {
        showToast({
          type: 'success',
          title: 'Session revoked',
          message: 'The selected session was revoked.',
        });
      }
    } catch (error: unknown) {
      if (isScopeCurrent()) {
        showToast({ type: 'error', title: 'Could not revoke session', message: getSessionErrorMessage(error) });
      }
    }
  };

  const confirmRevokeSession = (sessionId: string, current: boolean) => {
    Alert.alert(
      current ? 'Revoke current session?' : 'Revoke this session?',
      current
        ? 'This session will be revoked and you will need to sign in again.'
        : 'The selected session will be signed out.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => { void revokeSession(sessionId, current); },
        },
      ],
    );
  };

  const revokeAllSessions = async () => {
    const capturedAuth = useAuthStore.getState();
    const capturedUserId = capturedAuth.user?.id ?? null;
    const capturedRefreshToken = capturedAuth.tokens?.refreshToken ?? null;
    try {
      await revokeAllMutation.mutateAsync();
    } catch (error: unknown) {
      if (isAuthSessionScopeCurrent(
        capturedUserId,
        capturedRefreshToken,
        useAuthStore.getState().user?.id ?? null,
        useAuthStore.getState().tokens?.refreshToken ?? null,
        useAuthStore.getState().isAuthenticated,
      )) {
        showToast({ type: 'error', title: 'Could not revoke sessions', message: getSessionErrorMessage(error) });
      }
    }
  };

  const confirmRevokeAllSessions = () => {
    Alert.alert(
      'Revoke all sessions?',
      'This includes the current session. You will need to sign in again on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke all', style: 'destructive', onPress: () => { void revokeAllSessions(); } },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={handleBack}>
          <ArrowLeft color={colors.text} size={20} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Appearance & Language Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.appearance')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Dark Mode Switch */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              {colors.isDark ? <Moon color={colors.primary} size={18} /> : <Sun color="#f59e0b" size={18} />}
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.dark_mode')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                  {colors.isDark ? 'Dark Mode' : 'Light Mode'}
                </Text>
              </View>
            </View>
            <Switch
              value={colors.isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>

          {/* Language Switcher */}
          <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }]}>
            <View style={styles.rowLeft}>
              <Globe color={colors.primary} size={18} />
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.language')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                  {language === 'VI' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
                </Text>
              </View>
            </View>
            <Pressable style={[styles.langBtn, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]} onPress={handleToggleLang}>
              <Text style={[styles.langBtnText, { color: colors.primary }]}>
                {language === 'VI' ? '🇻🇳 VI' : '🇬🇧 EN'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Active Sessions Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>ACTIVE SESSIONS / PHIÊN ĐĂNG NHẬP</Text>
        </View>

        <View testID="auth-sessions-card" style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sessionHeaderRow}>
            <View style={styles.rowLeft}>
              <Shield color={colors.primary} size={18} />
              <View style={styles.sessionHeaderCopy}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>Your sessions</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>Only metadata provided by Identity is shown.</Text>
              </View>
            </View>
            <Pressable
              testID="auth-sessions-revoke-all"
              disabled={isSessionMutationPending || !sessionPage?.items.length}
              onPress={confirmRevokeAllSessions}
              style={[styles.secondaryAction, { borderColor: colors.danger }, (isSessionMutationPending || !sessionPage?.items.length) && styles.disabledButton]}
            >
              <Text style={[styles.secondaryActionText, { color: colors.danger }]}>Revoke all</Text>
            </Pressable>
          </View>

          {isSessionsLoading && (
            <View testID="auth-sessions-loading" style={styles.sessionState}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>Loading sessions…</Text>
            </View>
          )}

          {isSessionsError && !isSessionsLoading && (
            <View testID="auth-sessions-error" style={styles.sessionState}>
              <Text style={[styles.inlineError, { color: colors.danger }]}>{getSessionErrorMessage(sessionsError)}</Text>
              <Pressable
                testID="auth-sessions-retry"
                disabled={isSessionMutationPending}
                onPress={() => { void refetchSessions(); }}
                style={[styles.secondaryAction, { borderColor: colors.primary }, isSessionMutationPending && styles.disabledButton]}
              >
                <RefreshCw color={colors.primary} size={15} />
                <Text style={[styles.secondaryActionText, { color: colors.primary }]}>Retry</Text>
              </Pressable>
            </View>
          )}

          {!isSessionsLoading && !isSessionsError && sessionPage && sessionPage.items.length === 0 && (
            <View testID="auth-sessions-empty" style={styles.sessionState}>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>No active sessions were returned.</Text>
            </View>
          )}

          {!isSessionsLoading && !isSessionsError && sessionPage?.items.map((session) => (
            <View key={session.id} testID={`auth-session-${session.id}`} style={[styles.sessionItem, { borderTopColor: colors.border }]}>
              <View style={styles.sessionItemCopy}>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{session.userAgent || 'Unknown client'}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>Created: {formatSessionDate(session.createdAt)}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>Last used: {formatSessionDate(session.lastUsedAt)}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>Expires: {formatSessionDate(session.expiresAt)}</Text>
                {session.current && <Text style={[styles.currentSessionLabel, { color: colors.success }]}>Current session</Text>}
              </View>
              <Pressable
                testID={`auth-session-revoke-${session.id}`}
                disabled={isSessionMutationPending}
                onPress={() => confirmRevokeSession(session.id, session.current)}
                style={[styles.secondaryAction, { borderColor: colors.danger }, isSessionMutationPending && styles.disabledButton]}
              >
                <Text style={[styles.secondaryActionText, { color: colors.danger }]}>Revoke</Text>
              </Pressable>
            </View>
          ))}

          {!isSessionsLoading && !isSessionsError && sessionPage && sessionPage.totalPages > 1 && (
            <View testID="auth-sessions-pagination" style={[styles.paginationRow, { borderTopColor: colors.border }]}>
              <Pressable
                testID="auth-sessions-previous"
                disabled={!hasPreviousPage || isSessionMutationPending}
                onPress={() => setSessionPage(Math.max(0, sessionPageIndex - 1))}
                style={[styles.secondaryAction, { borderColor: colors.borderStrong }, (!hasPreviousPage || isSessionMutationPending) && styles.disabledButton]}
              >
                <Text style={[styles.secondaryActionText, { color: colors.text }]}>Previous</Text>
              </Pressable>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>Page {sessionPage.page + 1} of {sessionPage.totalPages}</Text>
              <Pressable
                testID="auth-sessions-next"
                disabled={!hasNextPage || isSessionMutationPending}
                onPress={() => setSessionPage(sessionPageIndex + 1)}
                style={[styles.secondaryAction, { borderColor: colors.borderStrong }, (!hasNextPage || isSessionMutationPending) && styles.disabledButton]}
              >
                <Text style={[styles.secondaryActionText, { color: colors.text }]}>Next</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Notifications Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.notifications')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Bell color="#38bdf8" size={18} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.push_alerts')}</Text>
            </View>
            <Switch
              value={pushNotifs}
              onValueChange={(val) => {
                setPushNotifs(val);
                showToast({ type: 'info', title: 'Notification Settings', message: `Push alerts ${val ? 'enabled' : 'disabled'}` });
              }}
              trackColor={{ false: colors.borderStrong, true: '#0ea5e9' }}
              thumbColor="#ffffff"
            />
          </View>

          <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }]}>
            <View style={styles.rowLeft}>
              <Bell color={colors.primary} size={18} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.email_summaries')}</Text>
            </View>
            <Switch
              value={emailNotifs}
              onValueChange={setEmailNotifs}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* Security Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.security')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Shield color={colors.success} size={18} />
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.session_verified')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>{t('settings.session_status')}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Change Password Section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>ĐỔI MẬT KHẨU / CHANGE PASSWORD</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.passwordHeading}>
            <Lock color={colors.primary} size={18} />
            <Text style={[styles.rowLabel, { color: colors.text }]}>Update your local password</Text>
          </View>

          <TextInput
            testID="change-password-current"
            value={currentPassword}
            onChangeText={(value) => {
              setCurrentPassword(value);
              setChangePasswordErrors((errors) => ({ ...errors, currentPassword: undefined }));
              setChangePasswordError(null);
            }}
            placeholder="Current password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.passwordInput, { color: colors.text, borderColor: colors.borderStrong }]}
          />
          {changePasswordErrors.currentPassword && (
            <Text testID="change-password-current-error" style={[styles.inlineError, { color: colors.danger }]}>
              {changePasswordErrors.currentPassword}
            </Text>
          )}

          <TextInput
            testID="change-password-new"
            value={newPassword}
            onChangeText={(value) => {
              setNewPassword(value);
              setChangePasswordErrors((errors) => ({ ...errors, newPassword: undefined }));
              setChangePasswordError(null);
            }}
            placeholder="New password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.passwordInput, { color: colors.text, borderColor: colors.borderStrong }]}
          />
          {changePasswordErrors.newPassword && (
            <Text testID="change-password-new-error" style={[styles.inlineError, { color: colors.danger }]}>
              {changePasswordErrors.newPassword}
            </Text>
          )}

          <TextInput
            testID="change-password-confirm"
            value={confirmPassword}
            onChangeText={(value) => {
              setConfirmPassword(value);
              setChangePasswordErrors((errors) => ({ ...errors, confirmPassword: undefined }));
              setChangePasswordError(null);
            }}
            placeholder="Confirm new password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.passwordInput, { color: colors.text, borderColor: colors.borderStrong }]}
          />
          {changePasswordErrors.confirmPassword && (
            <Text testID="change-password-confirm-error" style={[styles.inlineError, { color: colors.danger }]}>
              {changePasswordErrors.confirmPassword}
            </Text>
          )}

          {changePasswordError && (
            <Text testID="change-password-error" style={[styles.inlineError, { color: colors.danger }]}>
              {changePasswordError}
            </Text>
          )}

          <Pressable
            testID="change-password-submit"
            disabled={isChangingPassword}
            onPress={() => { void handleChangePassword(); }}
            style={[
              styles.changePasswordBtn,
              { backgroundColor: colors.primary },
              isChangingPassword && styles.disabledButton,
            ]}
          >
            <Text style={styles.changePasswordText}>
              {isChangingPassword ? 'Changing…' : 'Change password'}
            </Text>
          </Pressable>
        </View>

        {/* About App */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>{t('settings.about')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Info color={colors.textMuted} size={18} />
              <View>
                <Text style={[styles.rowLabel, { color: colors.text }]}>{t('settings.system_ver')}</Text>
                <Text style={[styles.rowSub, { color: colors.textMuted }]}>React Native 0.86 • Expo 57 • Bilingual i18n</Text>
              </View>
            </View>
          </View>
        </View>

        <Pressable style={[styles.logoutBtn, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]} onPress={handleLogout}>
          <LogOut color={colors.danger} size={18} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>{t('settings.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: '800', marginLeft: 10 },
  scrollContent: { padding: 18, paddingBottom: 40, gap: 14 },
  sectionHeader: { marginTop: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  passwordHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 11, marginTop: 2 },
  sessionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  sessionHeaderCopy: { flex: 1 },
  sessionState: { alignItems: 'center', gap: 10, paddingVertical: 14 },
  sessionItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderTopWidth: 1, paddingTop: 12 },
  sessionItemCopy: { flex: 1, gap: 1 },
  currentSessionLabel: { fontSize: 11, fontWeight: '800', marginTop: 3 },
  secondaryAction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secondaryActionText: { fontSize: 11, fontWeight: '800' },
  paginationRow: { borderTopWidth: 1, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  passwordInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inlineError: { fontSize: 12, lineHeight: 17 },
  changePasswordBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  changePasswordText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  langBtnText: { fontSize: 12, fontWeight: '800' },
  logoutBtn: { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 },
  logoutText: { fontSize: 14, fontWeight: '700' },
});
