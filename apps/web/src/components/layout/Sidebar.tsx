import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  Bot,
  GitFork,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
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
  { translationKey: "nav.workspace", path: "/workspace", icon: Users },
  {
    translationKey: "nav.ai_generator",
    path: "/ai/workflow-generator",
    icon: Sparkles,
    testId: "sidebar-ai-promo",
  },
  { translationKey: "nav.assistant", path: "/assistant", icon: Bot, testId: "sidebar-assistant" },
  { translationKey: "nav.telegram", path: "/telegram", icon: Send, testId: "sidebar-telegram" },
  { translationKey: "nav.notification_center", path: "/notifications", icon: Bell, testId: "sidebar-notifications" },
];

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { translationKey: "nav.settings", path: "/settings/profile", icon: Settings },
  { translationKey: "nav.help", path: "/help", icon: HelpCircle },
];

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen, sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, logout } = useAuthStore();
  const { t } = useI18nStore();
  const prefersReducedMotion = useReducedMotion();
  const activeTransition = prefersReducedMotion ? REDUCED_MOTION_TRANSITION : MOTION_TRANSITION;
  const profileName =
    user?.displayName?.trim() || user?.name?.trim() || user?.email || t("nav.account");
  const profileInitials = profileName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  // Ctrl/Cmd+B toggles the sidebar unless the user is typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select") || target.isContentEditable)) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  // Hover/focus expands the collapsed rail as an overlay (no layout shift); the toggle pins it open.
  const [hovered, setHovered] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const scheduleHover = useCallback((next: boolean, delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Keep it open while a workspace dropdown (native select) inside the sidebar has focus.
      const active = document.activeElement;
      if (!next && active instanceof HTMLSelectElement && asideRef.current?.contains(active)) return;
      setHovered(next);
    }, delay);
  }, []);
  useEffect(() => () => clearTimer(), []);
  const isCoarsePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const overlayOpen = sidebarCollapsed && hovered;

  const fade = prefersReducedMotion ? "" : "transition-opacity duration-150";

  const renderNavItems = (items: NavItem[], rail: boolean, isMobile: boolean) =>
    items.map((item) => {
      const Icon = item.icon;
      return (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={() => isMobile && setMobileSidebarOpen(false)}
          data-testid={item.testId}
          title={rail ? t(item.translationKey) : undefined}
          aria-label={t(item.translationKey)}
          className={({ isActive }) =>
            `group relative flex h-8 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-md px-3 text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
              isActive ? "bg-sidebar-active text-foreground" : "text-text-2 hover:bg-subtle hover:text-foreground"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  data-testid="active-nav-indicator"
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-primary"
                  transition={activeTransition}
                />
              )}
              <Icon
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
                className={isActive ? "shrink-0 text-foreground" : "shrink-0 text-muted-foreground group-hover:text-foreground"}
              />
              <span className={`truncate ${fade} ${rail ? "opacity-0" : "opacity-100"}`}>{t(item.translationKey)}</span>
            </>
          )}
        </NavLink>
      );
    });

  const toggleLabel = sidebarCollapsed ? t("nav.pin_sidebar") : t("nav.unpin_sidebar");
  const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  const renderContent = (isMobile = false) => {
    const rail = sidebarCollapsed && !hovered && !isMobile;
    const floating = sidebarCollapsed && !isMobile;
    return (
      <div
        data-testid="app-sidebar"
        data-collapsed={rail ? "true" : "false"}
        data-pinned={sidebarCollapsed ? "false" : "true"}
        className={`flex select-none flex-col gap-3 overflow-hidden border-r border-border bg-sidebar p-2 text-sidebar-foreground ${
          floating
            ? `absolute inset-y-0 left-0 z-40 ${prefersReducedMotion ? "" : "transition-[width,box-shadow] duration-150 ease-out"} ${overlayOpen ? "w-[220px] shadow-pop" : "w-14"}`
            : "h-full"
        }`}
      >
        <div className={`flex items-center gap-1 ${rail ? "flex-col" : ""}`}>
          <div className={rail ? "w-full" : "min-w-0 flex-1"}>
            <WorkspaceSwitcher compact={rail} />
          </div>
          {isMobile ? (
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("nav.close_navigation")}
            >
              <X size={16} />
            </button>
          ) : (
            <button
              type="button"
              data-testid="sidebar-toggle"
              onClick={toggleSidebar}
              title={`${toggleLabel} (Ctrl+B)`}
              aria-label={toggleLabel}
              aria-expanded={!sidebarCollapsed}
              aria-keyshortcuts="Control+B Meta+B"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ToggleIcon size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden" aria-label={t("nav.primary")}>
          {renderNavItems(MAIN_NAV_ITEMS, rail, isMobile)}
        </nav>

        <div data-testid="sidebar-footer" className="shrink-0 space-y-0.5 border-t border-border pt-2.5">
          <nav aria-label={t("nav.support")} className="flex flex-col gap-0.5">
            {renderNavItems(BOTTOM_NAV_ITEMS, rail, isMobile)}
          </nav>

          <div className={`flex items-center gap-2 ${rail ? "flex-col py-1" : "h-9 px-3"}`}>
            <span
              aria-hidden="true"
              title={rail ? profileName : undefined}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-text-2"
            >
              {profileInitials || "A"}
            </span>
            <span
              data-testid="sidebar-profile-name"
              className={rail ? "sr-only" : "min-w-0 flex-1 truncate text-[13px] text-foreground"}
            >
              {profileName}
            </span>
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
        ref={asideRef}
        data-testid="app-sidebar-region"
        onPointerEnter={(event) => {
          if (!sidebarCollapsed || event.pointerType === "touch" || isCoarsePointer()) return;
          scheduleHover(true, 150);
        }}
        onPointerLeave={() => scheduleHover(false, 200)}
        onFocus={(event) => {
          if (!sidebarCollapsed || isCoarsePointer()) return;
          if (event.target.matches(":focus-visible")) scheduleHover(true, 0);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleHover(false, 200);
        }}
        className={`relative z-30 hidden h-full shrink-0 flex-col md:flex ${
          prefersReducedMotion ? "" : "transition-[width] duration-150 ease-out"
        } ${sidebarCollapsed ? "w-14" : "w-[220px]"}`}
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
              transition={prefersReducedMotion ? REDUCED_MOTION_TRANSITION : { type: "spring", stiffness: 350, damping: 32 }}
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
