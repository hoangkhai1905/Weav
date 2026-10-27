import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { authApi, getAuthApiErrorStatus, getAuthApiFieldErrors, isAuthMockMode } from '../api/auth.api';
import { AuthLayout } from '../components/auth/AuthLayout';
import { BTN_LG, BTN_PRIMARY, INPUT_LG, LINK } from '../lib/uiClasses';

export function RegisterPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const { t } = useI18nStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // Same rule as Identity: 8-72 characters and at most 72 UTF-8 bytes.
    if (password.length < 8 || password.length > 72 || new TextEncoder().encode(password).length > 72) {
      setFieldErrors({ password: t('w5c.password_rule') });
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      const session = await authApi.register(email, name, password);
      setUser(session.user);
      navigate(session.user.emailVerifiedAt || isAuthMockMode ? '/dashboard' : '/verify-email');
    } catch (err) {
      const server = getAuthApiFieldErrors(err);
      const mapped: Record<string, string> = {};
      if (server.password) mapped.password = t('w5c.password_rule');
      if (server.email) mapped.email = t('w5c.email_invalid');
      if (server.displayName) mapped.name = t('w5c.name_too_long');
      if (getAuthApiErrorStatus(err) === 409) mapped.email = t('w5c.email_taken');
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
      else setError(err instanceof Error && getAuthApiErrorStatus(err) !== 400 ? err.message : t('auth.registration_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="flex w-full max-w-[380px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">{t('auth.create_account')}</h1>
          <p className="text-text-2">{t('auth.register_intro')}</p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-err-bg px-3 py-2 text-sm text-err">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-name" className="text-[13px] font-medium">{t('auth.full_name')}</label>
            <input
              id="reg-name"
              type="text"
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? 'reg-err-name' : undefined}
              aria-label={t('auth.full_name')}
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.name_placeholder')}
              className={INPUT_LG}
            />
            {fieldErrors.name && <p id="reg-err-name" role="alert" className="text-xs text-err">{fieldErrors.name}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-email" className="text-[13px] font-medium">{t('auth.email')}</label>
            <input
              id="reg-email"
              type="email"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'reg-err-email' : undefined}
              aria-label={t('auth.email')}
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.email_placeholder')}
              className={INPUT_LG}
            />
            {fieldErrors.email && <p id="reg-err-email" role="alert" className="text-xs text-err">{fieldErrors.email}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reg-password" className="text-[13px] font-medium">{t('auth.password')}</label>
            <input
              id="reg-password"
              type="password"
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? 'reg-err-password' : undefined}
              aria-label={t('auth.password')}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_LG}
            />
            {fieldErrors.password && <p id="reg-err-password" role="alert" className="text-xs text-err">{fieldErrors.password}</p>}
          </div>

          <button type="submit" disabled={loading} className={`${BTN_PRIMARY} ${BTN_LG}`}>
            {loading ? t('auth.creating_account') : t('auth.create_account_submit')}
          </button>
        </form>

        <p className="text-center text-text-2">
          {t('auth.already_account')}{' '}
          <Link to="/login" className={LINK}>
            {t('auth.sign_in')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
