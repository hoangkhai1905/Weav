import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  CheckCircle2,
  KeyRound,
  Languages,
  Link2,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  Palette,
  Save,
  Settings2,
  Shield,
  User,
} from 'lucide-react';
import { authApi, getAuthApiErrorStatus, isAuthMockMode, type IdentitySessionView, type OAuthAccountMetadata } from '../api/auth.api';
import { ConfirmButton } from '../components/common/ConfirmButton';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { useUIStore } from '../store/useUIStore';
import { getStoredAuthToken } from '../api/ocr.api';
import { buttonPress, pageVariants, reducedMotionVariants } from '../lib/motion';

const MAX_PROFILE_NAME_LENGTH = 120;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const MAX_PASSWORD_BYTES = 72;
const SESSION_PAGE_SIZE = 20;

interface SessionPageState {
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

interface SettingsLoadState {
  userId: string | null;
  page: number;
  refreshKey: number;
}

function emptySessionPage(): SessionPageState {
  return { page: 0, size: SESSION_PAGE_SIZE, totalItems: 0, totalPages: 0 };
}

function isIdentityPassword(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH
    && value.length <= MAX_PASSWORD_LENGTH
    && new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES;
}

function formatDate(value: string | null | undefined, language: 'VI' | 'EN'): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language === 'VI' ? 'vi-VN' : 'en-US');
}

function ErrorText({ children }: { children: string }) {
  return <p className="text-xs font-medium text-rose-600 dark:text-rose-300">{children}</p>;
}

function SuccessText({ children }: { children: string }) {
  return <p className="text-xs font-medium text-emerald-600 dark:text-emerald-300">{children}</p>;
}

function sessionErrorMessage(error: unknown, translate: (key: string) => string): string {
  const status = getAuthApiErrorStatus(error);
  switch (status) {
    case 401:
      return translate('settings.sessions_auth_error');
    case 403:
      return translate('settings.sessions_forbidden');
    case 404:
      return translate('settings.session_not_found');
    case 429:
      return translate('settings.sessions_rate_limited');
    case 502:
    case 503:
      return translate('settings.sessions_unavailable');
    case 0:
    case null:
      return translate('settings.sessions_network_error');
    default:
      return translate('settings.sessions_error');
  }
}

