import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react';
import { getUpstreams } from '../api/health';
import { UpstreamPill } from '../components/UpstreamPill';
import { useFormatDateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { CARD, btnCls } from '../lib/ui';

/** Whether the services behind the Gateway are answering. */
export function SystemPage() {
  const t = useT();
  const formatDateTime = useFormatDateTime();
  const health = useQuery({ queryKey: ['admin', 'upstreams'], queryFn: getUpstreams });
  const data = health.data;
  const services = data
    ? [
        { slug: 'identity', state: data.details.identity.status },
        { slug: 'workspace', state: data.details.workspace.status },
      ]
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t('sys.title')}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('sys.subtitle')}</p>
        </div>
        <button type="button" className={btnCls} onClick={() => void health.refetch()} disabled={health.isFetching}>
          <RefreshCw size={14} className={health.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      {health.isError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-err-border bg-err-bg p-4 text-[13px] text-err">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('sys.load_error')}</span>
          <button type="button" className="font-medium underline" onClick={() => void health.refetch()}>{t('common.retry')}</button>
        </div>
      )}

      {health.isLoading && (
        <div role="status" className="flex justify-center py-10">
          <LoaderCircle size={20} className="animate-spin text-muted-foreground" aria-label={t('common.loading')} />
        </div>
      )}

      {data && !health.isError && (
        <>
          <p className="text-[13px] text-text-2">{data.status === 'ok' ? t('sys.all_up') : t('sys.some_down')}</p>
          <ul className="space-y-3">
            {services.map(({ slug, state }) => (
              <li key={slug} data-testid={`system-${slug}`} className={`${CARD} flex items-center gap-3 p-4`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(`sys.${slug}`)}</p>
                  <p className="text-xs text-muted-foreground">{t(`sys.${slug}_desc`)}</p>
                </div>
                <UpstreamPill state={state} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('sys.checked_at', { time: formatDateTime(new Date(health.dataUpdatedAt).toISOString()) })}</p>
        </>
      )}
    </div>
  );
}
