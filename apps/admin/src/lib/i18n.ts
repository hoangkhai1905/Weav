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
    'common.refresh': 'Làm mới',
    'common.retry': 'Thử lại',
    'common.loading': 'Đang tải…',
    'common.cancel': 'Hủy',
    'common.prev': 'Trước',
    'common.next': 'Sau',
    'users.title': 'Người dùng',
    'users.subtitle': 'Xem các tài khoản, tìm kiếm, khóa hoặc mở lại tài khoản.',
    'users.search': 'Tìm theo email hoặc tên',
    'users.status': 'Trạng thái',
    'users.all': 'Tất cả',
    'users.status_active': 'Đang hoạt động',
    'users.status_disabled': 'Đã khóa',
    'users.role': 'Vai trò',
    'users.role_admin': 'Quản trị viên',
    'users.role_user': 'Người dùng',
    'users.col_user': 'Người dùng',
    'users.col_joined': 'Ngày tham gia',
    'users.col_actions': 'Thao tác',
    'users.caption': 'Danh sách người dùng',
    'users.you': 'bạn',
    'users.unverified': 'Email chưa xác minh',
    'users.disable': 'Khóa',
    'users.enable': 'Mở lại',
    'users.disable_title': 'Khóa tài khoản này?',
    'users.disable_confirm': 'Người này sẽ không đăng nhập được cho tới khi bạn mở lại tài khoản.',
    'users.empty': 'Chưa có người dùng nào.',
    'users.empty_filtered': 'Không có người dùng nào khớp với bộ lọc.',
    'users.load_error': 'Chưa tải được danh sách người dùng.',
    'users.status_error': 'Chưa đổi được trạng thái tài khoản. Vui lòng thử lại.',
    'users.locked_error': 'Không thể thay đổi tài khoản này.',
    'users.pagination': 'Phân trang',
    'users.page_info': 'Trang {page}/{pages} · {total} người dùng',
    'userdetail.back': 'Về danh sách người dùng',
    'userdetail.not_found_title': 'Không tìm thấy người dùng',
    'userdetail.not_found_body': 'Người dùng này không tồn tại hoặc đã bị xóa.',
    'userdetail.load_error': 'Chưa tải được thông tin người dùng.',
    'userdetail.email': 'Email',
    'userdetail.joined': 'Ngày tham gia',
    'userdetail.verified': 'Email đã xác minh',
    'userdetail.workspaces': 'Không gian làm việc đang sở hữu',
    'userdetail.workspaces_empty': 'Người dùng này chưa sở hữu không gian làm việc nào.',
    'userdetail.workspaces_error': 'Chưa tải được danh sách không gian làm việc.',
    'userdetail.members': '{count} thành viên',
    'userdetail.created': 'Tạo ngày {date}',
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
    'common.refresh': 'Refresh',
    'common.retry': 'Retry',
    'common.loading': 'Loading…',
    'common.cancel': 'Cancel',
    'common.prev': 'Previous',
    'common.next': 'Next',
    'users.title': 'Users',
    'users.subtitle': 'See every account, search, and turn accounts off or back on.',
    'users.search': 'Search by email or name',
    'users.status': 'Status',
    'users.all': 'All',
    'users.status_active': 'Active',
    'users.status_disabled': 'Disabled',
    'users.role': 'Role',
    'users.role_admin': 'Admin',
    'users.role_user': 'User',
    'users.col_user': 'User',
    'users.col_joined': 'Joined',
    'users.col_actions': 'Actions',
    'users.caption': 'Users',
    'users.you': 'you',
    'users.unverified': 'Email not verified',
    'users.disable': 'Disable',
    'users.enable': 'Enable',
    'users.disable_title': 'Disable this account?',
    'users.disable_confirm': 'They will not be able to sign in until you enable the account again.',
    'users.empty': 'There are no users yet.',
    'users.empty_filtered': 'No users match these filters.',
    'users.load_error': 'Could not load the users.',
    'users.status_error': 'Could not change the account status. Please try again.',
    'users.locked_error': 'This account cannot be changed.',
    'users.pagination': 'Pagination',
    'users.page_info': 'Page {page} of {pages} · {total} users',
    'userdetail.back': 'Back to users',
    'userdetail.not_found_title': 'User not found',
    'userdetail.not_found_body': 'This user does not exist or was removed.',
    'userdetail.load_error': 'Could not load this user.',
    'userdetail.email': 'Email',
    'userdetail.joined': 'Joined',
    'userdetail.verified': 'Email verified',
    'userdetail.workspaces': 'Owned workspaces',
    'userdetail.workspaces_empty': 'This user does not own any workspace yet.',
    'userdetail.workspaces_error': 'Could not load the workspaces.',
    'userdetail.members': '{count} members',
    'userdetail.created': 'Created {date}',
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
