import { create } from 'zustand';

export type Language = 'VI' | 'EN';

export const translations: Record<Language, Record<string, string>> = {
  VI: {
    // Navigation Tabs
    'tab.home': 'Trang chủ',
    'tab.workflows': 'Quy trình',
    'tab.executions': 'Lịch sử',
    'tab.notifications': 'Thông báo',
    'tab.profile': 'Cá nhân',

    // Home Screen & Control Center
    'home.greeting': 'Xin chào 👋',
    'home.ready_sub': 'Sẵn sàng tự động hóa công việc hôm nay?',
    'home.overview': 'Tổng quan Quy trình',
    'home.activity_subtitle': 'Hoạt động 7 ngày qua',
    'home.total_workflows': 'Tổng quy trình',
    'home.published': 'Đã xuất bản',
    'home.running': 'Đang chạy',
    'home.failed': 'Thất bại',
    'home.queued': 'Đang chờ',
    'home.quick_actions': 'Thao tác nhanh',
    'home.generate_ai': 'Tạo với AI',
    'home.run_workflow': 'Chạy quy trình',
    'home.view_executions': 'Xem lịch sử',
    'home.connections': 'Kết nối dịch vụ',
    'home.ai_quick_title': 'Tự động hóa với AI',
    'home.ai_quick_desc': 'Mô tả quy trình bạn muốn tự động hóa...',
    'home.recent_workflows': 'Quy trình gần đây',
    'home.live_activity': 'Hoạt động trực tiếp',
    'home.recent_executions': 'Lượt chạy gần đây',
    'home.see_all': 'Xem tất cả',
    'home.empty_title': 'Tạo quy trình đầu tiên của bạn',
    'home.empty_sub': 'Tự động hóa công việc lặp đi lặp lại với WEAV',

    // Workflows Screen
    'workflows.title': 'Quản lý Quy trình',
    'workflows.search_placeholder': 'Tìm kiếm quy trình...',
    'workflows.run_now': 'Chạy ngay',
    'workflows.pause': 'Tạm dừng',
    'workflows.resume': 'Tiếp tục',
    'workflows.view': 'Chi tiết',
    'workflows.draft_hint': 'Chỉnh sửa sơ đồ quy trình chi tiết chỉ có sẵn trên bản Web.',

    // Executions Screen
    'executions.title': 'Lịch sử Thực thi',
    'executions.duration': 'Thời gian',
    'executions.view_details': 'Xem chi tiết',
    'executions.progress': 'Tiến trình thực thi',
    'executions.retry': 'Thử lại lượt chạy',

    // Notifications Screen
    'notif.title': 'Thông báo & Cảnh báo',
    'notif.mark_all_read': 'Đánh dấu tất cả đã đọc',
    'notif.mark_read': 'Đánh dấu đã đọc',
    'notif.loading': 'Đang tải thông báo…',
    'notif.empty': 'Chưa có thông báo',
    'notif.error': 'Không tải được thông báo. Vui lòng thử lại.',
    'notif.update_error': 'Chưa cập nhật được trạng thái đã đọc. Vui lòng thử lại.',
    'notif.count_error': 'Chưa tải được số thông báo chưa đọc.',
    'notif.refresh': 'Làm mới',
    'notif.retry': 'Thử lại',
    'notif.more': 'Xem thêm',
    'notif.unread': 'chưa đọc',
    'notif.read': 'Đã đọc',
    'notif.pending': 'Chờ gửi',
    'notif.sending': 'Đang gửi',
    'notif.sent': 'Đã gửi',
    'notif.failed': 'Gửi thất bại',

    // Profile & Workspace Screen
    'profile.title': 'Hồ sơ cá nhân',
    'profile.current_ws': 'Không gian làm việc hiện tại',
    'profile.app_tools': 'Tính năng & Công cụ hỗ trợ',
    'profile.ai_gen': 'Tạo quy trình bằng AI',
    'profile.ai_gen_sub': 'Sinh chuỗi tự động hoá từ câu mô tả',
    'profile.conn': 'Kết nối dịch vụ API',
    'profile.conn_sub': 'Trạng thái chứng thực OAuth & API Key',
    'profile.tg': 'Trạng thái Telegram Bot',
    'profile.tg_sub': 'Nhận cảnh báo trực tiếp qua Telegram',
    'profile.prefs': 'Tùy chọn ứng dụng',
    'profile.settings': 'Cài đặt & Bảo mật',
    'profile.settings_sub': 'Chủ đề Sáng/Tối, Ngôn ngữ, Phiên làm việc',
    'profile.logout': 'Đăng xuất khỏi WEAV',

    // Settings Screen
    'settings.title': 'Cài đặt & Bảo mật',
    'settings.appearance': 'GIAO DIỆN & NGÔN NGỮ',
    'settings.dark_mode': 'Chế độ tối (Dark Mode)',
    'settings.language': 'Ngôn ngữ hệ thống',
    'settings.notifications': 'CẢNH BÁO THÔNG BÁO',
    'settings.push_alerts': 'Cảnh báo đẩy luồng thực thi',
    'settings.email_summaries': 'Báo cáo tổng kết tuần qua Email',
    'settings.security': 'BẢO MẬT & PHIÊN LÀM VIỆC',
    'settings.session_verified': 'Phiên đăng nhập đã xác thực',
    'settings.session_status': 'Trạng thái Token thiết bị di động OK',
    'settings.about': 'VỀ HỆ THỐNG',
    'settings.system_ver': 'WEAV Mobile Phiên bản 1.0',
    'settings.logout': 'Đăng xuất tài khoản di động',

    // Auth Screens
    'auth.sign_in': 'Đăng nhập',
    'auth.sign_in_sub': 'Nhập thông tin tài khoản của bạn để truy cập hệ thống giám sát.',
    'auth.email': 'Địa chỉ Email',
    'auth.password': 'Mật khẩu',
    'auth.sign_in_btn': 'Đăng nhập vào WEAV',
    'auth.no_account': 'Chưa có tài khoản?',
    'auth.register_now': 'Đăng ký ngay',
    'auth.register_title': 'Đăng ký Tài khoản',
    'auth.full_name': 'Họ và tên',
    'auth.create_btn': 'Tạo tài khoản mới',
    'auth.have_account': 'Đã có tài khoản?',
  },
  EN: {
    // Navigation Tabs
    'tab.home': 'Home',
    'tab.workflows': 'Workflows',
    'tab.executions': 'Executions',
    'tab.notifications': 'Alerts',
    'tab.profile': 'Profile',

    // Home Screen & Control Center
    'home.greeting': 'Good morning 👋',
    'home.ready_sub': 'Ready to automate your workflow today?',
    'home.overview': 'Workflow Overview',
    'home.activity_subtitle': 'Workflow activity • Last 7 days',
    'home.total_workflows': 'Total Workflows',
    'home.published': 'Published',
    'home.running': 'Running',
    'home.failed': 'Failed',
    'home.queued': 'Queued',
    'home.quick_actions': 'Quick Actions',
    'home.generate_ai': 'Generate with AI',
    'home.run_workflow': 'Run Workflow',
    'home.view_executions': 'View Executions',
    'home.connections': 'Connections',
    'home.ai_quick_title': 'Build with AI',
    'home.ai_quick_desc': 'Describe what you want to automate...',
    'home.recent_workflows': 'Recent Workflows',
    'home.live_activity': 'Live Activity',
    'home.recent_executions': 'Recent Executions',
    'home.see_all': 'See All',
    'home.empty_title': 'Build your first workflow',
    'home.empty_sub': 'Automate repetitive work with WEAV',

    // Workflows Screen
    'workflows.title': 'Workflows',
    'workflows.search_placeholder': 'Search workflows...',
    'workflows.run_now': 'Run Now',
    'workflows.pause': 'Pause',
    'workflows.resume': 'Resume',
    'workflows.view': 'View',
    'workflows.draft_hint': 'Workflow editing is available on Web.',

    // Executions Screen
    'executions.title': 'Executions History',
    'executions.duration': 'Duration',
    'executions.view_details': 'View Details',
    'executions.progress': 'Execution Progress',
    'executions.retry': 'Retry Execution',

    // Notifications Screen
    'notif.title': 'Notifications & Alerts',
    'notif.mark_all_read': 'Mark all as read',
    'notif.mark_read': 'Mark as read',
    'notif.loading': 'Loading notifications…',
    'notif.empty': 'No notifications yet',
    'notif.error': 'Unable to load notifications. Please try again.',
    'notif.update_error': 'Unable to update read status. Please try again.',
    'notif.count_error': 'Unread count is unavailable.',
    'notif.refresh': 'Refresh',
    'notif.retry': 'Try again',
    'notif.more': 'Load more',
    'notif.unread': 'unread',
    'notif.read': 'Read',
    'notif.pending': 'Pending delivery',
    'notif.sending': 'Sending',
    'notif.sent': 'Delivered',
    'notif.failed': 'Delivery failed',

    // Profile & Workspace Screen
    'profile.title': 'My Profile',
    'profile.current_ws': 'Current Workspace',
    'profile.app_tools': 'App Features & Tools',
    'profile.ai_gen': 'AI Workflow Generator',
    'profile.ai_gen_sub': 'Generate automation pipelines from text prompt',
    'profile.conn': 'Service Connections',
    'profile.conn_sub': 'OAuth & API credentials status',
    'profile.tg': 'Telegram Bot Status',
    'profile.tg_sub': 'Link mobile alerts to @weav_automation_bot',
    'profile.prefs': 'Preferences',
    'profile.settings': 'Settings & Security',
    'profile.settings_sub': 'Theme, sessions, notification preferences',
    'profile.logout': 'Sign Out from WEAV',

    // Settings Screen
    'settings.title': 'Settings & Security',
    'settings.appearance': 'APPEARANCE & LANGUAGE',
    'settings.dark_mode': 'Dark Theme Mode',
    'settings.language': 'System Language',
    'settings.notifications': 'NOTIFICATION ALERTS',
    'settings.push_alerts': 'Push Execution Alerts',
    'settings.email_summaries': 'Email Weekly Summaries',
    'settings.security': 'SECURITY & SESSION',
    'settings.session_verified': 'Active Session Verified',
    'settings.session_status': 'Mobile Device Token Status OK',
    'settings.about': 'ABOUT SYSTEM',
    'settings.system_ver': 'WEAV Mobile V1.0',
    'settings.logout': 'Log Out from Mobile',

    // Auth Screens
    'auth.sign_in': 'Sign In',
    'auth.sign_in_sub': 'Enter your account details to access workspace monitoring.',
    'auth.email': 'Email Address',
    'auth.password': 'Password',
    'auth.sign_in_btn': 'Sign In to WEAV',
    'auth.no_account': "Don't have an account?",
    'auth.register_now': 'Register',
    'auth.register_title': 'Register Account',
    'auth.full_name': 'Full Name',
    'auth.create_btn': 'Create Account',
    'auth.have_account': 'Already have an account?',
  },
};

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string) => string;
}

export const useI18nStore = create<I18nState>((set, get) => ({
  language: 'VI',
  setLanguage: (language) => set({ language }),
  toggleLanguage: () => set((state) => ({ language: state.language === 'VI' ? 'EN' : 'VI' })),
  t: (key: string) => {
    const lang = get().language;
    return translations[lang]?.[key] || key;
  },
}));
