import { motion, useReducedMotion } from 'framer-motion';
import { HelpCircle, BookOpen, ExternalLink, Code, ArrowUpRight, CircleHelp } from 'lucide-react';
import { useI18nStore } from '../store/useI18nStore';
import { buttonPress, pageVariants, reducedMotionVariants, staggerItem } from '../lib/motion';

export function HelpPage() {
  const { t } = useI18nStore();
  const prefersReducedMotion = useReducedMotion();
  const pageMotion = prefersReducedMotion ? reducedMotionVariants : pageVariants;
  const itemMotion = prefersReducedMotion ? reducedMotionVariants : staggerItem;

  return (
    <motion.div data-testid="help-page" className="mx-auto max-w-5xl space-y-6 pb-10" initial="initial" animate="animate" variants={pageMotion}>
      <motion.div variants={itemMotion}>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300"><HelpCircle size={17} aria-hidden="true" /></span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('nav.help')}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-slate-400">Documentation guides and node reference for WEAV V1.</p>
      </motion.div>

      <motion.div variants={itemMotion} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <motion.article variants={itemMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
          <div className="flex items-start justify-between"><span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300"><BookOpen size={20} aria-hidden="true" /></span><ArrowUpRight size={16} className="text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></div>
          <h2 className="mt-5 text-sm font-bold text-slate-900 dark:text-slate-100">Frontend & Agent Skills Guide</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Learn how to build React 19 components, execute Playwright E2E tests, and generate UI specs.</p>
          <motion.a
            href="file:///d:/End/Weav/docs/development/FRONTEND_GUIDE.md"
            target="_blank"
            rel="noreferrer"
            variants={buttonPress}
            whileHover="hover"
            whileTap="tap"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-blue-600 outline-none transition-colors hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:text-blue-300 dark:hover:text-blue-200"
          >
            <span>Open Guide</span>
            <ExternalLink size={13} />
          </motion.a>
        </motion.article>

        <motion.article variants={itemMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900 dark:shadow-xl">
          <div className="flex items-start justify-between"><span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"><Code size={20} aria-hidden="true" /></span><ArrowUpRight size={16} className="text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></div>
          <h2 className="mt-5 text-sm font-bold text-slate-900 dark:text-slate-100">Specification & Rules</h2>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Read complete product specifications for WEAV V1 AI Workflow Automation Platform.</p>
          <motion.a
            href="file:///d:/End/Weav/apps/RULE.md"
            target="_blank"
            rel="noreferrer"
            variants={buttonPress}
            whileHover="hover"
            whileTap="tap"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-emerald-600 outline-none transition-colors hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-300 dark:hover:text-emerald-200"
          >
            <span>Open Specification</span>
            <ExternalLink size={13} />
          </motion.a>
        </motion.article>
      </motion.div>

      <motion.section variants={itemMotion} className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-400/20 dark:bg-blue-400/10">
        <CircleHelp size={17} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" aria-hidden="true" />
        <div><h2 className="text-xs font-bold text-blue-950 dark:text-blue-100">Need a starting point?</h2><p className="mt-1 text-xs leading-5 text-blue-800/80 dark:text-blue-100/70">Start with the frontend guide for local development, then use the specification to validate workflow changes.</p></div>
      </motion.section>
    </motion.div>
  );
}
