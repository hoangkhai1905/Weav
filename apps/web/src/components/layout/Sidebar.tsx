import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  GitFork,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LogOut,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { MOTION_TRANSITION, REDUCED_MOTION_TRANSITION } from '../../lib/motion';
import { useAuthStore } from '../../store/useAuthStore';
import { useI18nStore } from '../../store/useI18nStore';
import { useUIStore } from '../../store/useUIStore';

interface NavItem {
  translationKey: string;
  path: string;
  icon: React.ElementType;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { translationKey: 'nav.dashboard', path: '/dashboard', icon: LayoutDashboard },
  { translationKey: 'nav.workflows', path: '/workflows', icon: GitFork },
  { translationKey: 'nav.executions', path: '/executions', icon: Activity },
  { translationKey: 'nav.connections', path: '/connections', icon: Link2 },
  { translationKey: 'nav.workspace', path: '/workspace', icon: Users },
];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { translationKey: 'nav.settings', path: '/settings/profile', icon: Settings },
  { translationKey: 'nav.help', path: '/help', icon: HelpCircle },
];

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const { logout } = useAuthStore();
  const { t } = useI18nStore();
  const prefersReducedMotion = useReducedMotion();
  const activeTransition = prefersReducedMotion ? REDUCED_MOTION_TRANSITION : MOTION_TRANSITION;

  const renderNavItems = (items: NavItem[], isMobile: boolean) =>
    items.map((item) => {
      const Icon = item.icon;

      return (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={() => isMobile && setMobileSidebarOpen(false)}
          className={({ isActive }) =>
            `group relative flex min-h-10 items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
              isActive
                ? 'bg-sidebar-active text-sidebar-foreground'
                : 'text-sidebar-foreground/80 hover:bg-blue-100/70 hover:text-sidebar-foreground dark:hover:bg-blue-950/40'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  data-testid="active-nav-indicator"
                  className="absolute inset-y-2 left-0 w-px rounded-full bg-primary"
                  transition={activeTransition}
                />
              )}
              <Icon
                size={18}
                strokeWidth={isActive ? 2.2 : 1.8}
                className={
                  isActive
                    ? 'shrink-0 text-primary'
                    : 'shrink-0 text-sidebar-muted transition-colors group-hover:text-primary'
                }
              />
              <span className="truncate">{t(item.translationKey)}</span>
            </>
          )}
        </NavLink>
      );
    });

  const renderContent = (isMobile = false) => (
    <div
      data-testid="app-sidebar"
      className="flex h-full select-none flex-col border-r border-slate-200 bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-3">
          <img
            src="/weav-logo-v2.png"
            alt="WEAV app logo"
            className="h-8 w-8 shrink-0 object-contain drop-shadow-sm"
          />
          <div className="flex flex-col">
            <span className="text-sm font-bold leading-none tracking-tight text-sidebar-foreground">WEAV</span>
            <span className="mt-1 text-[11px] font-medium leading-tight text-sidebar-muted">
              Workflow Operations
            </span>
          </div>
        </div>

        {isMobile && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-blue-100 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="Primary navigation">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
          Platform
        </div>
        {renderNavItems(MAIN_NAV_ITEMS, isMobile)}
      </nav>

      <div data-testid="sidebar-footer" className="shrink-0 space-y-1 border-t border-slate-200/80 bg-slate-100/70 p-3 dark:border-slate-800 dark:bg-slate-900/45">
        <nav aria-label="Support navigation">{renderNavItems(BOTTOM_NAV_ITEMS, isMobile)}</nav>

        <div className="mt-3 flex items-center justify-between border-t border-slate-200 px-2 pt-3 pb-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-bold text-sidebar-foreground ring-1 ring-slate-300/70 dark:bg-slate-800 dark:ring-slate-700">
              NT
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-semibold leading-tight text-sidebar-foreground">
                Nguyễn Anh Xuân Trường
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="truncate text-[11px] leading-none text-sidebar-muted">Workspace</span>
                <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-700">
                  Pro
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            className="rounded-md p-2 text-sidebar-muted transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="z-30 hidden h-full w-[240px] shrink-0 flex-col md:flex">
        {renderContent(false)}
      </aside>

      <AnimatePresence>
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="absolute inset-0 bg-slate-950/55"
            />
            <motion.div
              initial={prefersReducedMotion ? { opacity: 0 } : { x: '-100%' }}
              animate={prefersReducedMotion ? { opacity: 1 } : { x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { x: '-100%' }}
              transition={
                prefersReducedMotion
                  ? REDUCED_MOTION_TRANSITION
                  : { type: 'spring', stiffness: 350, damping: 32 }
              }
              className="relative z-10 h-full w-64"
            >
              {renderContent(true)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
