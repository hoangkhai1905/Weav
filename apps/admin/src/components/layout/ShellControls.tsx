import { Moon, Sun } from 'lucide-react';
import { setLang, toggleTheme, useLang, useT, useTheme } from '../../lib/i18n';
import { iconBtnCls } from '../../lib/ui';

/** VI / EN segmented switch, shared by the top bar and the sign-in page. */
export function LanguageSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <div role="group" aria-label={t('topbar.language')} className="inline-flex overflow-hidden rounded-md border border-border-strong">
      {(['VI', 'EN'] as const).map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          className={`h-[30px] px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            lang === code ? 'bg-subtle text-foreground' : 'text-text-2 hover:bg-muted'
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
  const theme = useTheme();
  const t = useT();
  return (
    <button type="button" onClick={toggleTheme} className={iconBtnCls} title={t('topbar.toggle_theme')} aria-label={t('topbar.toggle_theme')}>
      {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  );
}
