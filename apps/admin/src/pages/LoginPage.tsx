import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { login, NotAdminError } from '../api/auth';
import { ApiError } from '../api/client';
import { LanguageSwitch, ThemeToggle } from '../components/layout/ShellControls';
import { useT } from '../lib/i18n';
import { getProfile } from '../lib/session';
import { btnPrimaryCls, CARD, inputCls } from '../lib/ui';

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (getProfile() && !busy) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrorKey(null);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof NotAdminError) setErrorKey('login.error.not_admin');
      // Wrong password and a disabled account look the same on purpose.
      else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setErrorKey('login.error.credentials');
      else setErrorKey('login.error.generic');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex justify-end gap-1.5 p-4">
        <LanguageSwitch />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <form onSubmit={submit} className={`${CARD} w-full max-w-sm space-y-4 p-6`}>
          <div>
            <p className="text-sm font-semibold text-accent-ink">{t('brand.name')}</p>
            <h1 className="mt-1 text-xl font-semibold">{t('login.title')}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('login.subtitle')}</p>
          </div>
          {errorKey && (
            <div role="alert" className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-[13px] text-err">
              {t(errorKey)}
            </div>
          )}
          <label className="block text-[13px] font-medium">
            {t('login.email')}
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputCls} mt-1 font-normal`}
            />
          </label>
          <label className="block text-[13px] font-medium">
            {t('login.password')}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls} mt-1 font-normal`}
            />
          </label>
          <button type="submit" disabled={busy} className={btnPrimaryCls}>
            {busy ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
