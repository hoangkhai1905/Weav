import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

interface UIState {
  /** Light by default; 'system' follows the phone's appearance (see useThemeColors). Not persisted. */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  themeMode: 'light',
  setThemeMode: (themeMode) => set({ themeMode }),
  toasts: [],
  showToast: (toast) => {
    const id = 'toast-' + Date.now();
    const newToast = { ...toast, id };
    // Replace previous toasts to prevent toast spamming! Max 1 visible toast at a time.
    set({ toasts: [newToast] });

    setTimeout(() => {
      get().removeToast(id);
    }, 3000);
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
