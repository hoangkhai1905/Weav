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
          <span className="flex size-8 items-center justify-center rounded-lg border border-run/30 bg-run-bg text-run"><HelpCircle size={17} aria-hidden="true" /></span>
          <h1 className="text-xl font-bold text-foreground">{t('nav.help')}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-text-2">{t('help.subtitle')}</p>
      </motion.div>

      <motion.div variants={itemMotion} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <motion.article variants={itemMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="group rounded-2xl border border-border bg-card p-6 transition-colors">
          <div className="flex items-start justify-between"><span className="flex size-10 items-center justify-center rounded-xl bg-run-bg text-run"><BookOpen size={20} aria-hidden="true" /></span><ArrowUpRight size={16} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></div>
          <h2 className="mt-5 text-sm font-bold text-foreground">{t('help.frontend_title')}</h2>
          <p className="mt-2 text-xs leading-5 text-text-2">{t('help.frontend_description')}</p>
          <motion.a
            href="file:///d:/End/Weav/docs/development/FRONTEND_GUIDE.md"
            target="_blank"
            rel="noreferrer"
            variants={buttonPress}
            whileHover="hover"
            whileTap="tap"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-run outline-none transition-colors hover:text-run focus-visible:ring-2 focus-visible:ring-run/30"
          >
            <span>{t('help.open_guide')}</span>
            <ExternalLink size={13} />
          </motion.a>
        </motion.article>

        <motion.article variants={itemMotion} whileHover={prefersReducedMotion ? undefined : { y: -2, transition: { duration: 0.15 } }} className="group rounded-2xl border border-border bg-card p-6 transition-colors">
          <div className="flex items-start justify-between"><span className="flex size-10 items-center justify-center rounded-xl bg-ok-bg text-ok"><Code size={20} aria-hidden="true" /></span><ArrowUpRight size={16} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" /></div>
          <h2 className="mt-5 text-sm font-bold text-foreground">{t('help.specification_title')}</h2>
          <p className="mt-2 text-xs leading-5 text-text-2">{t('help.specification_description')}</p>
          <motion.a
            href="file:///d:/End/Weav/apps/RULE.md"
            target="_blank"
            rel="noreferrer"
            variants={buttonPress}
            whileHover="hover"
            whileTap="tap"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold text-ok outline-none transition-colors hover:text-ok focus-visible:ring-2 focus-visible:ring-ok/30"
          >
            <span>{t('help.open_specification')}</span>
            <ExternalLink size={13} />
          </motion.a>
        </motion.article>
      </motion.div>

      <motion.section variants={itemMotion} className="flex items-start gap-3 rounded-2xl border border-run/30 bg-run-bg p-4">
        <CircleHelp size={17} className="mt-0.5 shrink-0 text-run" aria-hidden="true" />
        <div><h2 className="text-xs font-bold text-run">{t('help.starting_point')}</h2><p className="mt-1 text-xs leading-5 text-run">{t('help.starting_point_description')}</p></div>
      </motion.section>
    </motion.div>
  );
}
