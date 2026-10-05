import { Link, useLocation } from 'react-router-dom';
import { Bell, Menu, Moon, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';
import { useNotificationUnreadCount } from '../../hooks/useNotifications';
import { useAuthStore } from '../../store/useAuthStore';

const getTopbarPageKey = (pathname: string) => {
  if (pathname.startsWith('/workflows')) return 'nav.workflows';
  if (pathname.startsWith('/executions')) return 'nav.executions';
  if (pathname.startsWith('/connections')) return 'nav.connections';
  if (pathname.startsWith('/workspace')) return 'nav.workspace';
  if (pathname.startsWith('/ai')) return 'nav.ai_generator';
  if (pathname.startsWith('/telegram')) return 'nav.telegram';
  if (pathname.startsWith('/notifications')) return 'nav.notifications';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  if (pathname.startsWith('/help')) return 'nav.help';
  return 'nav.dashboard';
};

export function Topbar() {
  const { theme, toggleTheme, toggleMobileSidebar } = useUIStore();
  const { language, toggleLanguage, t } = useI18nStore();
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const { data: unreadCount = 0, isError: unreadError } = useNotificationUnreadCount();
  const currentPageKey = getTopbarPageKey(location.pathname);
  const profileName = user?.displayName?.trim() || user?.name?.trim() || user?.email || 'Account';
  const profileInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <header className="z-20 flex h-12 shrink-0 select-none items-center justify-between gap-3 border-b border-border bg-card px-4 text-foreground sm:px-5">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobileSidebar}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label={t('topbar.open_navigation')}
        >
          <Menu size={18} />
        </button>

        <img src="/weav-logo-v2.png" alt="WEAV app logo" className="h-5 w-5 shrink-0 object-contain" />

        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span>{t('topbar.home')}</span>
          <span aria-hidden="true" className="text-muted-foreground/50">/</span>
          <span data-testid="topbar-breadcrumb-current" className="font-medium text-foreground">
            {t(currentPageKey)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={toggleLanguage}
          className="flex h-8 min-w-8 items-center justify-center rounded-md border border-border-strong bg-card px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={language === 'VI' ? t('topbar.switch_to_english') : t('topbar.switch_to_vietnamese')}
          aria-label={language === 'VI' ? t('topbar.switch_to_english') : t('topbar.switch_to_vietnamese')}
        >
          {language === 'VI' ? 'VI' : 'EN'}
        </button>

        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              {theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
            </motion.div>
          </AnimatePresence>
        </button>

        <Link
          to="/notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={unreadError ? t('notif.count_error') : t('nav.notifications')}
          aria-label={`${t('nav.notifications')}${unreadCount > 0 ? `: ${unreadCount} ${t('notif.unread')}` : ''}`}
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground ring-2 ring-card">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <div data-testid="topbar-user-avatar" title={profileName} className="ml-1 flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-text-2">
          {profileInitials || 'A'}
        </div>
      </div>
    </header>
  );
}
