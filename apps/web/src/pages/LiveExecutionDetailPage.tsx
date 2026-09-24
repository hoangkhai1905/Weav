import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, LoaderCircle, Play, RefreshCw, XCircle } from 'lucide-react';
import { executionApi } from '../api/execution.api';
import { workflowApi } from '../api/workflow.api';
import type { ExecutionDetail, WorkflowDefinition } from '../types/workflow.types';
import { useI18nStore } from '../store/useI18nStore';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Workflow service is temporarily unavailable.';
}

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function LiveExecutionDetailPage() {
  const { executionId = '' } = useParams<{ executionId: string }>();
  const [searchParams] = useSearchParams();
  const workflowId = searchParams.get('workflowId') ?? undefined;
  const navigate = useNavigate();
  const { t } = useI18nStore();
  const isVietnamese = t('executions.col_status') === 'Trạng thái';
  const [execution, setExecution] = useState<ExecutionDetail | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await executionApi.getExecution(decodeURIComponent(executionId), workflowId);
      if (!result) {
        setExecution(null);
        setWorkflow(null);
        setError(isVietnamese ? 'Không tìm thấy lượt chạy trong workspace hiện tại.' : 'Execution was not found in the active workspace.');
        return;
      }
      const definition = await workflowApi.getWorkflow(result.workflowId);
      setExecution(result);
      setWorkflow(definition);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [executionId, isVietnamese, workflowId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!execution || !['QUEUED', 'RUNNING'].includes(execution.status)) return;
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [execution, refresh]);

  const nodeResults = useMemo(() => Object.values(execution?.nodeResults ?? {}), [execution]);

  const rerun = async () => {
    if (!execution) return;
    setNotice(null);
    try {
      const currentWorkflow = workflow ?? await workflowApi.getWorkflow(execution.workflowId);
      if (!currentWorkflow || currentWorkflow.status !== 'PUBLISHED') {
        setNotice(isVietnamese ? 'Chỉ có thể chạy workflow đang Published.' : 'Only a published workflow can be run.');
        return;
      }
      const receipt = await workflowApi.runWorkflow(execution.workflowId);
      setNotice(isVietnamese
        ? `Đã đưa lượt chạy ${receipt.executionId} vào hàng đợi.`
        : `Execution ${receipt.executionId} was queued.`);
      await refresh(true);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  if (loading && !execution && !error) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle size={20} className="animate-spin" />{isVietnamese ? 'Đang tải lượt chạy…' : 'Loading execution…'}</div>;
  }

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => navigate('/executions')} aria-label={isVietnamese ? 'Quay lại' : 'Back'} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700"><ArrowLeft size={17} /></button>
          <div>
            <p className="text-xs text-slate-500">{t('executions.title')}</p>
            <h1 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{workflow?.name ?? execution?.workflowName ?? executionId}</h1>
            {execution && <p className="mt-1 font-mono text-xs text-slate-500">{execution.id}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{isVietnamese ? 'Làm mới' : 'Refresh'}</button>
          <button type="button" onClick={() => void rerun()} disabled={!execution || execution.status === 'QUEUED' || execution.status === 'RUNNING'} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Play size={15} />{isVietnamese ? 'Chạy lại' : 'Run again'}</button>
        </div>
      </header>

      {notice && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">{notice}</p>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><AlertTriangle size={17} className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span><button type="button" className="underline" onClick={() => void refresh()}>{isVietnamese ? 'Thử lại' : 'Retry'}</button></div>}

      {execution && (
        <>
          <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-800 dark:bg-slate-900">
            <div><p className="text-xs text-slate-500">{t('executions.col_status')}</p><p className="mt-1 font-medium">{execution.status}</p></div>
            <div><p className="text-xs text-slate-500">{t('executions.col_started')}</p><p className="mt-1 text-sm">{formatDate(execution.startedAt)}</p></div>
            <div><p className="text-xs text-slate-500">{t('executions.duration')}</p><p className="mt-1 font-mono text-sm">{execution.durationMs === undefined ? '—' : `${execution.durationMs} ms`}</p></div>
            <div><p className="text-xs text-slate-500">{isVietnamese ? 'Loại kích hoạt' : 'Trigger type'}</p><p className="mt-1 text-sm">{execution.triggerType}</p></div>
            {execution.completedAt && <div><p className="text-xs text-slate-500">{isVietnamese ? 'Hoàn tất' : 'Finished'}</p><p className="mt-1 text-sm">{formatDate(execution.completedAt)}</p></div>}
            {workflow && <div><p className="text-xs text-slate-500">{isVietnamese ? 'Trạng thái workflow' : 'Workflow status'}</p><p className="mt-1 text-sm">{workflow.status}</p></div>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-semibold">{isVietnamese ? 'Các bước thực thi' : 'Execution steps'} <span className="text-sm font-normal text-slate-500">({nodeResults.length})</span></h2>
            {nodeResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">{isVietnamese ? 'Service chưa trả về node execution cho lượt chạy này.' : 'The service has not returned node execution details for this run.'}</p>
            ) : (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {nodeResults.map((node) => (
                  <article key={node.nodeId} className="grid gap-3 py-3 md:grid-cols-[1fr_auto]">
                    <div>
                      <h3 className="text-sm font-medium">{node.nodeName}</h3>
                      <p className="mt-1 text-xs text-slate-500">{node.nodeId} · {formatDate(node.startedAt)}{node.completedAt ? ` — ${formatDate(node.completedAt)}` : ''}</p>
                      {node.error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{node.error}</p>}
                      {(node.input !== undefined || node.output !== undefined) && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-slate-500">{isVietnamese ? 'Xem dữ liệu vào/ra' : 'Inspect input/output'}</summary>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            {node.input !== undefined && <pre className="overflow-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><strong>Input</strong>{'\n'}{pretty(node.input)}</pre>}
                            {node.output !== undefined && <pre className="overflow-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><strong>Output</strong>{'\n'}{pretty(node.output)}</pre>}
                          </div>
                        </details>
                      )}
                    </div>
                    <span className="inline-flex h-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                      {node.status === 'SUCCESS' ? <CheckCircle2 size={13} className="text-emerald-600" /> : node.status === 'FAILED' ? <XCircle size={13} className="text-rose-600" /> : <Clock3 size={13} className="text-blue-600" />}
                      {node.status}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-semibold">{t('executions.timeline_logs')} <span className="text-sm font-normal text-slate-500">({execution.logs.length})</span></h2>
            {execution.logs.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{isVietnamese ? 'Chưa có log được trả về.' : 'No logs were returned.'}</p> : (
              <ol className="mt-3 space-y-2">
                {execution.logs.map((log) => (
                  <li key={log.id} className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-950 sm:grid-cols-[190px_90px_1fr]">
                    <time className="text-xs text-slate-500">{formatDate(log.timestamp)}</time>
                    <span className="font-mono text-xs">{log.level}</span>
                    <div><p>{log.message}</p>{log.payload !== undefined && log.payload !== null && <details className="mt-1 text-xs"><summary className="cursor-pointer text-slate-500">Metadata</summary><pre className="mt-1 overflow-auto">{pretty(log.payload)}</pre></details>}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </main>
  );
}