export function SettingsPage() {
  const { user, isAuthenticated, setUser, logout } = useAuthStore();
  const { language, setLanguage, t } = useI18nStore();
  const { theme, setTheme } = useUIStore();
  const [profileDraft, setProfileDraft] = useState<{ userId: string | null; value: string; dirty: boolean }>(() => ({
    userId: user?.id ?? null,
    value: user?.name || '',
    dirty: false,
  }));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const passwordRequestInFlight = useRef(false);

  const [sessions, setSessions] = useState<IdentitySessionView[]>([]);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [sessionActionOwner, setSessionActionOwner] = useState<{ userId: string; token: string | null } | null>(null);
  const [sessionPageInfo, setSessionPageInfo] = useState<SessionPageState>(emptySessionPage);
  const [sessionPageUserId, setSessionPageUserId] = useState<string | null>(() => user?.id ?? null);
  const [sessionPageIndex, setSessionPageIndex] = useState(0);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const sessionMutationSequence = useRef(0);
  const sessionMutationRef = useRef<{ id: number; userId: string; token: string | null } | null>(null);

  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccountMetadata[]>([]);
  const [oauthError, setOauthError] = useState('');
  const [oauthPassword, setOauthPassword] = useState('');
  const [oauthAction, setOauthAction] = useState<string | null>(null);

  const [verificationChallenge, setVerificationChallenge] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [settingsLoadState, setSettingsLoadState] = useState<SettingsLoadState | null>(() => (
    isAuthMockMode ? { userId: null, page: 0, refreshKey: 0 } : null
  ));

  const prefersReducedMotion = useReducedMotion();
  const pageMotion = prefersReducedMotion ? reducedMotionVariants : pageVariants;
  const statusLabel = user?.status === 'DISABLED' ? t('settings.status_disabled') : t('settings.status_active');
  const roleLabel = user?.systemRole === 'ADMIN' ? t('settings.role_admin') : t('settings.role_user');
  const currentUserId = user?.id ?? null;
  const requestedSessionPage = sessionPageUserId === currentUserId ? sessionPageIndex : 0;
  const name = profileDraft.userId === currentUserId && profileDraft.dirty
    ? profileDraft.value
    : user?.name || '';
  const profileLoading = !isAuthMockMode && isAuthenticated && !user;
  const sessionsLoaded = settingsLoadState?.userId === currentUserId
    && settingsLoadState.page === requestedSessionPage
    && settingsLoadState.refreshKey === sessionRefreshKey;
  const sessionsLoading = !isAuthMockMode && !sessionsLoaded;
  const oauthLoading = !isAuthMockMode && settingsLoadState?.userId !== currentUserId;
  const visibleSessions = sessionsLoaded ? sessions : [];
  const visibleSessionPageInfo = sessionsLoaded ? sessionPageInfo : emptySessionPage();
  const visibleSessionsError = sessionsLoaded ? sessionsError : '';
  const currentSessionAction = sessionsLoaded
    && sessionActionOwner?.userId === currentUserId
    && sessionActionOwner.token === getStoredAuthToken()
    ? sessionAction
    : null;
  const hasCurrentSessionMutation = () => {
    const mutation = sessionMutationRef.current;
    return mutation?.userId === currentUserId && mutation.token === getStoredAuthToken();
  };

  useEffect(() => {
    if (isAuthMockMode || !isAuthenticated || !currentUserId) return;
    let active = true;
    const requestUserId = currentUserId;
    const requestPage = requestedSessionPage;
    const requestRefreshKey = sessionRefreshKey;
    const requestToken = getStoredAuthToken();
    const isCurrentRequest = () => {
      const currentState = useAuthStore.getState();
      return active
        && currentState.isAuthenticated
        && currentState.user?.id === requestUserId
        && getStoredAuthToken() === requestToken;
    };

    void Promise.allSettled([
      authApi.listSessions(requestPage, SESSION_PAGE_SIZE),
      authApi.listOAuthAccounts(),
    ]).then(
      ([sessionResult, oauthResult]) => {
        if (!isCurrentRequest()) return;
        if (sessionResult.status === 'fulfilled') {
          setSessions(sessionResult.value.items);
          setSessionsError('');
          const totalPages = Math.max(sessionResult.value.totalPages, 0);
          const normalizedPage = totalPages === 0
            ? 0
            : Math.min(Math.max(sessionResult.value.page, 0), totalPages - 1);
          setSessionPageInfo({
            page: normalizedPage,
            size: sessionResult.value.size,
            totalItems: sessionResult.value.totalItems,
            totalPages,
          });
          setSessionPageUserId(requestUserId);
          setSessionPageIndex(normalizedPage);
        } else {
          setSessionsError(sessionErrorMessage(sessionResult.reason, t));
        }
        if (oauthResult.status === 'fulfilled') {
          setOauthAccounts(oauthResult.value);
          setOauthError('');
        } else {
          setOauthError(t('settings.oauth_unavailable'));
        }
        setSettingsLoadState({ userId: requestUserId, page: requestPage, refreshKey: requestRefreshKey });
      },
    );
    return () => {
      active = false;
    };
  }, [currentUserId, isAuthenticated, requestedSessionPage, sessionRefreshKey, t]);

  const handleSaveProfile = async () => {
    const currentUser = user;
    if (!currentUser || profileLoading) return;

    if (name.length > MAX_PROFILE_NAME_LENGTH) {
      setProfileMessage('');
      setProfileError(t('settings.profile_name_too_long'));
      return;
    }

    const requestUserId = currentUser.id;
    const requestToken = getStoredAuthToken();
    setSavingProfile(true);
    setProfileMessage('');
    setProfileError('');
    try {
      const displayName = name.trim() || null;
      const updated = isAuthMockMode
        ? { ...currentUser, name: displayName || currentUser.email }
        : await authApi.updateProfile(displayName);

      const currentState = useAuthStore.getState();
      if (
        !currentState.isAuthenticated ||
        currentState.user?.id !== requestUserId ||
        getStoredAuthToken() !== requestToken
      ) {
        return;
      }

      setProfileDraft({ userId: updated.id, value: updated.name, dirty: false });
      setUser(updated);
      setProfileMessage(t('settings.saved'));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t('settings.save_error'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    const currentUser = user;
    if (!currentUser || !isAuthenticated || passwordRequestInFlight.current) return;

    setPasswordMessage('');
    setPasswordError('');
    if (!isIdentityPassword(currentPassword) || !isIdentityPassword(newPassword)) {
      setPasswordError(t('settings.password_length'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.password_mismatch'));
      return;
    }

    const requestUserId = currentUser.id;
    const requestToken = getStoredAuthToken();
    const isCurrentRequest = () => {
      const currentState = useAuthStore.getState();
      return currentState.isAuthenticated
        && currentState.user?.id === requestUserId
        && getStoredAuthToken() === requestToken;
    };

    passwordRequestInFlight.current = true;
    setChangingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      if (!isCurrentRequest()) return;

      setPasswordMessage(t('settings.password_changed'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      logout();
    } catch (error) {
      if (isCurrentRequest()) {
        setPasswordError(error instanceof Error ? error.message : t('settings.password_error'));
      }
    } finally {
      passwordRequestInFlight.current = false;
      if (isCurrentRequest()) setChangingPassword(false);
    }
  };

  const requestEmailVerification = async () => {
    setVerificationError('');
    setVerificationMessage('');
    setVerificationLoading(true);
    try {
      const receipt = await authApi.requestEmailVerification();
      setVerificationChallenge(receipt.challengeId);
      setVerificationMessage(`${t('settings.verification_sent')} ${receipt.expiresIn} ${t('settings.seconds')}`);
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : t('settings.verification_error'));
    } finally {
      setVerificationLoading(false);
    }
  };

  const verifyEmail = async () => {
    setVerificationError('');
    setVerificationMessage('');
    setVerificationLoading(true);
    try {
      const result = await authApi.verifyOtp(verificationChallenge, verificationCode);
      if (result.purpose !== 'EMAIL_VERIFICATION') throw new Error(t('settings.verification_error'));
      const refreshed = await authApi.getCurrentUser();
      if (refreshed) setUser(refreshed);
      setVerificationChallenge('');
      setVerificationCode('');
      setVerificationMessage(t('settings.email_verified'));
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : t('settings.verification_error'));
    } finally {
      setVerificationLoading(false);
    }
  };

  const retrySessions = () => {
    if (isAuthMockMode || currentSessionAction !== null || hasCurrentSessionMutation()) return;
    setSessionsError('');
    setSessionRefreshKey((value) => value + 1);
  };

  const goToSessionPage = (page: number) => {
    if (
      isAuthMockMode
      || sessionsLoading
      || currentSessionAction !== null
      || hasCurrentSessionMutation()
      || page < 0
      || page >= visibleSessionPageInfo.totalPages
    ) return;
    setSessionsError('');
    setSessionPageUserId(currentUserId);
    setSessionPageIndex(page);
  };

  const revokeSession = async (session: IdentitySessionView) => {
    const currentUser = user;
    if (
      !currentUser
      || !isAuthenticated
      || isAuthMockMode
      || currentSessionAction !== null
      || hasCurrentSessionMutation()
    ) return;

    const requestUserId = currentUser.id;
    const requestToken = getStoredAuthToken();
    const mutationId = ++sessionMutationSequence.current;
    const isCurrentRequest = () => {
      const currentState = useAuthStore.getState();
      return currentState.isAuthenticated
        && currentState.user?.id === requestUserId
        && getStoredAuthToken() === requestToken;
    };

    sessionMutationRef.current = { id: mutationId, userId: requestUserId, token: requestToken };
    setSessionActionOwner({ userId: requestUserId, token: requestToken });
    setSessionAction(session.id);
    setSessionsError('');
    try {
      await authApi.revokeSession(session.id);
      if (!isCurrentRequest()) return;
      if (session.current) {
        logout();
        return;
      }
      setSessionRefreshKey((value) => value + 1);
    } catch (error) {
      if (isCurrentRequest()) setSessionsError(sessionErrorMessage(error, t));
    } finally {
      if (sessionMutationRef.current?.id === mutationId) {
        sessionMutationRef.current = null;
        setSessionActionOwner(null);
        if (isCurrentRequest()) setSessionAction(null);
      }
    }
  };

  const revokeAllSessions = async () => {
    const currentUser = user;
    if (
      !currentUser
      || !isAuthenticated
      || isAuthMockMode
      || currentSessionAction !== null
      || hasCurrentSessionMutation()
    ) return;

    const requestUserId = currentUser.id;
    const requestToken = getStoredAuthToken();
    const mutationId = ++sessionMutationSequence.current;
    const isCurrentRequest = () => {
      const currentState = useAuthStore.getState();
      return currentState.isAuthenticated
        && currentState.user?.id === requestUserId
        && getStoredAuthToken() === requestToken;
    };

    sessionMutationRef.current = { id: mutationId, userId: requestUserId, token: requestToken };
    setSessionActionOwner({ userId: requestUserId, token: requestToken });
    setSessionAction('all');
    setSessionsError('');
    try {
      await authApi.revokeAllSessions();
      if (!isCurrentRequest()) return;
      logout();
    } catch (error) {
      if (isCurrentRequest()) setSessionsError(sessionErrorMessage(error, t));
    } finally {
      if (sessionMutationRef.current?.id === mutationId) {
        sessionMutationRef.current = null;
        setSessionActionOwner(null);
        if (isCurrentRequest()) setSessionAction(null);
      }
    }
  };

  const linkGoogleAccount = async () => {
    setOauthError('');
    setOauthAction('link');
    try {
      await authApi.startGoogleLink(oauthPassword);
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : t('settings.oauth_error'));
      setOauthAction(null);
    }
  };

  const unlinkGoogleAccount = async (accountId: string) => {
    setOauthError('');
    setOauthAction(accountId);
    try {
      await authApi.unlinkOAuthAccount(accountId, oauthPassword);
      setOauthAccounts((items) => items.filter((item) => item.id !== accountId));
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : t('settings.oauth_error'));
    } finally {
      setOauthAction(null);
    }
  };

  return (
    <motion.div data-testid="settings-profile-page" className="mx-auto max-w-4xl space-y-6 pb-10" initial="initial" animate="animate" variants={pageMotion}>
      <motion.div variants={pageMotion}>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300"><User size={17} aria-hidden="true" /></span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('settings.title')}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-slate-400">{t('settings.subtitle')}</p>
      </motion.div>

      <motion.section variants={pageMotion} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
        <div className="border-b border-slate-200 pb-5 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Settings2 size={16} className="text-blue-600 dark:text-blue-300" aria-hidden="true" /> {t('settings.general')}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.general_desc')}</p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"><Languages size={15} className="text-blue-600 dark:text-blue-300" />{t('settings.language')}</span>
            <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{t('settings.language_desc')}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as 'VI' | 'EN')} className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              <option value="VI">{t('settings.vietnamese')}</option>
              <option value="EN">{t('settings.english')}</option>
            </select>
          </label>
          <label className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <span className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"><Palette size={15} className="text-blue-600 dark:text-blue-300" />{t('settings.appearance')}</span>
            <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{t('settings.appearance_desc')}</span>
            <select value={theme} onChange={(event) => setTheme(event.target.value as 'dark' | 'light')} className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              <option value="light">{t('settings.light')}</option>
              <option value="dark">{t('settings.dark')}</option>
            </select>
          </label>
        </div>
      </motion.section>

      <motion.section variants={pageMotion} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><User size={16} className="text-blue-600 dark:text-blue-300" aria-hidden="true" /> {t('settings.profile')}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.profile_desc')}</p>
          </div>
          {user?.status && <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300"><CheckCircle2 size={12} /> {statusLabel}</span>}
        </div>

        <div className="mt-5 max-w-lg space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="profile-name">{t('auth.full_name')}</label>
            <input id="profile-name" type="text" value={name} onChange={(event) => setProfileDraft({ userId: currentUserId, value: event.target.value, dirty: true })} maxLength={MAX_PROFILE_NAME_LENGTH} disabled={profileLoading || savingProfile} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="profile-email">{t('settings.email')}</label>
            <input id="profile-email" type="email" value={user?.email || ''} readOnly className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{t('settings.role')}: <strong className="text-slate-700 dark:text-slate-200">{roleLabel}</strong></span>
            <span>{t('settings.email')}: <strong className={user?.emailVerifiedAt ? 'text-emerald-600' : 'text-amber-600'}>{user?.emailVerifiedAt ? t('settings.verified') : t('settings.unverified')}</strong></span>
          </div>
          {profileLoading && <p data-testid="profile-loading" className="text-xs font-medium text-slate-500 dark:text-slate-400" aria-live="polite">{t('settings.loading')}</p>}
          <motion.button data-testid="profile-save-button" onClick={() => void handleSaveProfile()} disabled={profileLoading || savingProfile} variants={buttonPress} whileHover="hover" whileTap="tap" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"><Save size={14} />{savingProfile ? t('settings.saving') : t('settings.save')}</motion.button>
          {profileMessage && <SuccessText>{profileMessage}</SuccessText>}
          {profileError && <div data-testid="profile-error"><ErrorText>{profileError}</ErrorText></div>}
        </div>

        {!user?.emailVerifiedAt && !isAuthMockMode && (
          <div className="mt-6 max-w-lg space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('settings.verify_email')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.verify_email_desc')}</p></div><button onClick={() => void requestEmailVerification()} disabled={verificationLoading} className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-blue-400/30 dark:text-blue-300">{verificationLoading ? t('settings.sending') : t('settings.send_code')}</button></div>
            {verificationChallenge && <div className="flex gap-2"><input aria-label={t('settings.code_placeholder')} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder={t('settings.code_placeholder')} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800" /><button onClick={() => void verifyEmail()} disabled={verificationLoading || verificationCode.length !== 6} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{verificationLoading ? t('settings.verifying') : t('settings.verify')}</button></div>}
            {verificationMessage && <SuccessText>{verificationMessage}</SuccessText>}
            {verificationError && <ErrorText>{verificationError}</ErrorText>}
          </div>
        )}
      </motion.section>

      <motion.section variants={pageMotion} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
        <div className="border-b border-slate-200 pb-5 dark:border-slate-800"><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Shield size={16} className="text-emerald-600 dark:text-emerald-300" /> {t('settings.security')}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.security_desc')}</p></div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <input aria-label={t('settings.current_password')} type="password" autoComplete="current-password" maxLength={MAX_PASSWORD_LENGTH} placeholder={t('settings.current_password')} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
          <input aria-label={t('settings.new_password')} type="password" autoComplete="new-password" maxLength={MAX_PASSWORD_LENGTH} placeholder={t('settings.new_password')} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
          <input aria-label={t('settings.confirm_password')} type="password" autoComplete="new-password" maxLength={MAX_PASSWORD_LENGTH} placeholder={t('settings.confirm_password')} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><button data-testid="change-password-button" onClick={() => void handleChangePassword()} disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><KeyRound size={14} />{changingPassword ? t('settings.changing_password') : t('settings.change_password')}</button>{passwordMessage && <div data-testid="password-message"><SuccessText>{passwordMessage}</SuccessText></div>}{passwordError && <div data-testid="password-error"><ErrorText>{passwordError}</ErrorText></div>}</div>

        <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('settings.active_sessions')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.active_sessions_desc')}</p></div><ConfirmButton dataTestId="revoke-all-sessions-button" onConfirm={revokeAllSessions} title={t('settings.revoke_all_title')} description={t('settings.revoke_all_desc')} confirmText={t('settings.confirm')} cancelText={t('settings.cancel')} disabled={sessionsLoading || currentSessionAction !== null || isAuthMockMode} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-400/30 dark:text-rose-300"><LogOut size={14} />{currentSessionAction === 'all' ? t('settings.revoking') : t('settings.revoke_all')}</ConfirmButton></div>
          {sessionsLoading && <div data-testid="sessions-loading" className="mt-4 flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin" />{t('settings.loading_sessions')}</div>}
          {!sessionsLoading && visibleSessions.length === 0 && !visibleSessionsError && <p data-testid="sessions-empty" className="mt-4 text-xs text-slate-500">{t('settings.no_sessions')}</p>}
          <div className="mt-4 space-y-2">{visibleSessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800"><div className="flex min-w-0 items-center gap-2.5"><MonitorSmartphone size={16} className="shrink-0 text-slate-500" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{session.userAgent || t('settings.unknown_device')} {session.current && <span className="ml-1 text-emerald-600">({t('settings.current')})</span>}</p><p className="text-[11px] text-slate-500">{t('settings.last_used')} {formatDate(session.lastUsedAt, language)} · {t('settings.expires')} {formatDate(session.expiresAt, language)}</p></div></div><ConfirmButton dataTestId={`session-revoke-button-${session.id}`} onConfirm={() => revokeSession(session)} title={t('settings.revoke_session_title')} description={t('settings.revoke_session_desc')} confirmText={t('settings.confirm')} cancelText={t('settings.cancel')} disabled={sessionsLoading || currentSessionAction !== null || isAuthMockMode} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">{currentSessionAction === session.id ? t('settings.revoking') : t('settings.revoke')}</ConfirmButton></div>)}</div>
          {visibleSessionPageInfo.totalPages > 1 && <div data-testid="sessions-pagination" className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500"><button data-testid="sessions-previous-page" aria-label={t('settings.previous_page')} onClick={() => goToSessionPage(requestedSessionPage - 1)} disabled={sessionsLoading || currentSessionAction !== null || requestedSessionPage <= 0} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">{t('settings.previous_page')}</button><span>{t('settings.session_page')} {requestedSessionPage + 1} / {visibleSessionPageInfo.totalPages}</span><button data-testid="sessions-next-page" aria-label={t('settings.next_page')} onClick={() => goToSessionPage(requestedSessionPage + 1)} disabled={sessionsLoading || currentSessionAction !== null || requestedSessionPage >= visibleSessionPageInfo.totalPages - 1} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{t('settings.next_page')}</button></div>}
          {visibleSessionsError && <div data-testid="sessions-error" className="mt-3 flex flex-wrap items-center gap-3"><ErrorText>{visibleSessionsError}</ErrorText><button data-testid="sessions-retry" onClick={retrySessions} disabled={sessionsLoading || currentSessionAction !== null || isAuthMockMode} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-blue-300">{t('settings.retry_sessions')}</button></div>}
        </div>
      </motion.section>

      <motion.section variants={pageMotion} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800"><div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Link2 size={16} className="text-blue-600 dark:text-blue-300" /> {t('settings.linked_accounts')}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.linked_accounts_desc')}</p></div><span className="text-xs font-semibold text-slate-500">{oauthLoading ? t('settings.loading') : `${oauthAccounts.length} ${t('settings.linked_count')}`}</span></div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><input aria-label={t('settings.google_action_password')} type="password" placeholder={t('settings.google_action_password')} value={oauthPassword} onChange={(event) => setOauthPassword(event.target.value)} className="w-full max-w-xs rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" /><button onClick={() => void linkGoogleAccount()} disabled={oauthAction === 'link' || isAuthMockMode || !oauthPassword} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Link2 size={14} />{oauthAction === 'link' ? t('settings.opening_google') : t('settings.link_google')}</button></div>
        <div className="mt-4 space-y-2">{oauthAccounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800"><div><p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{account.provider} {account.providerEmail ? `· ${account.providerEmail}` : ''}</p><p className="text-[11px] text-slate-500">{t('settings.linked_at')} {formatDate(account.createdAt, language)}</p></div><button onClick={() => void unlinkGoogleAccount(account.id)} disabled={oauthAction === account.id || !oauthPassword} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">{oauthAction === account.id ? t('settings.unlinking') : t('settings.unlink')}</button></div>)}</div>
        {oauthError && <div className="mt-3"><ErrorText>{oauthError}</ErrorText></div>}
      </motion.section>
    </motion.div>
  );
}
