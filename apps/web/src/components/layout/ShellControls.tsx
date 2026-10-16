import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { FOCUS_RING, ICON_BTN } from '../../lib/uiClasses';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';

/** VI / EN segmented switch, shared by the app top bar, the auth pages and the landing page. */
export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18nStore();
  return (
    <div role="group" aria-label={t('topbar.language')} className="inline-flex overflow-hidden rounded-md border border-border-strong">
      {(['VI', 'EN'] as const).map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={language === code}
          aria-label={language === code ? undefined : code === 'EN' ? t('topbar.switch_to_english') : t('topbar.switch_to_vietnamese')}
          onClick={() => setLanguage(code)}
          className={`h-[30px] px-2.5 text-xs font-semibold transition-colors ${FOCUS_RING} focus-visible:ring-offset-0 ${
            language === code ? 'bg-subtle text-foreground' : 'text-text-2 hover:bg-muted'
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

/** Moon in light mode, sun in dark mode: the icon shows where a click goes. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useUIStore();
  const { t } = useI18nStore();
  return (
    <button type="button" onClick={toggleTheme} className={ICON_BTN} title={t('topbar.toggle_theme')} aria-label={t('topbar.toggle_theme')}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={theme}
          initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
          transition={{ duration: 0.15 }}
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        </motion.div>
      </AnimatePresence>
    </button>
  );
}
