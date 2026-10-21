import type { AdminUser } from '../api/users';
import { useT } from '../lib/i18n';
import { statusBadgeClass } from '../lib/ui';

export function RoleBadge({ role }: { role: AdminUser['systemRole'] }) {
  const t = useT();
  return role === 'ADMIN' ? <span className={statusBadgeClass('run')}>{t('users.role_admin')}</span> : <span className="text-text-2">{t('users.role_user')}</span>;
}

export function StatusBadge({ status }: { status: AdminUser['status'] }) {
  const t = useT();
  return <span className={statusBadgeClass(status === 'ACTIVE' ? 'ok' : 'pause')}>{status === 'ACTIVE' ? t('users.status_active') : t('users.status_disabled')}</span>;
}
