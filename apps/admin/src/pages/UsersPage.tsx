import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { listUsers, type AdminUser, type AdminUserStatus, type UserPage } from '../api/users';
import { RoleBadge, StatusBadge } from '../components/UserBadges';
import { UserStatusButton } from '../components/UserStatusButton';
import { useFormatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import { getProfile } from '../lib/session';
import { btnCls, fieldCls, td, th } from '../lib/ui';

const PAGE_SIZE = 20;

const initials = (user: AdminUser) =>
  (user.displayName?.trim() || user.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** UC025: every account, with search, a status filter and enable/disable. */
export function UsersPage() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const meId = getProfile()?.id;
  const ids = { search: useId(), status: useId() };
  const [page, setPage] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminUserStatus | ''>('');
  const [actionError, setActionError] = useState('');

  // Debounce the search box so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const queryKey = ['admin', 'users', { page, search, status }] as const;
  const users = useQuery({
    queryKey,
    queryFn: () => listUsers({ page, size: PAGE_SIZE, search, status: status || undefined }),
    placeholderData: (previous) => previous,
  });
  const data = users.data;

  const onChanged = (updated: AdminUser) => {
    queryClient.setQueryData<UserPage>(queryKey, (current) => current && { ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) });
    // Refetch so a status filter drops the row that no longer matches.
    if (status) void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t('users.title')}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('users.subtitle')}</p>
        </div>
        <button type="button" className={btnCls} onClick={() => void users.refetch()} disabled={users.isFetching}>
          <RefreshCw size={14} className={users.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 text-xs font-medium text-text-2 sm:max-w-sm">
          <label htmlFor={ids.search}>{t('users.search')}</label>
          <div className="relative mt-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input id={ids.search} type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={64} className={`${fieldCls} block w-full pl-8`} />
          </div>
        </div>
        <div className="text-xs font-medium text-text-2">
          <label htmlFor={ids.status}>{t('users.status')}</label>
          <select
            id={ids.status}
            value={status}
            onChange={(event) => {
              setPage(0);
              setStatus(event.target.value as AdminUserStatus | '');
            }}
            className={`${fieldCls} mt-1 block`}
          >
            <option value="">{t('users.all')}</option>
            <option value="ACTIVE">{t('users.status_active')}</option>
            <option value="DISABLED">{t('users.status_disabled')}</option>
          </select>
        </div>
      </div>

      {(users.isError || actionError) && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{actionError || t('users.load_error')}</span>
          {users.isError && !actionError && (
            <button type="button" className="font-medium underline" onClick={() => void users.refetch()}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">{t('users.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>{t('users.col_user')}</th>
              <th scope="col" className={th}>{t('users.role')}</th>
              <th scope="col" className={th}>{t('users.status')}</th>
              <th scope="col" className={th}>{t('users.col_joined')}</th>
              <th scope="col" className={`${th} text-right`}><span className="sr-only">{t('users.col_actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.id} data-testid="user-row" className="transition-colors hover:bg-subtle">
                <td className={`${td} max-w-[360px]`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-subtle text-xs font-semibold text-foreground">
                      {initials(item)}
                    </span>
                    <div className="min-w-0">
                      <Link to={`/users/${item.id}`} title={item.email} className="block truncate font-medium text-foreground hover:underline">
                        {item.displayName || item.email}
                        {item.id === meId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t('users.you')})</span>}
                      </Link>
                      {(item.displayName || !item.emailVerifiedAt) && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.displayName && item.email}
                          {item.displayName && !item.emailVerifiedAt && ' · '}
                          {!item.emailVerifiedAt && <span className="text-warn">{t('users.unverified')}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className={`${td} whitespace-nowrap`}><RoleBadge role={item.systemRole} /></td>
                <td className={td}><StatusBadge status={item.status} /></td>
                <td className={`${td} whitespace-nowrap tabular-nums text-text-2`}>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </td>
                <td className={`${td} text-right`}>
                  <UserStatusButton user={item} onChanged={onChanged} onError={setActionError} />
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-[13px] text-text-2">
                  {search || status ? t('users.empty_filtered') : t('users.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {users.isLoading && (
          <div role="status" className="flex justify-center py-10">
            <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          </div>
        )}
      </div>

      {data && data.totalItems > 0 && (
        <nav aria-label={t('users.pagination')} className="flex items-center justify-end gap-3 text-xs text-text-2">
          <span data-testid="users-page-info" className="tabular-nums">
            {t('users.page_info', { page: data.page + 1, pages: Math.max(1, data.totalPages), total: data.totalItems })}
          </span>
          <button type="button" className={btnCls} disabled={page <= 0 || users.isFetching} onClick={() => setPage(page - 1)}>{t('common.prev')}</button>
          <button type="button" className={btnCls} disabled={page >= data.totalPages - 1 || users.isFetching} onClick={() => setPage(page + 1)}>{t('common.next')}</button>
        </nav>
      )}
    </div>
  );
}
