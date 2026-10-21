import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, LoaderCircle } from 'lucide-react';
import { ApiError } from '../api/client';
import { getUser, type AdminUser } from '../api/users';
import { listWorkspaces } from '../api/workspaces';
import { RoleBadge, StatusBadge } from '../components/UserBadges';
import { UserStatusButton } from '../components/UserStatusButton';
import { useFormatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import { CARD } from '../lib/ui';

const backLinkCls = 'inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink hover:underline';

/** UC026: one account's profile, its enable/disable control and the workspaces it owns. */
export function UserDetailPage() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const [actionError, setActionError] = useState('');

  const user = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => getUser(id) });
  const owned = useQuery({
    queryKey: ['admin', 'user', id, 'workspaces'],
    queryFn: () => listWorkspaces({ ownerId: id, size: 100 }),
    enabled: user.isSuccess,
  });

  const back = (
    <Link to="/users" className={backLinkCls}>
      <ArrowLeft size={14} aria-hidden="true" />
      {t('userdetail.back')}
    </Link>
  );

  if (user.isLoading) {
    return (
      <div role="status" className="flex justify-center py-16">
        <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
      </div>
    );
  }

  if (user.isError || !user.data) {
    const missing = user.error instanceof ApiError && user.error.status === 404;
    return (
      <div className="space-y-3">
        {back}
        {missing ? (
          <>
            <h1 className="text-xl font-semibold">{t('userdetail.not_found_title')}</h1>
            <p className="text-[13px] text-muted-foreground">{t('userdetail.not_found_body')}</p>
          </>
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{t('userdetail.load_error')}</span>
            <button type="button" className="font-medium underline" onClick={() => void user.refetch()}>{t('common.retry')}</button>
          </div>
        )}
      </div>
    );
  }

  const profile = user.data;
  const onChanged = (updated: AdminUser) => {
    queryClient.setQueryData(['admin', 'user', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      {back}

      <section className={`${CARD} space-y-4 p-5`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{profile.displayName || profile.email}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              <RoleBadge role={profile.systemRole} />
              <StatusBadge status={profile.status} />
            </div>
          </div>
          <UserStatusButton user={profile} onChanged={onChanged} onError={setActionError} />
        </div>

        {actionError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-3 text-[13px] text-err">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
        )}

        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t('userdetail.email')}</dt>
            <dd className="mt-0.5 break-all">{profile.email}</dd>
            <dd className={`mt-0.5 text-xs ${profile.emailVerifiedAt ? 'text-muted-foreground' : 'text-warn'}`}>
              {profile.emailVerifiedAt ? `${t('userdetail.verified')} · ${formatDate(profile.emailVerifiedAt)}` : t('users.unverified')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('userdetail.joined')}</dt>
            <dd className="mt-0.5">{formatDate(profile.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('userdetail.workspaces')}</h2>
        {owned.isLoading && (
          <div role="status" className="flex py-4">
            <LoaderCircle size={16} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          </div>
        )}
        {owned.isError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-3 text-[13px] text-err">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{t('userdetail.workspaces_error')}</span>
            <button type="button" className="font-medium underline" onClick={() => void owned.refetch()}>{t('common.retry')}</button>
          </div>
        )}
        {owned.data && owned.data.items.length === 0 && <p className="text-[13px] text-muted-foreground">{t('userdetail.workspaces_empty')}</p>}
        {owned.data && owned.data.items.length > 0 && (
          <ul className={`${CARD} divide-y divide-border`}>
            {owned.data.items.map((workspace) => (
              <li key={workspace.id}>
                <Link to={`/executions?workspaceId=${encodeURIComponent(workspace.id)}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] transition-colors hover:bg-subtle">
                  <span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
                  <span className="text-text-2">{t('userdetail.members', { count: workspace.memberCount })}</span>
                  <span className="tabular-nums text-muted-foreground">{t('userdetail.created', { date: formatDate(workspace.createdAt) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
