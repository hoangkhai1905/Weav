import { Link } from 'react-router-dom';
import { Bell, Menu, Moon, Search, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';

export function Topbar() {
  const { searchQuery, setSearchQuery, theme, toggleTheme, toggleMobileSidebar } = useUIStore();
  const { language, toggleLanguage, t } = useI18nStore();

  return (
    <header className="z-20 flex h-14 shrink-0 select-none items-center justify-between border-b border-border bg-card px-4 text-foreground transition-colors duration-200">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobileSidebar}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label={t('topbar.open_navigation')}
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span>{t('topbar.home')}</span>
          <span className="text-border">/</span>
          <span className="font-semibold text-foreground">{t('nav.dashboard')}</span>
        </div>
      </div>

      <div className="relative hidden w-64 items-center sm:flex md:w-80">
        <Search size={14} className="pointer-events-none absolute left-3 text-muted-foreground" />
        <input
          type="text"
          placeholder={t('topbar.search_placeholder')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-12 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:bg-card focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <div className="absolute right-2.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          ⌘ K
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="hidden cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted lg:flex">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold">WEAV Workspace · Prod</span>
          <span className="font-mono text-[11px] text-muted-foreground">↕</span>
        </div>

        <button
          onClick={toggleLanguage}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={language === 'VI' ? t('topbar.switch_to_english') : t('topbar.switch_to_vietnamese')}
          aria-label={language === 'VI' ? t('topbar.switch_to_english') : t('topbar.switch_to_vietnamese')}
        >
          {language === 'VI' ? 'VI' : 'EN'}
        </button>

        <button
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer overflow-hidden"
          title={t('topbar.toggle_theme')}
          aria-label={t('topbar.toggle_theme')}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={theme}
              initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              {theme === 'light' ? <Sun size={16} className="text-amber-500" /> : <Moon size={16} className="text-blue-400" />}
            </motion.div>
          </AnimatePresence>
        </button>

        <Link
          to="/notifications"
          className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t('nav.notifications')}
          aria-label={t('nav.notifications')}
        >
          <Bell size={17} />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
        </Link>

        <div className="ml-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-sm">
          NT
        </div>
      </div>
    </header>
  );
}
