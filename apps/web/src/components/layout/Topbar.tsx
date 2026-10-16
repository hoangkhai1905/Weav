import { Link, useLocation } from 'react-router-dom';
import { Bell, Menu } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';
import { LanguageSwitch, ThemeToggle } from './ShellControls';
import { useNotificationUnreadCount } from '../../hooks/useNotifications';
import { useAuthStore } from '../../store/useAuthStore';
import { ICON_BTN } from '../../lib/uiClasses';

const getTopbarPageKey = (pathname: string) => {
  if (pathname.startsWith('/workflows')) return 'nav.workflows';
  if (pathname.startsWith('/executions')) return 'nav.executions';
  if (pathname.startsWith('/connections') || pathname.startsWith('/workspace/connections')) return 'workspace.tab.connections';
  if (pathname.startsWith('/workspace/members')) return 'workspace.tab.members';
  if (pathname.startsWith('/workspace/settings')) return 'workspace.tab.settings';
  if (pathname.startsWith('/workspace')) return 'nav.workspace';
  if (pathname.startsWith('/ai')) return 'nav.ai_generator';
  if (pathname.startsWith('/assistant')) return 'nav.assistant';
  if (pathname.startsWith('/notifications')) return 'nav.notifications';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  if (pathname.startsWith('/help')) return 'nav.help';
  return 'nav.dashboard';
};

export function Topbar() {
  const toggleMobileSidebar = useUIStore((state) => state.toggleMobileSidebar);
  const { t } = useI18nStore();
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
    <header className="z-20 flex h-14 shrink-0 select-none items-center justify-between gap-3 border-b border-border bg-background px-4 text-foreground sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={toggleMobileSidebar}
          className={`${ICON_BTN} md:hidden`}
          aria-label={t('topbar.open_navigation')}
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>

        <div className="flex min-w-0 items-center gap-1.5 text-sm text-text-2">
          <span className="hidden sm:inline">{t('topbar.home')}</span>
          <span aria-hidden="true" className="hidden text-muted-foreground/60 sm:inline">/</span>
          {location.pathname.startsWith('/workspace/') && (
            <>
              <Link to="/workspace" className="hover:text-foreground">{t('nav.workspace')}</Link>
              <span aria-hidden="true" className="text-muted-foreground/60">/</span>
            </>
          )}
          <span data-testid="topbar-breadcrumb-current" className="truncate font-medium text-foreground">
            {t(currentPageKey)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <LanguageSwitch />

        <ThemeToggle />

        <Link
          to="/notifications"
          className={ICON_BTN}
          title={unreadError ? t('notif.count_error') : t('nav.notifications')}
          aria-label={`${t('nav.notifications')}${unreadCount > 0 ? `: ${unreadCount} ${t('notif.unread')}` : ''}`}
        >
          <Bell size={18} strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-err px-1 text-center text-[10px] font-semibold leading-4 text-background ring-2 ring-background">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <div data-testid="topbar-user-avatar" title={profileName} className="ml-1 flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full border border-border bg-subtle text-[11px] font-semibold text-foreground">
          {profileInitials || 'A'}
        </div>
      </div>
    </header>
  );
}
