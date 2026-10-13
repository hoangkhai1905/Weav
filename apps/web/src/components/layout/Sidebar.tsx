import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Building2,
  GitFork,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { MOTION_TRANSITION, REDUCED_MOTION_TRANSITION } from "../../lib/motion";
import { useAuthStore } from "../../store/useAuthStore";
import { useI18nStore } from "../../store/useI18nStore";
import { useUIStore } from "../../store/useUIStore";
import { WeavMark } from "../common/WeavMark";
import { FOCUS_RING } from "../../lib/uiClasses";
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
  { translationKey: "nav.executions", path: "/executions", icon: History, testId: "sidebar-monitoring" },
  { translationKey: "nav.workspace", path: "/workspace", icon: Building2 },
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
            `group relative isolate flex h-9 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-md px-[13px] text-sm font-medium transition-colors duration-150 ${FOCUS_RING} ${
              isActive ? "text-foreground" : "text-text-2 hover:bg-muted hover:text-foreground"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  data-testid="active-nav-indicator"
                  className="absolute inset-0 -z-10 rounded-md bg-card ring-1 ring-border"
                  transition={activeTransition}
                />
              )}
              <Icon
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
                className={isActive ? "shrink-0 text-foreground" : "shrink-0 text-text-2 group-hover:text-foreground"}
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
        className={`flex select-none flex-col gap-1 overflow-hidden border-r border-border bg-background p-2.5 text-sidebar-foreground ${
          floating
            ? `absolute inset-y-0 left-0 z-40 ${prefersReducedMotion ? "" : "transition-[width,box-shadow] duration-150 ease-out"} ${overlayOpen ? "w-[248px] shadow-pop" : "w-16"}`
            : "h-full"
        }`}
      >
        <div className={`flex min-h-12 items-center gap-2.5 pb-2 pt-1 ${rail ? "flex-col" : "pl-[9px]"}`}>
          <WeavMark />
          {!rail && <span className="flex-1 truncate text-base font-semibold tracking-tight text-foreground">Weav</span>}
          {isMobile ? (
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
              aria-label={t("nav.close_navigation")}
            >
              <X size={18} strokeWidth={1.75} />
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
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
            >
              <ToggleIcon size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>

        <WorkspaceSwitcher compact={rail} />

        <nav className="mt-3.5 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden" aria-label={t("nav.primary")}>
          {renderNavItems(MAIN_NAV_ITEMS, rail, isMobile)}
        </nav>

        <div className="min-h-6 flex-1" />

        <div data-testid="sidebar-footer" className="shrink-0">
          <nav aria-label={t("nav.support")} className="flex flex-col gap-0.5">
            {renderNavItems(BOTTOM_NAV_ITEMS, rail, isMobile)}
          </nav>

          <div className={`mt-2 flex items-center gap-2.5 border-t border-border pt-3 ${rail ? "flex-col" : "px-[7px]"}`}>
            <span
              aria-hidden="true"
              title={rail ? profileName : undefined}
              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-subtle text-xs font-semibold text-foreground"
            >
              {profileInitials || "A"}
            </span>
            <span className={rail ? "sr-only" : "flex min-w-0 flex-1 flex-col"}>
              <span data-testid="sidebar-profile-name" className="truncate text-sm font-medium text-foreground">
                {profileName}
              </span>
              {user?.email && user.email !== profileName && (
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              )}
            </span>
            <button
              onClick={logout}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-err-bg hover:text-err ${FOCUS_RING}`}
              title={t("nav.logout")}
              aria-label={t("nav.logout")}
            >
              <LogOut size={16} strokeWidth={1.75} />
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
        } ${sidebarCollapsed ? "w-16" : "w-[248px]"}`}
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
              className="relative z-10 h-full w-[248px]"
            >
              {renderContent(true)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
