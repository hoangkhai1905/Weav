import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Sun, Moon, Globe } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { useI18nStore } from '../store/useI18nStore';
import { authApi } from '../api/auth.api';
import { AnimatedWorkflowShowcase } from '../components/auth/AnimatedWorkflowShowcase';
import { Logo } from '../components/common/Logo';

export function RegisterPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const { theme, toggleTheme } = useUIStore();
  const { language, toggleLanguage, t } = useI18nStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const session = await authApi.register(email, name, password);
      setUser(session.user);
      navigate('/dashboard');
    } catch {
      setError(t('auth.registration_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-subtle text-foreground flex flex-col justify-between p-4 md:p-8 relative overflow-hidden select-none transition-colors duration-300">
      {/* Background Ambient Glows */}

      {/* Top Controls: Language & Theme Switcher */}
      <header className="w-full max-w-6xl mx-auto flex items-center justify-between z-20 shrink-0 mb-4">
        <Logo />

        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleLanguage}
            aria-label={language === 'VI' ? t('topbar.switch_to_english') : t('topbar.switch_to_vietnamese')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-subtle border border-border rounded-xl text-xs font-bold text-text-2 transition-all cursor-pointer"
          >
            <Globe size={14} className="text-run" />
            <span>{language === 'VI' ? '🇻🇳 VI' : '🇬🇧 EN'}</span>
          </button>

          <button
            onClick={toggleTheme}
            aria-label={theme === 'light' ? t('common.light_theme') : t('common.dark_theme')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-subtle border border-border rounded-xl text-xs font-bold text-text-2 transition-all cursor-pointer"
          >
            {theme === 'light' ? (
              <>
                <Sun size={15} className="text-warn" />
                <span>{t('common.light_theme')}</span>
              </>
            ) : (
              <>
                <Moon size={15} className="text-run" />
                <span>{t('common.dark_theme')}</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Grid Container */}
      <div className="w-full max-w-6xl mx-auto flex-1 flex items-center justify-center relative z-10 py-2">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column (Order 1): Animated Interactive Showcase */}
          <motion.div
            layout
            layoutId="auth-showcase-panel"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="hidden lg:block lg:col-span-6 order-1"
          >
            <AnimatedWorkflowShowcase />
          </motion.div>

          {/* Right Column (Order 2): Register Form */}
          <motion.div
            layout
            layoutId="auth-form-card"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="lg:col-span-6 order-2 bg-card border border-border rounded-3xl p-8 shadow-pop flex flex-col justify-between space-y-6"
          >
            <div>
              <div className="space-y-1.5 mb-6">
                <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
                  {t('auth.create_account')}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {t('auth.register_intro')}
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="mb-3 text-sm text-err"
                >
                  {error}
                </p>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-text-2 mb-1">
                    {t('auth.full_name')}
                  </label>
                  <input
                    type="text"
                    aria-label={t('auth.full_name')}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('auth.name_placeholder')}
                    className="w-full px-3.5 py-2.5 bg-subtle border border-border rounded-xl text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-run/30 focus:ring-1 focus:ring-run/30 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-2 mb-1">
                    {t('auth.email')}
                  </label>
                  <input
                    type="email"
                    aria-label={t('auth.email')}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.email_placeholder')}
                    className="w-full px-3.5 py-2.5 bg-subtle border border-border rounded-xl text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-run/30 focus:ring-1 focus:ring-run/30 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-2 mb-1">
                    {t('auth.password')}
                  </label>
                  <input
                    type="password"
                    aria-label={t('auth.password')}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 bg-subtle border border-border rounded-xl text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-run/30 focus:ring-1 focus:ring-run/30 transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-primary text-white text-xs font-bold rounded-xl shadow-pop transition-all flex items-center justify-center gap-2 cursor-pointer border border-run/30 mt-2"
                >
                  <span>{loading ? t('auth.creating_account') : t('auth.create_account_submit')}</span>
                  <ArrowRight size={16} />
                </button>
              </form>
            </div>

            <div className="pt-4 border-t border-border text-center text-xs text-muted-foreground">
              {t('auth.already_account')}{' '}
              <Link
                to="/login"
                className="text-run font-bold hover:underline"
              >
                {t('auth.sign_in')}
              </Link>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Footer copyright */}
      <footer className="w-full text-center text-[11px] text-muted-foreground z-20 shrink-0 pt-2">
        {t('auth.footer')}
      </footer>
    </div>
  );
}
