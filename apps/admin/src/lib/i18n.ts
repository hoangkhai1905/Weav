import { useSyncExternalStore } from 'react';

export type Lang = 'VI' | 'EN';
export type Theme = 'light' | 'dark';

const LANG_KEY = 'weav_admin_lang';
const THEME_KEY = 'weav_admin_theme';

const DICT: Record<Lang, Record<string, string>> = {
  VI: {
    'brand.name': 'Weav Admin',
    'nav.overview': 'Tổng quan',
    'nav.users': 'Người dùng',
    'nav.workspaces': 'Không gian làm việc',
    'nav.executions': 'Lượt chạy',
    'nav.templates': 'Mẫu quy trình',
    'nav.system': 'Hệ thống',
    'nav.notfound': 'Không tìm thấy',
    'nav.main': 'Điều hướng',
    'topbar.home': 'Quản trị',
    'topbar.language': 'Ngôn ngữ',
    'topbar.toggle_theme': 'Đổi giao diện sáng/tối',
    'topbar.sign_out': 'Đăng xuất',
    'login.title': 'Đăng nhập quản trị',
    'login.subtitle': 'Chỉ dành cho quản trị viên của Weav.',
    'login.email': 'Email',
    'login.password': 'Mật khẩu',
    'login.submit': 'Đăng nhập',
    'login.submitting': 'Đang đăng nhập…',
    'login.error.credentials': 'Email hoặc mật khẩu chưa đúng, hoặc tài khoản này không thể đăng nhập.',
    'login.error.not_admin': 'Tài khoản này không có quyền quản trị.',
    'login.error.generic': 'Chưa đăng nhập được. Vui lòng thử lại sau ít phút.',
    'overview.title': 'Tổng quan',
    'overview.subtitle': 'Xin chào {name}. Đây là bức tranh chung của Weav.',
    'overview.users_total': 'Tổng số người dùng',
    'overview.load_error': 'Chưa tải được số liệu.',
    'notfound.title': 'Không tìm thấy trang này',
    'notfound.body': 'Trang này chưa có hoặc đang được xây dựng.',
    'notfound.back': 'Về trang tổng quan',
  },
  EN: {
    'brand.name': 'Weav Admin',
    'nav.overview': 'Overview',
    'nav.users': 'Users',
    'nav.workspaces': 'Workspaces',
    'nav.executions': 'Runs',
    'nav.templates': 'Templates',
    'nav.system': 'System',
    'nav.notfound': 'Not found',
    'nav.main': 'Navigation',
    'topbar.home': 'Admin',
    'topbar.language': 'Language',
    'topbar.toggle_theme': 'Switch light/dark theme',
    'topbar.sign_out': 'Sign out',
    'login.title': 'Admin sign-in',
    'login.subtitle': 'For Weav administrators only.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.submitting': 'Signing in…',
    'login.error.credentials': 'Wrong email or password, or this account cannot sign in.',
    'login.error.not_admin': 'This account has no admin access.',
    'login.error.generic': 'Could not sign in. Please try again in a few minutes.',
    'overview.title': 'Overview',
    'overview.subtitle': 'Hello {name}. Here is the big picture of Weav.',
    'overview.users_total': 'Total users',
    'overview.load_error': 'Could not load the numbers.',
    'notfound.title': 'Page not found',
    'notfound.body': 'This page does not exist yet or is still being built.',
    'notfound.back': 'Back to overview',
  },
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The preference just will not survive a reload.
  }
}

let lang: Lang = read(LANG_KEY) === 'EN' ? 'EN' : 'VI';
let theme: Theme = read(THEME_KEY) === 'dark' ? 'dark' : 'light';
const listeners = new Set<() => void>();

const applyDom = () => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.lang = lang === 'EN' ? 'en' : 'vi';
};

const emit = () => {
  applyDom();
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

applyDom();

export function setLang(next: Lang): void {
  lang = next;
  write(LANG_KEY, next);
  emit();
}

export function toggleTheme(): void {
  theme = theme === 'dark' ? 'light' : 'dark';
  write(THEME_KEY, theme);
  emit();
}

export const useLang = (): Lang => useSyncExternalStore(subscribe, () => lang);
export const useTheme = (): Theme => useSyncExternalStore(subscribe, () => theme);

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const current = useLang();
  return (key, vars) => {
    const text = DICT[current][key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
  };
}
