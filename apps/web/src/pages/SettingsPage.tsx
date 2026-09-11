import { useEffect, useState } from 'react';
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
import { authApi, isAuthMockMode, type IdentitySessionView, type OAuthAccountMetadata } from '../api/auth.api';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { useUIStore } from '../store/useUIStore';
import { buttonPress, pageVariants, reducedMotionVariants } from '../lib/motion';

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

export function SettingsPage() {
  const { user, setUser, logout } = useAuthStore();
  const { language, setLanguage, t } = useI18nStore();
  const { theme, setTheme } = useUIStore();
  const [name, setName] = useState(user?.name || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [sessions, setSessions] = useState<IdentitySessionView[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionAction, setSessionAction] = useState<string | null>(null);

  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccountMetadata[]>([]);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState('');
  const [oauthPassword, setOauthPassword] = useState('');
  const [oauthAction, setOauthAction] = useState<string | null>(null);

  const [verificationChallenge, setVerificationChallenge] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verificationLoading, setVerificationLoading] = useState(false);

  const prefersReducedMotion = useReducedMotion();
  const pageMotion = prefersReducedMotion ? reducedMotionVariants : pageVariants;
  const statusLabel = user?.status === 'DISABLED' ? t('settings.status_disabled') : t('settings.status_active');
  const roleLabel = user?.systemRole === 'ADMIN' ? t('settings.role_admin') : t('settings.role_user');

  useEffect(() => {
    setName(user?.name || '');
  }, [user?.id, user?.name]);

  useEffect(() => {
    if (isAuthMockMode) return;
    let active = true;
    setSessionsLoading(true);
    setOauthLoading(true);
    void Promise.allSettled([authApi.listSessions(), authApi.listOAuthAccounts()]).then(
      ([sessionResult, oauthResult]) => {
        if (!active) return;
        if (sessionResult.status === 'fulfilled') {
          setSessions(sessionResult.value.items);
          setSessionsError('');
        } else {
          setSessionsError(t('settings.sessions_error'));
        }
        if (oauthResult.status === 'fulfilled') {
          setOauthAccounts(oauthResult.value);
          setOauthError('');
        } else {
          setOauthError(t('settings.oauth_unavailable'));
        }
        setSessionsLoading(false);
        setOauthLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileMessage('');
    setProfileError('');
    try {
      const updated = isAuthMockMode
        ? { ...user!, name: name.trim() || user?.email || '' }
        : await authApi.updateProfile(name.trim() || null);
      setUser(updated);
      setProfileMessage(t('settings.saved'));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t('settings.save_error'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMessage('');
    setPasswordError('');
    if (newPassword.length < 8) {
      setPasswordError(t('settings.password_min'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.password_mismatch'));
      return;
    }
    setChangingPassword(true);
    try {
      if (!isAuthMockMode) await authApi.changePassword(currentPassword, newPassword);
      setPasswordMessage(t('settings.password_changed'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      window.setTimeout(() => {
        logout();
        window.location.assign('/login');
      }, 900);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t('settings.password_error'));
    } finally {
      setChangingPassword(false);
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

  const revokeSession = async (session: IdentitySessionView) => {
    setSessionAction(session.id);
    setSessionsError('');
    try {
      await authApi.revokeSession(session.id);
      if (session.current) {
        logout();
        window.location.assign('/login');
        return;
      }
      setSessions((items) => items.filter((item) => item.id !== session.id));
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : t('settings.sessions_error'));
    } finally {
      setSessionAction(null);
    }
  };

  const revokeAllSessions = async () => {
    setSessionAction('all');
    setSessionsError('');
    try {
      await authApi.revokeAllSessions();
      logout();
      window.location.assign('/login');
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : t('settings.sessions_error'));
    } finally {
      setSessionAction(null);
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
            <input id="profile-name" type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="profile-email">{t('settings.email')}</label>
            <input id="profile-email" type="email" value={user?.email || ''} readOnly className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{t('settings.role')}: <strong className="text-slate-700 dark:text-slate-200">{roleLabel}</strong></span>
            <span>{t('settings.email')}: <strong className={user?.emailVerifiedAt ? 'text-emerald-600' : 'text-amber-600'}>{user?.emailVerifiedAt ? t('settings.verified') : t('settings.unverified')}</strong></span>
          </div>
          <motion.button onClick={() => void handleSaveProfile()} disabled={savingProfile} variants={buttonPress} whileHover="hover" whileTap="tap" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"><Save size={14} />{savingProfile ? t('settings.saving') : t('settings.save')}</motion.button>
          {profileMessage && <SuccessText>{profileMessage}</SuccessText>}
          {profileError && <ErrorText>{profileError}</ErrorText>}
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
          <input aria-label={t('settings.current_password')} type="password" placeholder={t('settings.current_password')} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
          <input aria-label={t('settings.new_password')} type="password" placeholder={t('settings.new_password')} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
          <input aria-label={t('settings.confirm_password')} type="password" placeholder={t('settings.confirm_password')} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={() => void handleChangePassword()} disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><KeyRound size={14} />{changingPassword ? t('settings.changing_password') : t('settings.change_password')}</button>{passwordMessage && <SuccessText>{passwordMessage}</SuccessText>}{passwordError && <ErrorText>{passwordError}</ErrorText>}</div>

        <div className="mt-6 border-t border-slate-200 pt-6 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('settings.active_sessions')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.active_sessions_desc')}</p></div><button onClick={() => void revokeAllSessions()} disabled={sessionsLoading || sessionAction === 'all' || isAuthMockMode} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-400/30 dark:text-rose-300"><LogOut size={14} />{t('settings.revoke_all')}</button></div>
          {sessionsLoading && <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin" />{t('settings.loading_sessions')}</div>}
          {!sessionsLoading && sessions.length === 0 && !sessionsError && <p className="mt-4 text-xs text-slate-500">{t('settings.no_sessions')}</p>}
          <div className="mt-4 space-y-2">{sessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800"><div className="flex min-w-0 items-center gap-2.5"><MonitorSmartphone size={16} className="shrink-0 text-slate-500" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{session.userAgent || t('settings.unknown_device')} {session.current && <span className="ml-1 text-emerald-600">({t('settings.current')})</span>}</p><p className="text-[11px] text-slate-500">{t('settings.last_used')} {formatDate(session.lastUsedAt, language)} · {t('settings.expires')} {formatDate(session.expiresAt, language)}</p></div></div><button onClick={() => void revokeSession(session)} disabled={sessionAction === session.id} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">{sessionAction === session.id ? t('settings.revoking') : t('settings.revoke')}</button></div>)}</div>
          {sessionsError && <div className="mt-3"><ErrorText>{sessionsError}</ErrorText></div>}
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
