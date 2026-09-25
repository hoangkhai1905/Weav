import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { authApi, getAuthApiErrorStatus } from '../api/auth.api';
import { useI18nStore } from '../store/useI18nStore';

type RecoveryStep = 'request' | 'verify';
type RecoveryPhase = 'request' | 'verify' | 'reset';

interface OtpReceipt {
  challengeId: string;
  expiresIn: number;
  retryAfter: number;
}

class RecoveryProtocolError extends Error {
  constructor() {
    super('The recovery service returned an invalid response.');
  }
}

function isOtpReceipt(value: unknown): value is OtpReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<OtpReceipt>;
  return (
    typeof receipt.challengeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(receipt.challengeId) &&
    typeof receipt.expiresIn === 'number' && Number.isInteger(receipt.expiresIn) && receipt.expiresIn > 0 &&
    typeof receipt.retryAfter === 'number' && Number.isInteger(receipt.retryAfter) && receipt.retryAfter >= 0
  );
}

function recoveryErrorMessage(error: unknown, phase: RecoveryPhase, t: (key: string) => string): string {
  if (error instanceof RecoveryProtocolError) {
    return t('forgot.error.protocol');
  }

  const status = getAuthApiErrorStatus(error);
  if (status === 400) {
    if (phase === 'request') return t('forgot.error.invalid_email');
    if (phase === 'verify') return t('forgot.error.code_invalid');
    return t('forgot.error.reset_invalid');
  }
  if (status === 429) return t('forgot.error.rate_limited');
  if (status === 401 || status === 403) return t('forgot.error.request_invalid');
  if (status === 502 || status === 503) return t('forgot.error.unavailable');
  return t('forgot.error.failed');
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { t } = useI18nStore();
  const [step, setStep] = useState<RecoveryStep>('request');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (cooldownUntil === null || cooldownUntil <= Date.now()) return undefined;

    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const isCurrentOperation = (operation: number) => (
    mountedRef.current && operationRef.current === operation
  );

  const requestCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (pendingRef.current || (step === 'verify' && cooldownRemaining > 0)) return;

    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError(t('forgot.error.invalid_email'));
      return;
    }

    const operation = ++operationRef.current;
    pendingRef.current = true;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const receipt = await authApi.requestPasswordReset(normalizedEmail);
      if (!isCurrentOperation(operation) || !isOtpReceipt(receipt)) {
        if (isCurrentOperation(operation)) throw new RecoveryProtocolError();
        return;
      }
      setEmail(normalizedEmail);
      setStep('verify');
      setChallengeId(receipt.challengeId);
      setExpiresIn(receipt.expiresIn);
      setCooldownUntil(Date.now() + receipt.retryAfter * 1000);
      setCooldownRemaining(receipt.retryAfter);
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage(t('forgot.request_generic'));
    } catch (requestError) {
      if (isCurrentOperation(operation)) setError(recoveryErrorMessage(requestError, 'request', t));
    } finally {
      if (isCurrentOperation(operation)) {
        pendingRef.current = false;
        setLoading(false);
      }
    }
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pendingRef.current) return;
    if (!/^\d{6}$/.test(code)) {
      setError(t('forgot.error.code_required'));
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 72) {
      setError(t('forgot.error.password_length'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('forgot.error.password_mismatch'));
      return;
    }

    const operation = ++operationRef.current;
    pendingRef.current = true;
    setLoading(true);
    setError('');
    setMessage('');
    let phase: RecoveryPhase = 'verify';
    try {
      const verification = await authApi.verifyOtp(challengeId, code);
      if (!isCurrentOperation(operation)) return;
      if (
        verification?.purpose !== 'PASSWORD_RESET' ||
        typeof verification.resetToken !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(verification.resetToken)
      ) {
        throw new RecoveryProtocolError();
      }

      phase = 'reset';
      await authApi.resetPassword(verification.resetToken, newPassword);
      if (!isCurrentOperation(operation)) return;
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      navigate('/login', { replace: true, state: { message: t('forgot.password_reset_success') } });
    } catch (resetError) {
      if (isCurrentOperation(operation)) setError(recoveryErrorMessage(resetError, phase, t));
    } finally {
      if (isCurrentOperation(operation)) {
        pendingRef.current = false;
        setLoading(false);
      }
    }
  };

  const startOver = () => {
    if (loading) return;
    operationRef.current += 1;
    setStep('request');
    setChallengeId('');
    setExpiresIn(null);
    setCooldownUntil(null);
    setCooldownRemaining(0);
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setMessage('');
    setError('');
  };

  return (
    <main data-testid="password-recovery-page" className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-600"><ArrowLeft size={14} />{t('forgot.back_to_sign_in')}</Link>
        <div className="mt-6 flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"><ShieldCheck size={22} /></div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900 dark:text-slate-100">{t('forgot.title')}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('forgot.subtitle')}</p>

        {step === 'request' ? (
          <form onSubmit={(event) => void requestCode(event)} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-email">{t('forgot.email')}</label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 dark:border-slate-700 dark:bg-slate-800"><Mail size={15} className="text-slate-400" /><input id="reset-email" aria-label={t('forgot.email')} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" /></div>
            <button data-testid="request-reset-button" type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{loading && <LoaderCircle size={16} className="animate-spin" />}{t('forgot.request_code')}</button>
          </form>
        ) : (
          <form onSubmit={(event) => void resetPassword(event)} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-code">{t('forgot.verification_code')}</label>
            <input id="reset-code" aria-label={t('forgot.verification_code')} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('forgot.code_placeholder')} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800" />
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-new-password">{t('forgot.new_password')}</label>
            <input id="reset-new-password" aria-label={t('forgot.new_password')} required minLength={8} maxLength={72} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800" />
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="reset-confirm-password">{t('forgot.confirm_password')}</label>
            <input id="reset-confirm-password" aria-label={t('forgot.confirm_password')} required minLength={8} maxLength={72} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-800" />
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('forgot.code_help')} {expiresIn !== null && `${expiresIn} ${t('forgot.seconds')}`}</p>
            <button data-testid="complete-reset-button" type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{loading && <LoaderCircle size={16} className="animate-spin" />}{t('forgot.reset_password')}</button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button data-testid="resend-reset-button" type="button" disabled={loading || cooldownRemaining > 0} onClick={() => void requestCode()} className="font-semibold text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
                {cooldownRemaining > 0 ? t('forgot.resend_unavailable') : t('forgot.resend')}
              </button>
              <button type="button" disabled={loading} onClick={startOver} className="font-semibold text-slate-500 hover:text-blue-600 disabled:cursor-not-allowed">{t('forgot.use_different_email')}</button>
            </div>
            <p data-testid="cooldown-message" className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
              {cooldownRemaining > 0 ? `${t('forgot.cooldown_prefix')} ${cooldownRemaining} ${t('forgot.cooldown_suffix')}` : t('forgot.resend_available')}
            </p>
          </form>
        )}
        {message && <p className="mt-4 text-xs font-medium text-emerald-600 dark:text-emerald-300">{message}</p>}
        {error && <p role="alert" className="mt-4 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
      </section>
    </main>
  );
}
