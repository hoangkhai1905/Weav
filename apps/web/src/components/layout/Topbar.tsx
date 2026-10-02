import { Link, useLocation } from 'react-router-dom';
import { Bell, Menu, Moon, Search, Sun } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';
import { useNotificationUnreadCount } from '../../hooks/useNotifications';
import { useAuthStore } from '../../store/useAuthStore';
import { useWorkspaceListContext } from '../../hooks/useWorkspace';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';

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
  const { searchQuery, setSearchQuery, theme, toggleTheme, toggleMobileSidebar } = useUIStore();
  const { language, toggleLanguage, t } = useI18nStore();
  const user = useAuthStore((state) => state.user);
  const { workspaces, workspacesQuery } = useWorkspaceListContext();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const selectWorkspace = useWorkspaceStore((state) => state.selectWorkspace);
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
          <span data-testid="topbar-breadcrumb-current" className="font-semibold text-foreground">
            {t(currentPageKey)}
          </span>
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
        {workspacesQuery.isPending && workspaces.length === 0 ? (
          <span data-testid="topbar-workspace-loading" role="status" className="max-w-28 truncate text-xs text-muted-foreground sm:max-w-40">
            {t('topbar.workspace_loading')}
          </span>
        ) : workspaces.length > 0 ? (
          <div className="flex min-w-0 flex-col items-start">
            <label className="sr-only" htmlFor="topbar-workspace-selector">
              {t('topbar.select_workspace')}
            </label>
            <select
              id="topbar-workspace-selector"
              data-testid="topbar-workspace-selector"
              aria-label={t('topbar.select_workspace')}
              aria-busy={workspacesQuery.isFetching}
              value={activeWorkspaceId ?? ''}
              onChange={(event) => selectWorkspace(event.target.value || null)}
              className="max-w-28 rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-40 lg:max-w-56"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            {workspacesQuery.isError && (
              <span data-testid="topbar-workspace-error" role="alert" className="max-w-32 truncate text-[10px] text-destructive" title={t('topbar.workspace_load_error')}>
                {t('topbar.workspace_load_error')}
              </span>
            )}
          </div>
        ) : workspacesQuery.isError ? (
          <div className="flex items-center gap-1">
            <span data-testid="topbar-workspace-error" role="alert" className="max-w-24 truncate text-xs text-destructive sm:max-w-36">
              {t('topbar.workspace_load_error')}
            </span>
            <button
              type="button"
              aria-label={t('topbar.retry_workspace_load')}
              onClick={() => void workspacesQuery.refetch()}
              className="rounded-md px-1.5 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('topbar.retry')}
            </button>
          </div>
        ) : (
          <Link
            data-testid="topbar-no-workspace"
            to="/workspace"
            className="max-w-28 truncate rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-40"
          >
            {t('topbar.no_workspace')}
          </Link>
        )}

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
          title={unreadError ? t('notif.count_error') : t('nav.notifications')}
          aria-label={`${t('nav.notifications')}${unreadCount > 0 ? `: ${unreadCount} ${t('notif.unread')}` : ''}`}
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-bold leading-4 text-primary-foreground ring-2 ring-card">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <div data-testid="topbar-user-avatar" title={profileName} className="ml-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-sm">
          {profileInitials || 'A'}
        </div>
      </div>
    </header>
  );
}
