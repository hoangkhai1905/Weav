import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { listExecutions, type ExecutionStatus } from '../api/executions';
import { listWorkspaces } from '../api/workspaces';
import { ExecutionPanel } from '../components/ExecutionPanel';
import { RunStatusBadge } from '../components/RunStatusBadge';
import { dayEndExclusiveIso, dayStartIso, enumLabel, formatDuration, rangeProblem } from '../lib/executions';
import { useFormatDateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { btnCls, fieldCls, tableWrapCls, td, th } from '../lib/ui';

const PAGE_SIZE = 20;
const STATUSES: ExecutionStatus[] = ['QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'];

/** UC028: runs across all workspaces, read-only, with a side panel for the steps of one run. */
export function ExecutionsPage() {
  const t = useT();
  const formatDateTime = useFormatDateTime();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId') || undefined;
  const ids = { status: useId(), from: useId(), to: useId() };
  const [status, setStatus] = useState<ExecutionStatus | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // The page number belongs to the workspace it was chosen for, so another workspace starts at page 1.
  const [pageState, setPageState] = useState({ workspaceId, page: 0 });
  const page = pageState.workspaceId === workspaceId ? pageState.page : 0;
  const [openId, setOpenId] = useState<string | null>(null);

  const from = fromDate ? dayStartIso(fromDate) : undefined;
  const to = toDate ? dayEndExclusiveIso(toDate) : undefined;
  const problem = rangeProblem(from, to);

  const runs = useQuery({
    queryKey: ['admin', 'executions', { status, workspaceId, from, to, page }],
    queryFn: () => listExecutions({ status: status || undefined, workspaceId, from, to, page, size: PAGE_SIZE }),
    placeholderData: (previous) => previous,
    enabled: !problem,
  });
  const data = problem ? undefined : runs.data;

  // One lookup per loaded page turns workspace ids into names (the filter's id rides along for the chip).
  const wsIds = useMemo(
    () => [...new Set([...(data?.items ?? []).map((item) => item.workspaceId), ...(workspaceId ? [workspaceId] : [])])].sort(),
    [data, workspaceId],
  );
  const names = useQuery({
    queryKey: ['admin', 'workspace-names', wsIds],
    queryFn: () => listWorkspaces({ ids: wsIds, size: 100 }),
    enabled: wsIds.length > 0,
  });
  const nameOf = (id: string) => names.data?.items.find((w) => w.id === id)?.name ?? '—';

  const setPage = (next: number) => setPageState({ workspaceId, page: next });
  const clearWorkspace = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('workspaceId');
    setSearchParams(next);
  };
  const filtered = !!(status || workspaceId || from || to);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t('exec.title')}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('exec.subtitle')}</p>
        </div>
        <button type="button" className={btnCls} onClick={() => void runs.refetch()} disabled={runs.isFetching || !!problem}>
          <RefreshCw size={14} className={runs.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="text-xs font-medium text-text-2">
          <label htmlFor={ids.status}>{t('exec.col_status')}</label>
          <select id={ids.status} value={status} onChange={(event) => { setPage(0); setStatus(event.target.value as ExecutionStatus | ''); }} className={`${fieldCls} mt-1 block`}>
            <option value="">{t('common.all')}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{enumLabel(t, 'run.status', value)}</option>)}
          </select>
        </div>
        <div className="text-xs font-medium text-text-2">
          <label htmlFor={ids.from}>{t('exec.from')}</label>
          <input id={ids.from} type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setPage(0); setFromDate(event.target.value); }} className={`${fieldCls} mt-1 block`} />
        </div>
        <div className="text-xs font-medium text-text-2">
          <label htmlFor={ids.to}>{t('exec.to')}</label>
          <input id={ids.to} type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setPage(0); setToDate(event.target.value); }} className={`${fieldCls} mt-1 block`} />
        </div>
        {workspaceId && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-subtle pl-3 pr-1 text-[13px]">
            {t('exec.workspace_chip', { name: names.data ? nameOf(workspaceId) : '…' })}
            <button type="button" onClick={clearWorkspace} aria-label={t('exec.clear_workspace')} className="inline-flex size-6 items-center justify-center rounded-full text-text-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        )}
      </div>

      {problem && (
        <p role="alert" className="text-[13px] text-err">{t(problem === 'long' ? 'exec.range_long' : 'exec.range_order')}</p>
      )}
      {runs.isError && !problem && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('exec.load_error')}</span>
          <button type="button" className="font-medium underline" onClick={() => void runs.refetch()}>{t('common.retry')}</button>
        </div>
      )}

      <div className={tableWrapCls}>
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <caption className="sr-only">{t('exec.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>{t('exec.col_workflow')}</th>
              <th scope="col" className={th}>{t('exec.col_workspace')}</th>
              <th scope="col" className={th}>{t('exec.col_trigger')}</th>
              <th scope="col" className={th}>{t('exec.col_status')}</th>
              <th scope="col" className={th}>{t('exec.started')}</th>
              <th scope="col" className={`${th} text-right`}>{t('exec.col_duration')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr key={item.executionId} data-testid="execution-row" className="cursor-pointer transition-colors hover:bg-subtle" onClick={() => setOpenId(item.executionId)}>
                <td className={`${td} max-w-[260px]`}>
                  <button type="button" className="block max-w-full truncate text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={t('exec.open_details')}>
                    {item.workflowName}
                  </button>
                </td>
                <td className={`${td} max-w-[200px] truncate text-text-2`}>{names.data ? nameOf(item.workspaceId) : '—'}</td>
                <td className={`${td} whitespace-nowrap text-text-2`}>{enumLabel(t, 'run.trigger', item.triggerType)}</td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <RunStatusBadge status={item.status} />
                    {item.errorCode && <span className="truncate font-mono text-xs text-err">{item.errorCode}</span>}
                  </div>
                </td>
                <td className={`${td} whitespace-nowrap tabular-nums text-text-2`}>{formatDateTime(item.startedAt ?? item.createdAt)}</td>
                <td className={`${td} whitespace-nowrap text-right tabular-nums text-text-2`}>{formatDuration(item.durationMs)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-[13px] text-text-2">{filtered ? t('exec.empty_filtered') : t('exec.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
        {runs.isLoading && !problem && (
          <div role="status" className="flex justify-center py-10">
            <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
          </div>
        )}
      </div>

      {data && data.totalElements > 0 && (
        <nav aria-label={t('common.pagination')} className="flex items-center justify-end gap-3 text-xs text-text-2">
          <span data-testid="executions-page-info" className="tabular-nums">{t('exec.page_info', { page: data.page + 1, total: data.totalElements })}</span>
          <button type="button" className={btnCls} disabled={page <= 0 || runs.isFetching} onClick={() => setPage(page - 1)}>{t('common.prev')}</button>
          <button type="button" className={btnCls} disabled={!data.hasNext || runs.isFetching} onClick={() => setPage(page + 1)}>{t('common.next')}</button>
        </nav>
      )}

      {openId && <ExecutionPanel key={openId} executionId={openId} workspaceName={nameOf(data?.items.find((item) => item.executionId === openId)?.workspaceId ?? '')} onClose={() => setOpenId(null)} />}
    </div>
  );
}
