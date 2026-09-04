import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, Sun, Moon, Globe } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import { useI18nStore } from '../store/useI18nStore';
import { authApi } from '../api/auth.api';
import { AnimatedWorkflowShowcase } from '../components/auth/AnimatedWorkflowShowcase';
import { Logo } from '../components/common/Logo';

export function LoginPage() {
  const navigate = useNavigate();
  const { loginMock } = useAuthStore();
  const { theme, toggleTheme } = useUIStore();
  const { language, toggleLanguage } = useI18nStore();

  const [email, setEmail] = useState('truong@example.com');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.login(email, password);
      loginMock();
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = () => {
    loginMock();
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen w-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 md:p-8 relative overflow-hidden select-none transition-colors duration-300">
      {/* Background Ambient Glows */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-500/10 dark:bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-sky-500/10 dark:bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Controls: Language & Theme Switcher */}
      <header className="w-full max-w-6xl mx-auto flex items-center justify-between z-20 shrink-0 mb-4">
        <Logo />

        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer shadow-sm"
          >
            <Globe size={14} className="text-blue-500" />
            <span>{language === 'VI' ? '🇻🇳 VI' : '🇬🇧 EN'}</span>
          </button>

          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/60 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer shadow-sm"
          >
            {theme === 'light' ? (
              <>
                <Sun size={15} className="text-amber-500" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon size={15} className="text-blue-400" />
                <span>Dark</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Grid Container */}
      <div className="w-full max-w-6xl mx-auto flex-1 flex items-center justify-center relative z-10 py-2">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Column: Login Form */}
          <motion.div
            layout
            layoutId="auth-form-card"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="lg:col-span-6 order-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-xl dark:shadow-2xl backdrop-blur-xl flex flex-col justify-between space-y-6"
          >
            <div>
              <div className="space-y-1.5 mb-6">
                <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Welcome back</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">Sign in to manage workflows, monitor executions & AI nodes.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" defaultChecked className="rounded border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-blue-600" />
                    <span>Remember me</span>
                  </label>
                  <a href="#forgot" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline">
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer border border-blue-400/30"
                >
                  <span>{loading ? 'Logging in...' : 'Sign In'}</span>
                  <ArrowRight size={16} />
                </button>
              </form>

              <div className="relative my-6 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <span className="relative bg-white dark:bg-slate-900 px-3 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  Quick Access
                </span>
              </div>

              <button
                onClick={handleQuickDemo}
                type="button"
                className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles size={16} className="text-blue-500" />
                <span>Quick Demo Login (Nguyễn Anh Xuân Trường)</span>
              </button>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 text-center text-xs text-slate-500 dark:text-slate-400">
              Don't have an account?{' '}
              <Link to="/register" className="text-blue-600 dark:text-blue-400 font-bold hover:underline">
                Register here
              </Link>
            </div>
          </motion.div>

          {/* Right Column: Animated Interactive Showcase */}
          <motion.div
            layout
            layoutId="auth-showcase-panel"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="hidden lg:block lg:col-span-6 order-2"
          >
            <AnimatedWorkflowShowcase />
          </motion.div>
        </div>
      </div>

      {/* Footer copyright */}
      <footer className="w-full text-center text-[11px] text-slate-400 dark:text-slate-500 z-20 shrink-0 pt-2">
        WEAV Automation V1.0 • Built for Modern AI Engineering
      </footer>
    </div>
  );
}
