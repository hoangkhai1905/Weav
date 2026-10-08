import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  mobileSidebarOpen: boolean;
  toggleMobileSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  mobileSearchOpen: boolean;
  toggleMobileSearch: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  initTheme: () => void;
}

const THEME_KEY = 'weav_theme_v1';
const SIDEBAR_KEY = 'weav_sidebar_collapsed_v1';
const readSidebarCollapsed = (): boolean => {
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
};
const saveSidebarCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  } catch {
    // Storage may be unavailable (private mode); the toggle still works for this session.
  }
};
const initialTheme: 'dark' | 'light' = (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'light';

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: readSidebarCollapsed(),
  toggleSidebar: () =>
    set((state) => {
      saveSidebarCollapsed(!state.sidebarCollapsed);
      return { sidebarCollapsed: !state.sidebarCollapsed };
    }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    saveSidebarCollapsed(sidebarCollapsed);
    set({ sidebarCollapsed });
  },
  mobileSidebarOpen: false,
  toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
  setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
  mobileSearchOpen: false,
  toggleMobileSearch: () => set((state) => ({ mobileSearchOpen: !state.mobileSearchOpen })),
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  theme: initialTheme,
  initTheme: () => {
    const theme = get().theme;
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  },
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    set({ theme });
  },
  toggleTheme: () => {
    const current = get().theme;
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    set({ theme: next });
  },
}));
