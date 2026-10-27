import { useEffect, useRef, useState } from 'react';
import { authApi, getAuthApiErrorStatus, getAuthApiRetryAfter } from '../../api/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { useI18nStore } from '../../store/useI18nStore';

interface EmailVerifyInlineProps {
  /** Request the code as soon as the component mounts (skipped when a live code from this session exists). */
  autoSend?: boolean;
  onVerified?: () => void;
  /** Renders a "Later" button when given. */
  onSkip?: () => void;
}

interface StoredChallenge {
  challengeId: string;
  retryAt: number;
  expiresAt: number;
}

const DEFAULT_COOLDOWN_SECONDS = 60;
const storageKey = (userId: string) => `weav_email_verify_${userId}`;

function readChallenge(userId: string | undefined): StoredChallenge | null {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    const value = raw ? (JSON.parse(raw) as Partial<StoredChallenge>) : null;
    if (value && typeof value.challengeId === 'string' && typeof value.retryAt === 'number' && typeof value.expiresAt === 'number' && value.expiresAt > Date.now()) {
      return value as StoredChallenge;
    }
    sessionStorage.removeItem(storageKey(userId));
  } catch {
    // Storage unavailable: the code simply is not remembered across reloads.
  }
  return null;
}

function writeChallenge(userId: string | undefined, value: StoredChallenge | null) {
  if (!userId) return;
  try {
    if (value) sessionStorage.setItem(storageKey(userId), JSON.stringify(value));
    else sessionStorage.removeItem(storageKey(userId));
  } catch {
    // See readChallenge.
  }
}

/** Request a 6-digit e-mail code, enter it, and refresh the current user. Shared by Settings, sign-up and Invitations. */
export function EmailVerifyInline({ autoSend = false, onVerified, onSkip }: EmailVerifyInlineProps) {
  const { t } = useI18nStore();
  const setUser = useAuthStore((state) => state.setUser);
  const userId = useAuthStore((state) => state.user?.id);
  const [stored] = useState(() => readChallenge(userId));
  const [challengeId, setChallengeId] = useState(stored?.challengeId ?? '');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Deadlines (epoch ms) from the receipt: when a resend is allowed and when the code expires.
  const [retryAt, setRetryAt] = useState(stored?.retryAt ?? 0);
  const [expiresAt, setExpiresAt] = useState(stored?.expiresAt ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const [sendCount, setSendCount] = useState(0);
  const autoSent = useRef(Boolean(stored));
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!challengeId && retryAt <= Date.now()) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challengeId, retryAt]);

  useEffect(() => {
    if (sendCount > 0 || stored) codeInput.current?.focus();
  }, [sendCount, stored]);

  const requestCode = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const receipt = await authApi.requestEmailVerification();
      const sentAt = Date.now();
      const next = { challengeId: receipt.challengeId, retryAt: sentAt + receipt.retryAfter * 1000, expiresAt: sentAt + receipt.expiresIn * 1000 };
      writeChallenge(userId, next);
      setChallengeId(next.challengeId);
      setCode('');
      setNow(sentAt);
      setRetryAt(next.retryAt);
      setExpiresAt(next.expiresAt);
      setSendCount((count) => count + 1);
      setMessage(`${t('settings.verification_sent')} ${receipt.expiresIn} ${t('settings.seconds')}`);
    } catch (err) {
      if (getAuthApiErrorStatus(err) === 429) {
        const startedAt = Date.now();
        setNow(startedAt);
        setRetryAt(startedAt + (getAuthApiRetryAfter(err) ?? DEFAULT_COOLDOWN_SECONDS) * 1000);
      }
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
    } catch (err) {
      const status = getAuthApiErrorStatus(err);
      setError(status === 400 || status === 401 ? t('verify.wrong_code') : err instanceof Error ? err.message : t('settings.verification_error'));
      setLoading(false);
      return;
    }
    // The e-mail is verified on the server from here on; a failed user refresh must not undo that.
    writeChallenge(userId, null);
    setChallengeId('');
    setCode('');
    setRetryAt(0);
    setMessage(t('settings.email_verified'));
    try {
      const refreshed = await authApi.getCurrentUser();
      if (refreshed) setUser(refreshed);
    } catch {
      // Ignored: the next /me load picks up emailVerifiedAt.
    }
    setLoading(false);
    onVerified?.();
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
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!loading && code.length === 6 && !expired) void verify();
          }}
        >
          <input
            ref={codeInput}
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
            type="submit"
            disabled={loading || code.length !== 6 || expired}
            className="rounded-xl bg-ok px-3 py-2 text-xs font-semibold text-background disabled:opacity-60"
          >
            {loading ? t('settings.verifying') : t('settings.verify')}
          </button>
        </form>
      )}
      <div role="status" aria-live="polite">
        {message && !expired && <p className="text-xs font-medium text-ok">{message}</p>}
      </div>
      {(error || expired) && (
        <p role="alert" className="text-xs font-medium text-err">{error || t('verify.expired')}</p>
      )}
    </div>
  );
}
