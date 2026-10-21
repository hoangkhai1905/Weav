import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { listWorkspaces } from '../api/workspaces';
import { useFormatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import { btnCls, fieldCls, tableWrapCls, td, th } from '../lib/ui';

const PAGE_SIZE = 20;

/** UC027: every workspace with its owner and size; a row opens that workspace's runs. */
export function WorkspacesPage() {
  const t = useT();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const searchId = useId();
  const [page, setPage] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');

  // Debounce the search box so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const workspaces = useQuery({
    queryKey: ['admin', 'workspaces', { page, search }],
    queryFn: () => listWorkspaces({ page, size: PAGE_SIZE, q: search }),
    placeholderData: (previous) => previous,
  });
  const data = workspaces.data;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t('ws.title')}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('ws.subtitle')}</p>
        </div>
        <button type="button" className={btnCls} onClick={() => void workspaces.refetch()} disabled={workspaces.isFetching}>
          <RefreshCw size={14} className={workspaces.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      <div className="min-w-[220px] max-w-sm text-xs font-medium text-text-2">
        <label htmlFor={searchId}>{t('ws.search')}</label>
        <div className="relative mt-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input id={searchId} type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} className={`${fieldCls} block w-full pl-8`} />
        </div>
      </div>

      {workspaces.isError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('ws.load_error')}</span>
          <button type="button" className="font-medium underline" onClick={() => void workspaces.refetch()}>{t('common.retry')}</button>
        </div>
      )}

      <div className={tableWrapCls}>
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <caption className="sr-only">{t('ws.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>{t('ws.col_name')}</th>
              <th scope="col" className={th}>{t('ws.col_owner')}</th>
              <th scope="col" className={`${th} text-right`}>{t('ws.col_members')}</th>
              <th scope="col" className={th}>{t('ws.col_created')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.id} data-testid="workspace-row" className="cursor-pointer transition-colors hover:bg-subtle" onClick={() => navigate(`/executions?workspaceId=${encodeURIComponent(item.id)}`)}>
                <td className={`${td} max-w-[280px]`}>
                  <Link to={`/executions?workspaceId=${encodeURIComponent(item.id)}`} onClick={(event) => event.stopPropagation()} title={t('ws.open_runs')} className="block truncate font-medium text-foreground hover:underline">
                    {item.name}
                  </Link>
                </td>
                <td className={`${td} max-w-[280px] truncate text-text-2`}>{item.ownerEmail ?? '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{item.memberCount}</td>
                <td className={`${td} whitespace-nowrap tabular-nums text-text-2`}>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-[13px] text-text-2">{search ? t('ws.empty_filtered') : t('ws.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
        {workspaces.isLoading && (
          <div role="status" className="flex justify-center py-10">
            <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          </div>
        )}
      </div>

      {data && data.totalElements > 0 && (
        <nav aria-label={t('common.pagination')} className="flex items-center justify-end gap-3 text-xs text-text-2">
          <span data-testid="workspaces-page-info" className="tabular-nums">
            {t('ws.page_info', { page: data.page + 1, pages: Math.max(1, data.totalPages), total: data.totalElements })}
          </span>
          <button type="button" className={btnCls} disabled={page <= 0 || workspaces.isFetching} onClick={() => setPage(page - 1)}>{t('common.prev')}</button>
          <button type="button" className={btnCls} disabled={page >= data.totalPages - 1 || workspaces.isFetching} onClick={() => setPage(page + 1)}>{t('common.next')}</button>
        </nav>
      )}
    </div>
  );
}
