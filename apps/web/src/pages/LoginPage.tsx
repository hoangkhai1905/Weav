import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles, Globe } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { authApi, isAuthMockMode } from '../api/auth.api';
import { AuthLayout } from '../components/auth/AuthLayout';
import { BTN_LG, BTN_PRIMARY, BTN_SECONDARY, INPUT_LG, LINK } from '../lib/uiClasses';

export function LoginPage() {
  const navigate = useNavigate();
  const { loginMock, setUser } = useAuthStore();
  const { t } = useI18nStore();

  const [email, setEmail] = useState(
    isAuthMockMode ? 'truong@example.com' : '',
  );
  const [password, setPassword] = useState(isAuthMockMode ? 'password123' : '');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const session = await authApi.login(email, password);
      setUser(session.user);
      navigate('/dashboard');
    } catch {
      setError(t('auth.login_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      await authApi.startGoogleLogin();
    } catch {
      setGoogleLoading(false);
      setError(t('auth.google_start_failed'));
    }
  };

  const handleQuickDemo = () => {
    loginMock();
    navigate('/dashboard');
  };

  return (
    <AuthLayout>
      <div className="flex w-full max-w-[380px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">{t('auth.sign_in')}</h1>
          <p className="text-text-2">{t('auth.login_lead')}</p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-err-bg px-3 py-2 text-sm text-err">
            {error}
          </p>
        )}

        {!isAuthMockMode && (
          <>
            <button
              onClick={handleGoogleLogin}
              type="button"
              disabled={loading || googleLoading}
              className={`${BTN_SECONDARY} ${BTN_LG}`}
            >
              <Globe size={18} strokeWidth={1.75} aria-hidden="true" />
              {googleLoading ? t('auth.connecting_google') : t('auth.continue_google')}
            </button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t('auth.or_email')}
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t('auth.email')}</span>
            <input
              type="email"
              aria-label={t('auth.email')}
              autoComplete="email"
              required
              placeholder={t('auth.email_placeholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_LG}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px] font-medium">
              <label htmlFor="login-password">{t('auth.password')}</label>
              <Link to="/forgot-password" className={`${LINK} text-[13px]`}>
                {t('auth.forgot_password')}
              </Link>
            </div>
            <input
              id="login-password"
              type="password"
              aria-label={t('auth.password')}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_LG}
            />
          </div>

          <button type="submit" disabled={loading || googleLoading} className={`${BTN_PRIMARY} ${BTN_LG}`}>
            {loading ? t('auth.logging_in') : t('auth.sign_in')}
          </button>
        </form>

        {isAuthMockMode && (
          <button onClick={handleQuickDemo} type="button" className={`${BTN_SECONDARY} ${BTN_LG}`}>
            <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('auth.quick_demo')}
          </button>
        )}

        <p className="text-center text-text-2">
          {t('auth.no_account')}{' '}
          <Link to="/register" className={LINK}>
            {t('auth.register_now')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
