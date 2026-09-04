import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Settings, User, Shield, Save, CheckCircle2, KeyRound } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useI18nStore } from '../store/useI18nStore';
import { buttonPress, pageVariants, reducedMotionVariants } from '../lib/motion';

export function SettingsPage() {
  const { user } = useAuthStore();
  const { t } = useI18nStore();
  const [name, setName] = useState(user?.name || 'Nguyễn Anh Xuân Trường');
  const [email, setEmail] = useState(user?.email || 'truong@example.com');
  const [password, setPassword] = useState('••••••••••••');
  const [saved, setSaved] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const pageMotion = prefersReducedMotion ? reducedMotionVariants : pageVariants;

  const handleSave = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  };

  return (
    <motion.div data-testid="settings-profile-page" className="mx-auto max-w-4xl space-y-6 pb-10" initial="initial" animate="animate" variants={pageMotion}>
      <motion.div variants={pageMotion}>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300"><Settings size={17} aria-hidden="true" /></span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('nav.settings')}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-slate-400">Manage user profile details and security credentials.</p>
      </motion.div>

      <motion.section variants={pageMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><User size={16} className="text-blue-600 dark:text-blue-300" aria-hidden="true" /> Profile information</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Update the identity shown across your workspace.</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300 sm:inline-flex"><CheckCircle2 size={12} /> Synced</span>
        </div>

        <div className="mt-5 max-w-lg space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="profile-name">Full Name</label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="profile-email">Email Address</label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <motion.button
            onClick={handleSave}
            variants={buttonPress}
            whileHover="hover"
            whileTap="tap"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-700"
          >
            <Save size={14} />
            <span>{saved ? 'Saved' : 'Save Profile'}</span>
          </motion.button>
        </div>

        <div className="mt-6 max-w-lg space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Shield size={16} className="text-emerald-600 dark:text-emerald-300" aria-hidden="true" /> Security</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Keep account access protected with a strong credential.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="profile-password">Password</label>
            <input
              id="profile-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300"><KeyRound size={14} className="text-emerald-600 dark:text-emerald-300" /> Password changes are audited in workspace security logs.</div>
        </div>
      </motion.section>
    </motion.div>
  );
}
