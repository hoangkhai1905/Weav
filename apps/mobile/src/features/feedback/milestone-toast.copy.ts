import type { Language } from '../../stores/i18n.store';

export type MilestoneToastKey =
  | 'workspace.created'
  | 'workspace.renamed'
  | 'workspace.member_added'
  | 'workspace.permissions_updated'
  | 'workspace.member_removed'
  | 'workspace.left'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'workflow.started'
  | 'profile.updated'
  | 'connection.verified'
  | 'auth.password_changed'
  | 'auth.password_reset';

const copy: Record<Language, Record<MilestoneToastKey, [string, string]>> = {
  VI: {
    'workspace.created': ['Đã tạo không gian', 'Không gian làm việc đã được tạo thành công.'],
    'workspace.renamed': ['Đã đổi tên không gian', 'Tên không gian làm việc đã được cập nhật.'],
    'workspace.member_added': ['Đã thêm thành viên', 'Thành viên đã được thêm vào không gian.'],
    'workspace.permissions_updated': ['Đã cập nhật quyền', 'Quyền thành viên đã được cập nhật.'],
    'workspace.member_removed': ['Đã xóa thành viên', 'Thay đổi thành viên đã được lưu.'],
    'workspace.left': ['Đã rời không gian', 'Bạn đã rời không gian làm việc.'],
    'workflow.paused': ['Đã tạm dừng quy trình', 'Quy trình đã được tạm dừng.'],
    'workflow.resumed': ['Đã tiếp tục quy trình', 'Quy trình đã được tiếp tục.'],
    'workflow.started': ['Đã gửi lượt chạy', 'Lượt chạy đã được xếp hàng; trạng thái sẽ cập nhật khi có kết quả.'],
    'profile.updated': ['Đã lưu hồ sơ', 'Thông tin hồ sơ đã được cập nhật.'],
    'connection.verified': ['Đã kiểm tra kết nối', 'Dịch vụ đã phản hồi thành công với yêu cầu kiểm tra.'],
    'auth.password_changed': ['Đã đổi mật khẩu', 'Mật khẩu đã được cập nhật; phiên đăng nhập sẽ kết thúc.'],
    'auth.password_reset': ['Đã đặt lại mật khẩu', 'Bạn có thể đăng nhập bằng mật khẩu mới.'],
  },
  EN: {
    'workspace.created': ['Workspace created', 'The workspace was created successfully.'],
    'workspace.renamed': ['Workspace renamed', 'The workspace name was updated.'],
    'workspace.member_added': ['Member added', 'The member was added to the workspace.'],
    'workspace.permissions_updated': ['Permissions updated', 'The member permissions were updated.'],
    'workspace.member_removed': ['Member removed', 'The membership change was saved.'],
    'workspace.left': ['Workspace left', 'You left the workspace.'],
    'workflow.paused': ['Workflow paused', 'The workflow was paused.'],
    'workflow.resumed': ['Workflow resumed', 'The workflow was resumed.'],
    'workflow.started': ['Run queued', 'The run was queued; its outcome will appear when available.'],
    'profile.updated': ['Profile saved', 'Your profile information was updated.'],
    'connection.verified': ['Connection test succeeded', 'The service responded successfully to the test request.'],
    'auth.password_changed': ['Password changed', 'Your password was updated; this session will end.'],
    'auth.password_reset': ['Password reset', 'You can now sign in with your new password.'],
  },
};

export function getMilestoneToastCopy(
  key: MilestoneToastKey,
  language: Language,
): { title: string; message: string } {
  const [title, message] = copy[language][key];
  return { title, message };
}
