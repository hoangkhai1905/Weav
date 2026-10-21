import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useT } from '../lib/i18n';
import { getProfile } from '../lib/session';
import { CARD } from '../lib/ui';

export function OverviewPage() {
  const t = useT();
  const profile = getProfile();
  const users = useQuery({
    queryKey: ['admin', 'users', 'total'],
    queryFn: async () => (await api.get<{ totalItems: number }>('/api/admin/users', { params: { page: 0, size: 1 } })).data.totalItems,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('overview.title')}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('overview.subtitle', { name: profile?.displayName?.trim() || profile?.email || '' })}</p>
      </div>
      <div className={`${CARD} max-w-xs p-4`}>
        <p className="text-[13px] text-muted-foreground">{t('overview.users_total')}</p>
        <p data-testid="overview-users-total" className="mt-1 text-2xl font-semibold">
          {users.data ?? '–'}
        </p>
        {users.isError && <p className="mt-1 text-xs text-err">{t('overview.load_error')}</p>}
      </div>
    </div>
  );
}
