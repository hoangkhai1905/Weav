import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { getStoredAuthToken } from '../api/ocr.api';
import { showSuccessToast } from '../lib/feedback/toast';
import { captureNotificationSession } from '../lib/notifications/session';
import { useNotificationMilestoneRefresh } from '../hooks/useNotificationMilestoneRefresh';

export function GoogleOAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAuthStore((state) => state.setUser);
  const { t } = useI18nStore();
  const refreshNotifications = useNotificationMilestoneRefresh();
  const [error, setError] = useState('');
  const exchangeRef = useRef<ReturnType<typeof authApi.completeGoogleLogin> | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!exchangeRef.current) {
      accessTokenRef.current = getStoredAuthToken();
      exchangeRef.current = authApi.completeGoogleLogin({
        transactionId: searchParams.get('transaction_id') ?? '',
        handoffCode: searchParams.get('handoff_code') ?? '',
        error: searchParams.get('oauth_error') ?? undefined,
      });
    }

    let active = true;
    void (async () => {
      try {
        const session = await exchangeRef.current;
        if (!session) return;
        if (!active) return;
        if (session.outcome === 'LOGIN') {
          setUser(session.user);
          navigate('/dashboard', { replace: true });
        } else {
          if (accessTokenRef.current && getStoredAuthToken() === accessTokenRef.current) {
            showSuccessToast('toast.google.linked');
            refreshNotifications(captureNotificationSession());
          }
          navigate('/settings/profile', { replace: true });
        }
      } catch {
        if (!active) return;
        setError(t('auth.google_callback_failed'));
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, refreshNotifications, searchParams, setUser, t]);

  if (error) {
    return (
      <main className="min-h-screen grid place-items-center bg-subtle px-6">
        <section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-pop">
          <h1 className="text-xl font-bold text-foreground">
            {t('auth.google_callback_failed')}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
          <Link
            to="/login"
            className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary"
          >
            {t('forgot.back_to_sign_in')}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center bg-subtle px-6">
      <div className="flex items-center gap-3 text-sm font-medium text-text-2">
        <LoaderCircle className="animate-spin" size={20} />
        {t('auth.google_callback_loading')}
      </div>
    </main>
  );
}
