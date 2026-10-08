import { Link } from 'react-router-dom';
import { useI18nStore } from '../../store/useI18nStore';
import { appLocale } from '../../lib/i18n/tr';
import { formatDurationMs, formatPercent } from '../../lib/monitoring/format';
import type { MonitoringSummary } from '../../api/monitoring.api';
import { formatRelativeTime } from '../../lib/relativeTime';
import { RunsTrendChart } from './RunsTrendChart';

function Card({ testId, label, value, tone }: { testId: string; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <strong data-testid={testId} className={`mt-2 block font-mono text-2xl ${tone ?? 'text-foreground'}`}>{value}</strong>
    </div>
  );
}

/** Metric cards, the daily trend and the workflows that fail most, all from one `monitoring/summary` response. */
export function MonitoringSummaryPanel({ summary }: { summary: MonitoringSummary }) {
  const { t } = useI18nStore();
  const locale = appLocale();
  const { runs } = summary;
  const finished = runs.success + runs.failed;

  return (
    <section aria-label={t('monitoring.summary_title')} data-testid="monitoring-summary" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card testId="monitoring-runs-total" label={t('monitoring.runs_in_range').replace('{days}', String(summary.days))} value={runs.total.toLocaleString(locale)} />
        <Card testId="monitoring-success-rate" label={t('monitoring.success_rate')} value={formatPercent(summary.successRate, locale)}
          tone={summary.successRate !== null && summary.successRate < 0.9 ? 'text-err' : undefined} />
        <Card testId="monitoring-failed" label={t('monitoring.failed')} value={runs.failed.toLocaleString(locale)} tone={runs.failed > 0 ? 'text-err' : undefined} />
        <Card testId="monitoring-avg-duration" label={t('monitoring.avg_duration')} value={formatDurationMs(summary.averageDurationMs, locale)} />
        <Card testId="monitoring-p95-duration" label={t('monitoring.p95_duration')} value={formatDurationMs(summary.p95DurationMs, locale)} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t('monitoring.counts_line')
          .replace('{today}', String(runs.today))
          .replace('{active}', String(runs.active))
          .replace('{published}', String(summary.workflows.published))
          .replace('{paused}', String(summary.workflows.paused))
          .replace('{finished}', String(finished))}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
          <h2 className="mb-2 text-sm font-bold text-foreground">{t('monitoring.trend_title')}</h2>
          {runs.total === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t('monitoring.trend_empty')}</p> : <RunsTrendChart trend={summary.trend} />}
        </div>
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-bold text-foreground">{t('monitoring.top_failing')}</h2>
          {summary.topFailingWorkflows.length === 0 ? (
            <p data-testid="monitoring-top-failing-empty" className="py-8 text-center text-sm text-muted-foreground">{t('monitoring.no_failures')}</p>
          ) : (
            <ul data-testid="monitoring-top-failing" className="divide-y divide-border">
              {summary.topFailingWorkflows.map((item) => (
                <li key={item.workflowId} className="flex items-center gap-2 py-2 text-xs">
                  <Link to={`/workflows/${encodeURIComponent(item.workflowId)}/executions`} className="min-w-0 flex-1 truncate font-semibold text-foreground hover:underline">{item.workflowName}</Link>
                  <span className="shrink-0 tabular-nums text-err">{item.failures} {t('monitoring.failures_short')}</span>
                  <time dateTime={item.lastFailureAt} className="shrink-0 tabular-nums text-muted-foreground">{formatRelativeTime(item.lastFailureAt, locale)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-bold text-foreground">{t('monitoring.recent_failures')}</h2>
        {summary.recentFailures.length === 0 ? (
          <p data-testid="monitoring-recent-failures-empty" className="py-4 text-center text-sm text-muted-foreground">{t('monitoring.no_recent_failures')}</p>
        ) : (
          <ul data-testid="monitoring-recent-failures" className="divide-y divide-border">
            {summary.recentFailures.map((run) => (
              <li key={run.executionId}>
                <Link
                  to={`/executions/${encodeURIComponent(run.executionId)}?workflowId=${encodeURIComponent(run.workflowId)}`}
                  className="flex items-center gap-3 py-2 text-xs transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{run.workflowName}</span>
                  <span className="hidden min-w-0 max-w-[40%] truncate text-muted-foreground sm:inline">{run.errorCode ?? run.errorMessage ?? ''}</span>
                  <time dateTime={run.createdAt} title={new Date(run.createdAt).toLocaleString(locale)} className="shrink-0 tabular-nums text-muted-foreground">{formatRelativeTime(run.createdAt, locale)}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
