import { Link, NavLink } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  GitFork,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LogOut,
  Settings,
  Sparkles,
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
  const { user, logout } = useAuthStore();
  const { t } = useI18nStore();
  const prefersReducedMotion = useReducedMotion();
  const activeTransition = prefersReducedMotion ? REDUCED_MOTION_TRANSITION : MOTION_TRANSITION;
  const profileName = user?.displayName?.trim() || user?.name?.trim() || user?.email || t('nav.account');
  const profileInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const renderNavItems = (items: NavItem[], isMobile: boolean) =>
    items.map((item) => {
      const Icon = item.icon;

      return (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={() => isMobile && setMobileSidebarOpen(false)}
          className={({ isActive }) =>
            `group relative flex min-h-9 items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
              isActive
                ? 'bg-sidebar-active text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_14%,transparent)]'
                : 'text-sidebar-foreground/75 hover:bg-muted hover:text-sidebar-foreground'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  data-testid="active-nav-indicator"
                  className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-gradient"
                  transition={activeTransition}
                />
              )}
              <Icon
                size={18}
                strokeWidth={isActive ? 2.2 : 1.8}
                className={
                  isActive
                    ? 'shrink-0 text-primary'
                    : 'shrink-0 text-sidebar-muted transition-colors group-hover:text-sidebar-foreground'
                }
              />
              <span className={`truncate ${isActive ? 'font-semibold' : ''}`}>{t(item.translationKey)}</span>
            </>
          )}
        </NavLink>
      );
    });

  const renderContent = (isMobile = false) => (
    <div
      data-testid="app-sidebar"
      className="flex h-full select-none flex-col border-r border-border bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card shadow-soft">
            <img
              src="/weav-logo-v2.png"
              alt="WEAV app logo"
              className="h-6 w-6 object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-[15px] font-bold leading-none tracking-tight text-sidebar-foreground">WEAV</span>
            <span className="mt-1 text-[11px] font-medium leading-tight text-sidebar-muted">
              {t('nav.brand_subtitle')}
            </span>
          </div>
        </div>

        {isMobile && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-muted hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={t('nav.close_navigation')}
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label={t('nav.primary')}>
        <div className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted/80">
          {t('nav.platform')}
        </div>
        {renderNavItems(MAIN_NAV_ITEMS, isMobile)}

        <Link
          to="/ai/workflow-generator"
          onClick={() => isMobile && setMobileSidebarOpen(false)}
          data-testid="sidebar-ai-promo"
          className="group relative mt-5 block overflow-hidden rounded-xl border border-primary/15 bg-accent/60 p-3 outline-none transition-colors hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-brand-gradient opacity-20 blur-2xl transition-opacity group-hover:opacity-35" />
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-brand">
              <Sparkles size={14} />
            </span>
            <span className="text-[13px] font-semibold text-foreground">{t('nav.ai_promo_title')}</span>
          </span>
          <span className="mt-2 block text-[11.5px] leading-snug text-muted-foreground">{t('nav.ai_promo_desc')}</span>
        </Link>
      </nav>

      <div data-testid="sidebar-footer" className="shrink-0 space-y-0.5 border-t border-border bg-sidebar p-3 dark:bg-slate-900/45">
        <nav aria-label={t('nav.support')}>{renderNavItems(BOTTOM_NAV_ITEMS, isMobile)}</nav>

        <div className="mt-2 flex items-center justify-between rounded-xl border border-border bg-card px-2 py-2 shadow-soft">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-xs font-bold text-white">
              {profileInitials || 'A'}
            </div>
            <div className="flex min-w-0 flex-col">
              <span data-testid="sidebar-profile-name" className="truncate text-xs font-semibold leading-tight text-sidebar-foreground">
                {profileName}
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="truncate text-[11px] leading-none text-sidebar-muted">{t('nav.workspace')}</span>
                <span className="inline-flex items-center rounded bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                  Pro
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            className="rounded-md p-2 text-sidebar-muted transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-rose-950/40"
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
      <aside className="z-30 hidden h-full w-[248px] shrink-0 flex-col md:flex">
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
