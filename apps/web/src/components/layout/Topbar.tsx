import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, CircleHelp, LogOut, Menu, ShieldCheck, UserRound } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';
import { LanguageSwitch, ThemeToggle } from './ShellControls';
import { useNotificationUnreadCount } from '../../hooks/useNotifications';
import { useAuthStore } from '../../store/useAuthStore';
import { FOCUS_RING, ICON_BTN } from '../../lib/uiClasses';

const MENU_ITEM = `flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-subtle ${FOCUS_RING}`;

/** Avatar button with an account menu: profile, security, help, logout. Closes on outside click and Escape. */
function UserMenu({ name, initials, email }: { name: string; initials: string; email?: string }) {
  const { t } = useI18nStore();
  const logout = useAuthStore((state) => state.logout);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative ml-1">
      <button
        ref={buttonRef}
        type="button"
        data-testid="topbar-user-avatar"
        title={name}
        aria-label={`${t('nav.account')}: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-subtle text-[11px] font-semibold text-foreground transition-colors hover:border-border-strong ${FOCUS_RING}`}
      >
        {initials || 'A'}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="topbar-user-menu"
          aria-label={t('nav.account')}
          className="absolute right-0 top-9 z-50 w-60 rounded-[10px] border border-border-strong bg-card p-1.5 shadow-pop"
        >
          <div className="border-b border-border px-2.5 pb-2 pt-1">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            {email && email !== name && <p className="truncate text-xs text-muted-foreground">{email}</p>}
          </div>
          <div className="flex flex-col gap-0.5 py-1">
            <Link role="menuitem" to="/settings/profile" onClick={close} className={MENU_ITEM}>
              <UserRound size={16} strokeWidth={1.75} aria-hidden="true" className="text-text-2" />
              {t('settings.profile')}
            </Link>
            <Link role="menuitem" to="/settings/security" onClick={close} className={MENU_ITEM}>
              <ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" className="text-text-2" />
              {t('settings.security')}
            </Link>
            <Link role="menuitem" to="/help" onClick={close} className={MENU_ITEM}>
              <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" className="text-text-2" />
              {t('nav.help')}
            </Link>
          </div>
          <div className="border-t border-border pt-1">
            <button type="button" role="menuitem" data-testid="topbar-logout" onClick={logout} className={`${MENU_ITEM} text-err hover:bg-err-bg`}>
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
              {t('nav.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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

        <UserMenu name={profileName} initials={profileInitials} email={user?.email} />
      </div>
    </header>
  );
}
