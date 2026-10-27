import { useEffect, useRef, useState } from 'react';
import { authApi } from '../../api/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { useI18nStore } from '../../store/useI18nStore';

interface EmailVerifyInlineProps {
  /** Request the code as soon as the component mounts. */
  autoSend?: boolean;
  onVerified?: () => void;
  /** Renders a "Later" button when given. */
  onSkip?: () => void;
}

/** Request a 6-digit e-mail code, enter it, and refresh the current user. Shared by Settings, sign-up and Invitations. */
export function EmailVerifyInline({ autoSend = false, onVerified, onSkip }: EmailVerifyInlineProps) {
  const { t } = useI18nStore();
  const setUser = useAuthStore((state) => state.setUser);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Deadlines (epoch ms) from the receipt: when a resend is allowed and when the code expires.
  const [retryAt, setRetryAt] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const autoSent = useRef(false);

  useEffect(() => {
    if (!challengeId) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challengeId]);

  const requestCode = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const receipt = await authApi.requestEmailVerification();
      const sentAt = Date.now();
      setChallengeId(receipt.challengeId);
      setCode('');
      setNow(sentAt);
      setRetryAt(sentAt + receipt.retryAfter * 1000);
      setExpiresAt(sentAt + receipt.expiresIn * 1000);
      setMessage(`${t('settings.verification_sent')} ${receipt.expiresIn} ${t('settings.seconds')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.verification_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoSend || autoSent.current) return;
    autoSent.current = true;
    void requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [autoSend]);

  const verify = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const result = await authApi.verifyOtp(challengeId, code);
      if (result.purpose !== 'EMAIL_VERIFICATION') throw new Error(t('settings.verification_error'));
      const refreshed = await authApi.getCurrentUser();
      if (refreshed) setUser(refreshed);
      setChallengeId('');
      setCode('');
      setRetryAt(0);
      setMessage(t('settings.email_verified'));
      onVerified?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.verification_error'));
    } finally {
      setLoading(false);
    }
  };

  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const expired = Boolean(challengeId) && now >= expiresAt;
  const sendLabel = loading && !challengeId
    ? t('settings.sending')
    : challengeId
      ? t('verify.resend')
      : t('settings.send_code');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void requestCode()}
          disabled={loading || cooldown > 0}
          className="rounded-xl border border-run/30 px-3 py-2 text-xs font-semibold text-run hover:bg-run-bg disabled:opacity-60"
        >
          {sendLabel}
          {cooldown > 0 ? ` (${cooldown}s)` : ''}
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="rounded-xl px-3 py-2 text-xs font-semibold text-text-2 hover:bg-subtle"
          >
            {t('verify.later')}
          </button>
        )}
      </div>
      {challengeId && (
        <div className="flex gap-2">
          <input
            aria-label={t('settings.code_placeholder')}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t('settings.code_placeholder')}
            className="min-w-0 flex-1 rounded-xl border border-border bg-subtle px-3 py-2 text-xs"
          />
          <button
            type="button"
            onClick={() => void verify()}
            disabled={loading || code.length !== 6 || expired}
            className="rounded-xl bg-ok px-3 py-2 text-xs font-semibold text-background disabled:opacity-60"
          >
            {loading ? t('settings.verifying') : t('settings.verify')}
          </button>
        </div>
      )}
      <div role="status" aria-live="polite">
        {message && <p className="text-xs font-medium text-ok">{message}</p>}
      </div>
      {(error || expired) && (
        <p role="alert" className="text-xs font-medium text-err">{error || t('verify.expired')}</p>
      )}
    </div>
  );
}
