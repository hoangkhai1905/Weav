import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
}

interface UIState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
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
