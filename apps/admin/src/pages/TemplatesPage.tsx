import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { ApiError } from '../api/client';
import { listPublicTemplates, takeDown, type PublicTemplate } from '../api/templates';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useFormatDate } from '../lib/format';
import { useT } from '../lib/i18n';
import { btnCls, fieldCls, td, th } from '../lib/ui';

const PAGE_SIZE = 20;
const takeDownBtnCls = btnCls.replace('h-8', 'h-7').replace('px-3 text-[13px]', 'px-2.5 text-xs').replace('text-foreground', 'text-err').replace('hover:bg-subtle', 'hover:bg-err-bg');

/** Public templates, read-only except for taking one down (it becomes private, so only its author sees it). */
export function TemplatesPage() {
  const t = useT();
  const formatDate = useFormatDate();
  const searchId = useId();
  const [page, setPage] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<PublicTemplate | null>(null);
  const [actionError, setActionError] = useState('');

  // Debounce the search box so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const templates = useQuery({
    queryKey: ['admin', 'templates', { page, search }],
    queryFn: () => listPublicTemplates({ page, size: PAGE_SIZE, q: search }),
    placeholderData: (previous) => previous,
  });
  const data = templates.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalElements / (data.size || PAGE_SIZE))) : 1;

  const confirmTakeDown = async () => {
    if (!target) return;
    const { id } = target;
    setTarget(null);
    setActionError('');
    try {
      await takeDown(id);
      // The row leaves the public list; step back if that was the last one on this page.
      if (page > 0 && data?.items.length === 1) setPage(page - 1);
    } catch (error) {
      setActionError(error instanceof ApiError && (error.status === 403 || error.status === 409) ? t('tpl.takedown_conflict') : t('tpl.takedown_error'));
    }
    await templates.refetch();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t('tpl.title')}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('tpl.subtitle')}</p>
        </div>
        <button type="button" className={btnCls} onClick={() => void templates.refetch()} disabled={templates.isFetching}>
          <RefreshCw size={14} className={templates.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      <div className="min-w-[220px] max-w-sm text-xs font-medium text-text-2">
        <label htmlFor={searchId}>{t('tpl.search')}</label>
        <div className="relative mt-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input id={searchId} type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} className={`${fieldCls} block w-full pl-8`} />
        </div>
      </div>

      {(templates.isError || actionError) && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{actionError || t('tpl.load_error')}</span>
          {templates.isError && !actionError && (
            <button type="button" className="font-medium underline" onClick={() => void templates.refetch()}>{t('common.retry')}</button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">{t('tpl.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>{t('tpl.col_name')}</th>
              <th scope="col" className={th}>{t('tpl.col_author')}</th>
              <th scope="col" className={`${th} text-right`}>{t('tpl.col_uses')}</th>
              <th scope="col" className={th}>{t('tpl.col_published')}</th>
              <th scope="col" className={`${th} text-right`}>{t('tpl.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.id} data-testid="template-row">
                <td className={`${td} h-auto max-w-[320px] py-2`}>
                  <span className="block truncate font-medium">{item.name}</span>
                  {item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}
                </td>
                <td className={`${td} max-w-[200px] truncate text-text-2`}>{item.authorName ?? '—'}</td>
                <td className={`${td} text-right tabular-nums`}>{item.usageCount}</td>
                <td className={`${td} whitespace-nowrap tabular-nums text-text-2`}>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </td>
                <td className={`${td} text-right`}>
                  <button type="button" className={takeDownBtnCls} aria-label={`${t('tpl.take_down')}: ${item.name}`} onClick={() => setTarget(item)}>
                    {t('tpl.take_down')}
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-[13px] text-text-2">{search ? t('tpl.empty_filtered') : t('tpl.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
        {templates.isLoading && (
          <div role="status" className="flex justify-center py-10">
            <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          </div>
        )}
      </div>

      {data && data.totalElements > 0 && (
        <nav aria-label={t('common.pagination')} className="flex items-center justify-end gap-3 text-xs text-text-2">
          <span data-testid="templates-page-info" className="tabular-nums">
            {t('tpl.page_info', { page: data.page + 1, pages: totalPages, total: data.totalElements })}
          </span>
          <button type="button" className={btnCls} disabled={page <= 0 || templates.isFetching} onClick={() => setPage(page - 1)}>{t('common.prev')}</button>
          <button type="button" className={btnCls} disabled={page >= totalPages - 1 || templates.isFetching} onClick={() => setPage(page + 1)}>{t('common.next')}</button>
        </nav>
      )}

      <ConfirmDialog
        open={target !== null}
        danger
        title={t('tpl.confirm_title')}
        description={<><strong className="font-semibold text-foreground">{target?.name}</strong><br />{t('tpl.confirm_body')}</>}
        confirmText={t('tpl.take_down')}
        onConfirm={confirmTakeDown}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
