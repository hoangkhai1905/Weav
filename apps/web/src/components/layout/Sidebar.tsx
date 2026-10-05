import { NavLink } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
} from "lucide-react";
import { MOTION_TRANSITION, REDUCED_MOTION_TRANSITION } from "../../lib/motion";
import { useAuthStore } from "../../store/useAuthStore";
import { useI18nStore } from "../../store/useI18nStore";
import { useUIStore } from "../../store/useUIStore";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface NavItem {
  testId?: string;
  translationKey: string;
  path: string;
  icon: React.ElementType;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  {
    translationKey: "nav.dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  { translationKey: "nav.workflows", path: "/workflows", icon: GitFork },
  { translationKey: "nav.executions", path: "/executions", icon: Activity },
  { translationKey: "nav.connections", path: "/connections", icon: Link2 },
  { translationKey: "nav.workspace", path: "/workspace", icon: Users },
  {
    translationKey: "nav.ai_generator",
    path: "/ai/workflow-generator",
    icon: Sparkles,
    testId: "sidebar-ai-promo",
  },
];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { translationKey: "nav.settings", path: "/settings/profile", icon: Settings },
  { translationKey: "nav.help", path: "/help", icon: HelpCircle },
];

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const { user, logout } = useAuthStore();
  const { t } = useI18nStore();
  const prefersReducedMotion = useReducedMotion();
  const activeTransition = prefersReducedMotion
    ? REDUCED_MOTION_TRANSITION
    : MOTION_TRANSITION;
  const profileName =
    user?.displayName?.trim() ||
    user?.name?.trim() ||
    user?.email ||
    t("nav.account");
  const profileInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const renderNavItems = (items: NavItem[], isMobile: boolean) =>
    items.map((item) => {
      const Icon = item.icon;

      return (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={() => isMobile && setMobileSidebarOpen(false)}
          data-testid={item.testId}
          title={!isMobile && collapsed ? t(item.translationKey) : undefined}
          aria-label={t(item.translationKey)}
          className={({ isActive }) =>
            `group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] ${isMobile || !collapsed ? "" : "justify-center"} font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
              isActive
                ? "bg-sidebar-active text-foreground"
                : "text-text-2 hover:bg-subtle hover:text-foreground"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  data-testid="active-nav-indicator"
                  className="absolute inset-y-1.5 -left-2.5 w-[3px] rounded-r-sm bg-primary"
                  transition={activeTransition}
                />
              )}
              <Icon
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
                className={
                  isActive
                    ? "shrink-0 text-foreground"
                    : "shrink-0 text-muted-foreground group-hover:text-foreground"
                }
              />
              {(isMobile || !collapsed) && (
                <span className="truncate">{t(item.translationKey)}</span>
              )}
            </>
          )}
        </NavLink>
      );
    });

  const renderContent = (isMobile = false) => {
    const rail = collapsed && !isMobile;
    return (
      <div
        data-testid="app-sidebar"
        data-collapsed={rail ? "true" : "false"}
        className={`flex h-full select-none flex-col gap-3 border-r border-border bg-sidebar text-sidebar-foreground ${rail ? "p-2" : "p-2.5"}`}
      >
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            {rail ? (
              <img
                src="/weav-logo-v2.png"
                alt="WEAV app logo"
                className="mx-auto h-6 w-6 object-contain"
              />
            ) : (
              <WorkspaceSwitcher />
            )}
          </div>
          {isMobile && (
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("nav.close_navigation")}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <nav
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto"
          aria-label={t("nav.primary")}
        >
          {renderNavItems(MAIN_NAV_ITEMS, isMobile)}
        </nav>

        <div
          data-testid="sidebar-footer"
          className="shrink-0 space-y-0.5 border-t border-border pt-2.5"
        >
          <nav aria-label={t("nav.support")} className="flex flex-col gap-0.5">
            {renderNavItems(BOTTOM_NAV_ITEMS, isMobile)}
          </nav>

          <div
            className={`flex h-9 items-center gap-2 ${rail ? "justify-center" : "px-2"}`}
          >
            {!rail && (
              <>
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-text-2"
                >
                  {profileInitials || "A"}
                </span>
                <span
                  data-testid="sidebar-profile-name"
                  className="min-w-0 flex-1 truncate text-[13px] text-foreground"
                >
                  {profileName}
                </span>
              </>
            )}
            <button
              onClick={logout}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-err-bg hover:text-err focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={t("nav.logout")}
              aria-label={t("nav.logout")}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <aside
        className={`z-30 hidden h-full shrink-0 flex-col md:flex ${collapsed ? "w-14" : "w-[220px]"}`}
      >
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
              className="absolute inset-0 bg-foreground/30"
            />
            <motion.div
              initial={prefersReducedMotion ? { opacity: 0 } : { x: "-100%" }}
              animate={prefersReducedMotion ? { opacity: 1 } : { x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { x: "-100%" }}
              transition={
                prefersReducedMotion
                  ? REDUCED_MOTION_TRANSITION
                  : { type: "spring", stiffness: 350, damping: 32 }
              }
              className="relative z-10 h-full w-[220px]"
            >
              {renderContent(true)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
