import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { executionApi } from '../api/execution.api';
import { ExecutionsTriPane } from '../components/executions/ExecutionsTriPane';
import { useI18nStore } from '../store/useI18nStore';

/** Run detail: resolves the owning workflow from the real API, then shows the 3-pane run view. */
export function LiveExecutionDetailPage() {
  const { executionId = '' } = useParams<{ executionId: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useI18nStore();
  const id = decodeURIComponent(executionId);
  const queryWorkflowId = searchParams.get('workflowId');
  const [resolved, setResolved] = useState<{ id: string; workflowId: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (queryWorkflowId) return;
    let cancelled = false;
    executionApi
      .getExecution(id)
      .then((result) => {
        if (!cancelled) setResolved({ id, workflowId: result?.workflowId ?? null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure(cause instanceof Error ? cause.message : t('runs.load_error'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, queryWorkflowId, t]);

  const workflowId = queryWorkflowId ?? (resolved?.id === id ? resolved.workflowId : null);

  if (workflowId) return <ExecutionsTriPane key={workflowId} workflowId={workflowId} selectedExecutionId={id} />;

  const notFound = failure ?? (resolved?.id === id ? t('runs.not_found') : null);
  return notFound ? (
    <div role="alert" className="m-6 max-w-xl rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
      <p>{notFound}</p>
      <Link to="/workflows" className="mt-2 inline-block font-medium underline">{t('nav.workflows')}</Link>
    </div>
  ) : (
    <div role="status" className="flex min-h-[40vh] items-center justify-center">
      <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('runs.loading')} />
    </div>
  );
}
