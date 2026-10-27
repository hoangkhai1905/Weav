import { Navigate, useNavigate } from 'react-router-dom';
import { isAuthMockMode } from '../api/auth.api';
import { AuthLayout } from '../components/auth/AuthLayout';
import { EmailVerifyInline } from '../components/auth/EmailVerifyInline';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';

/** Step after sign-up: verify the e-mail now (needed to accept workspace invitations) or skip. */
export function VerifyEmailPage() {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAuthMockMode || user?.emailVerifiedAt) return <Navigate to="/dashboard" replace />;

  return (
    <AuthLayout>
      <div className="flex w-full max-w-[380px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">{t('settings.verify_email')}</h1>
          <p className="text-text-2">
            {t('verify.page_intro')}{user ? ` ${user.email}` : ''}
          </p>
        </div>
        {user && <EmailVerifyInline autoSend onVerified={() => navigate('/dashboard')} onSkip={() => navigate('/dashboard')} />}
      </div>
    </AuthLayout>
  );
}
