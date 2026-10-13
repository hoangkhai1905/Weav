/** Run history list (v2 design): search box, result filters, "running" wording. */
export const historyVi: Record<string, string> = {
  'rl.search.placeholder': 'Tìm theo tên quy trình hoặc mã lượt chạy',
  'rl.search.label': 'Tìm lượt chạy',
  'rl.filter.label': 'Lọc theo kết quả',
  'rl.filter.all': 'Tất cả',
  'rl.filter.failed': 'Lỗi',
  'rl.filter.success': 'Thành công',
  'rl.filter.running': 'Đang chạy',
  'rl.inProgress': 'đang chạy',
  'rl.open': '{name}, {time}',
};

export const historyEn: Record<string, string> = {
  'rl.search.placeholder': 'Search by workflow name or run ID',
  'rl.search.label': 'Search runs',
  'rl.filter.label': 'Filter by result',
  'rl.filter.all': 'All',
  'rl.filter.failed': 'Failed',
  'rl.filter.success': 'Succeeded',
  'rl.filter.running': 'Running',
  'rl.inProgress': 'running',
  'rl.open': '{name}, {time}',
};
