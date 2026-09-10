import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/useAuthStore';

export function GoogleOAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAuthStore((state) => state.setUser);
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;
    void (async () => {
      try {
        const session = await authApi.completeGoogleLogin({
          transactionId: searchParams.get('transaction_id') ?? '',
          handoffCode: searchParams.get('handoff_code') ?? '',
          error: searchParams.get('oauth_error') ?? undefined,
        });
        if (!active) return;
        setUser(session.user);
        navigate('/dashboard', { replace: true });
      } catch (callbackError) {
        if (!active) return;
        setError(
          callbackError instanceof Error
            ? callbackError.message
            : 'Google sign-in could not be completed.',
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, searchParams, setUser]);

  if (error) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50 px-6 dark:bg-slate-950">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Google sign-in failed
          </h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{error}</p>
          <Link
            to="/login"
            className="mt-6 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Back to sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-6 dark:bg-slate-950">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
        <LoaderCircle className="animate-spin" size={20} />
        Completing Google sign-in…
      </div>
    </main>
  );
}
