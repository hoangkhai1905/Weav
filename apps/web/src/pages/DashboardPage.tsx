import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Check, LayoutTemplate, Mail, Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowDefinition } from '../types/workflow.types';
import { isWorkflowMockMode } from '../api/workflow.api';
import { NoWorkspaceNotice } from '../components/common/NoWorkspaceNotice';
import { isNoWorkspaceError } from '../api/workflow-v1.api';
import { WeeklyActivity } from '../components/dashboard/WeeklyActivity';
import { useI18nStore } from '../store/useI18nStore';
import { tr } from '../lib/i18n/tr';
import { fetchWorkflowList } from '../lib/queries/workflows';
import { monitoringApi } from '../api/monitoring.api';
import { formatClock, formatDurationMs, formatPercent, nameInitials, runTone } from '../lib/monitoring/format';
import { friendlyErrorAction, friendlyErrorKind } from '../lib/executions/friendlyError';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useUIStore } from '../store/useUIStore';
import { useAuthStore } from '../store/useAuthStore';
import { statusBadgeClass } from '../components/common/statusBadgeClass';
import { FirstWorkspaceCard } from '../components/onboarding/FirstWorkspaceCard';
import { useMyInvitations, useWorkspaceListContext } from '../hooks/useWorkspace';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SM, CARD, FOCUS_RING, LINK } from '../lib/uiClasses';

const STAT_DAYS = 7;
const TILE = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold';
const ROW = 'transition-colors hover:bg-subtle';

function InvitationsBanner({ count }: { count: number }) {
  const { t } = useI18nStore();
  if (count <= 0) return null;
  return (
    <div data-testid="dashboard-invitations-banner" className="flex flex-col gap-2 rounded-xl border border-border bg-run-bg p-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="status">
      <span className="flex items-center gap-2 font-medium text-foreground">
        <Mail size={16} strokeWidth={1.75} className="text-run" aria-hidden="true" />
        {t(count === 1 ? 'invitations.banner_one' : 'invitations.banner_other').replace('{count}', String(count))}
      </span>
      <Link to="/invitations" className={LINK}>{t('invitations.banner_link')}</Link>
    </div>
  );
}

function Stat({ label, children, note, last }: { label: string; children: React.ReactNode; note: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 px-5 py-[18px] ${last ? '' : 'border-r border-border'}`}>
      <span className="text-[13px] text-text-2">{label}</span>
      <span className="text-[28px] font-semibold leading-[1.1] tracking-tight text-foreground">{children}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

export function DashboardPage() {
  const { language, t } = useI18nStore();
  const locale = language === 'VI' ? 'vi-VN' : 'en-US';
  const openAiGenerator = useUIStore((state) => state.openAiGenerator);
  const user = useAuthStore((state) => state.user);

  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [noWorkspace, setNoWorkspace] = useState(false);

  const queryClient = useQueryClient();
  const { userId, workspacesQuery } = useWorkspaceListContext();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId) ?? 'active';
  const pendingInvitations = useMyInvitations().data?.items.length ?? 0;
  // First run: a signed-in user with no workspace yet gets a create card instead of a failed data load.
  const hasNoWorkspace = !isWorkflowMockMode && workspacesQuery.isSuccess && workspacesQuery.data.items.length === 0;
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    setNoWorkspace(false);
    try {
      setWorkflows(await fetchWorkflowList(queryClient));
    } catch (e) {
      setWorkflows([]);
      if (isNoWorkspaceError(e)) setNoWorkspace(true);
      else setApiError(e instanceof Error ? e.message : tr('msg.workflow_data_could_not_be_loaded'));
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  // Run numbers come from the workspace monitoring endpoints (one summary + one short recent-runs page), not from a
  // per-workflow fan-out. A number the API does not return is not shown.
  const ready = !isLoading && !apiError && !noWorkspace && !hasNoWorkspace;
  const summaryQuery = useQuery({
    queryKey: ['monitoring', 'summary', workspaceId, STAT_DAYS],
    enabled: ready,
    staleTime: 30_000,
    retry: false,
    queryFn: () => monitoringApi.getSummary(STAT_DAYS),
  });
  const recentQuery = useQuery({
    queryKey: ['monitoring', 'runs', workspaceId, 'dashboard'],
    enabled: ready,
    staleTime: 30_000,
    retry: false,
    queryFn: () => monitoringApi.listRuns({ page: 0, size: 5 }),
  });

  if (hasNoWorkspace) {
    return (
      <div className="mx-auto max-w-[1180px] space-y-6 pb-12">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">{t('dashboard.title')}</h1>
        <InvitationsBanner count={pendingInvitations} />
        <FirstWorkspaceCard userId={userId} onCreated={() => void loadData()} />
      </div>
    );
  }

  const summary = summaryQuery.data;
  const failures = summary?.recentFailures ?? [];
  const paused = workflows.filter((workflow) => workflow.status === 'PAUSED');
  const published = workflows.filter((workflow) => workflow.status === 'PUBLISHED').length;
  const recentRuns = recentQuery.data?.items ?? [];
  const attentionCount = failures.length + paused.length;
  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? 'home.greeting.morning' : hour < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening';
  const name = user?.displayName?.trim() || user?.name?.trim() || '';
  const dateText = new Date().toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: '2-digit' });
  const placeholder = (value: string) => (summaryQuery.isLoading ? '…' : summaryQuery.isError ? '—' : value);

  return (
    <div className="mx-auto flex max-w-[1180px] select-none flex-col gap-7 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
            {name ? `${t(greetingKey)}, ${name}` : t(greetingKey)}
          </h1>
          <p className="text-text-2">
            {ready && summary && failures.length === 0
              ? t('home.subtitle_ok').replace('{date}', dateText)
              : t('home.subtitle_failures').replace('{date}', dateText).replace('{count}', String(failures.length))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openAiGenerator()} className={BTN_SECONDARY}>
            <span className="rounded bg-t-ai-bg px-1.5 py-px font-mono text-[11px] text-t-ai">AI</span>
            {t('home.ai_describe')}
          </button>
          <Link to="/workflows/new" className={BTN_PRIMARY}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('home.create')}
          </Link>
        </div>
      </div>

      <InvitationsBanner count={pendingInvitations} />

      {isLoading ? (
        <section data-testid="dashboard-real-data">
          <div className={`${CARD} p-6 text-sm text-muted-foreground`} data-testid="dashboard-workflows-loading">{t('dashboard.real_data_loading')}</div>
        </section>
      ) : noWorkspace ? (
        <section data-testid="dashboard-real-data"><NoWorkspaceNotice /></section>
      ) : apiError ? (
        <section data-testid="dashboard-real-data">
          <div role="alert" data-testid="dashboard-workflows-error" className="rounded-xl border border-err-border bg-err-bg p-6 text-sm text-err">
            <p>{t('dashboard.real_data_error')}</p>
            <button type="button" onClick={() => void loadData()} className={`mt-3 rounded-md border border-err-border px-3 py-1.5 text-xs font-semibold ${FOCUS_RING}`}>
              {t('dashboard.real_data_retry')}
            </button>
          </div>
        </section>
      ) : (
        <section data-testid="dashboard-real-data" className="flex flex-col gap-7">
          <section aria-label={t('home.stats_label').replace('{days}', String(STAT_DAYS))} className={`${CARD} grid grid-cols-2 lg:grid-cols-4 [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-border lg:[&>*:nth-child(-n+2)]:border-b-0 [&>*:nth-child(2)]:border-r-0 lg:[&>*:nth-child(2)]:border-r`}>
            <Stat label={t('home.stat.runs').replace('{days}', String(STAT_DAYS))} note={placeholder(t('home.stat.runs_today').replace('{count}', String(summary?.runs.today ?? 0)))}>
              <span data-testid="dashboard-runs-7d">{placeholder((summary?.runs.total ?? 0).toLocaleString(locale))}</span>
            </Stat>
            <Stat
              label={t('home.stat.success')}
              note={placeholder(summary && summary.successRate === null ? t('home.stat.no_data') : t('home.stat.failed_count').replace('{count}', String(summary?.runs.failed ?? 0)))}
            >
              <span data-testid="dashboard-success-rate-7d">{placeholder(formatPercent(summary?.successRate, locale))}</span>
            </Stat>
            <Stat
              label={t('home.stat.attention')}
              note={failures.length > 0 ? <Link to="/executions" className={LINK}>{t('home.stat.view_now')}</Link> : placeholder(t('home.stat.none'))}
            >
              <span data-testid="dashboard-attention-count" className={failures.length > 0 ? 'text-err' : undefined}>{placeholder(String(failures.length))}</span>
            </Stat>
            <Stat
              last
              label={t('home.stat.active')}
              note={paused.length > 0 ? t('home.stat.paused').replace('{count}', String(paused.length)) : t('home.stat.none_paused')}
            >
              <span data-testid="dashboard-published-workflows">{published}</span>
              <span className="text-base font-medium text-muted-foreground"> / <span data-testid="dashboard-total-workflows">{workflows.length}</span></span>
            </Stat>
          </section>

          {workflows.length === 0 && (
            <div data-testid="dashboard-workflows-empty" className={`${CARD} p-6 text-center text-sm text-text-2`}>
              {t('dashboard.real_data_empty')}
            </div>
          )}

          <div className="grid items-start gap-5 lg:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
              <section className={CARD} aria-labelledby="home-attention">
                <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
                  <h2 id="home-attention" className="text-[15px] font-semibold text-foreground">{t('home.attention.title')}</h2>
                  {failures.length > 0 && <span className={statusBadgeClass('err')}>{t('home.attention.errors').replace('{count}', String(failures.length))}</span>}
                </div>
                {attentionCount === 0 ? (
                  <p className="flex items-center gap-2 px-[18px] py-5 text-sm text-text-2">
                    <Check size={16} strokeWidth={1.75} className="text-ok" aria-hidden="true" />
                    {summaryQuery.isLoading ? t('dashboard.real_data_loading') : t('home.attention.empty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {failures.slice(0, 3).map((run) => {
                      const kind = friendlyErrorKind(run.errorCode);
                      const reconnect = friendlyErrorAction(kind) === 'reconnect';
                      return (
                        <li key={run.executionId} data-testid="dashboard-attention-row" className={`flex flex-wrap items-center gap-3.5 px-[18px] py-3.5 ${ROW}`}>
                          <span className={`${TILE} bg-t-action-bg text-t-action`}>{nameInitials(run.workflowName)}</span>
                          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                            <span className="truncate font-medium text-foreground">{run.workflowName}</span>
                            <span className="text-[13px] text-text-2">{t(`runerr.${kind}.title`)}</span>
                          </div>
                          {reconnect ? (
                            <Link to="/workspace/connections" className={`${BTN_SECONDARY} ${BTN_SM}`}>{t('home.action.reconnect')}</Link>
                          ) : (
                            <Link to={`/workflows/${encodeURIComponent(run.workflowId)}/executions?run=${encodeURIComponent(run.executionId)}`} className={`${BTN_SECONDARY} ${BTN_SM}`}>{t('home.action.view_run')}</Link>
                          )}
                        </li>
                      );
                    })}
                    {paused.slice(0, 2).map((workflow) => (
                      <li key={workflow.id} data-testid="dashboard-attention-row" className={`flex flex-wrap items-center gap-3.5 px-[18px] py-3.5 ${ROW}`}>
                        <span className={`${TILE} bg-t-trigger-bg text-t-trigger`}>{nameInitials(workflow.name)}</span>
                        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                          <span className="truncate font-medium text-foreground">{workflow.name}</span>
                          <span className="text-[13px] text-text-2">{t('home.attention.paused')}</span>
                        </div>
                        <Link to={`/workflows/${encodeURIComponent(workflow.id)}/builder`} className={`${BTN_SECONDARY} ${BTN_SM}`}>{t('home.action.open_workflow')}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section data-testid="dashboard-recent-runs" className={CARD} aria-labelledby="home-recent">
                <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
                  <h2 id="home-recent" className="text-[15px] font-semibold text-foreground">{t('home.recent.title')}</h2>
                  <Link to="/executions" className={`${LINK} text-[13px]`}>{t('home.recent.view_all')}</Link>
                </div>
                {recentQuery.isError ? (
                  <p className="p-6 text-sm text-text-2">{t('dashboard.execution_data_unavailable')}</p>
                ) : recentQuery.isLoading ? (
                  <p className="p-6 text-sm text-text-2">{t('dashboard.real_data_loading')}</p>
                ) : recentRuns.length === 0 ? (
                  <p className="p-6 text-sm text-text-2">{t('dashboard.no_runs_yet')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-left">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th scope="col" className="px-[18px] py-2.5 font-medium">{t('home.recent.col_workflow')}</th>
                          <th scope="col" className="px-3 py-2.5 font-medium">{t('home.recent.col_status')}</th>
                          <th scope="col" className="px-3 py-2.5 font-medium">{t('home.recent.col_started')}</th>
                          <th scope="col" className="px-[18px] py-2.5 text-right font-medium">{t('home.recent.col_duration')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentRuns.map((run) => (
                          <tr key={run.executionId} className={`border-t border-border ${ROW}`}>
                            <td className="px-[18px] py-[11px] font-medium text-foreground">
                              <Link
                                to={`/workflows/${encodeURIComponent(run.workflowId)}/executions?run=${encodeURIComponent(run.executionId)}`}
                                aria-label={`${t('dashboard.view_run')}: ${run.workflowName}`}
                                className={`rounded-sm hover:underline ${FOCUS_RING}`}
                              >
                                {run.workflowName}
                              </Link>
                            </td>
                            <td className="px-3 py-[11px]"><span className={statusBadgeClass(runTone(run.status))}>{t(`monitoring.status.${run.status.toLowerCase()}`)}</span></td>
                            <td className="px-3 py-[11px] font-mono text-xs text-text-2">
                              <time dateTime={run.startedAt ?? run.createdAt}>{formatClock(run.startedAt ?? run.createdAt, locale)}</time>
                            </td>
                            <td className="px-[18px] py-[11px] text-right font-mono text-xs text-text-2">{formatDurationMs(run.durationMs, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              {summary && <WeeklyActivity summary={summary} locale={locale} />}

              <section data-testid="dashboard-quick-actions" className={CARD} aria-labelledby="home-quick">
                <h2 id="home-quick" className="border-b border-border px-[18px] py-3.5 text-[15px] font-semibold text-foreground">{t('home.quick.title')}</h2>
                <Link to="/workflows/new" className={`flex gap-3 border-b border-border px-[18px] py-3.5 ${ROW} ${FOCUS_RING}`}>
                  <span className={`${TILE} bg-t-trigger-bg text-t-trigger`}><Plus size={16} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{t('home.quick.scratch')}</span>
                    <span className="text-[13px] text-text-2">{t('home.quick.scratch_desc')}</span>
                  </span>
                </Link>
                <Link to="/workflows/new#templates-list" className={`flex gap-3 border-b border-border px-[18px] py-3.5 ${ROW} ${FOCUS_RING}`}>
                  <span className={`${TILE} bg-t-logic-bg text-t-logic`}><LayoutTemplate size={16} strokeWidth={1.75} aria-hidden="true" /></span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{t('home.quick.template')}</span>
                    <span className="text-[13px] text-text-2">{t('home.quick.template_desc')}</span>
                  </span>
                </Link>
                <button type="button" onClick={() => openAiGenerator()} className={`flex w-full gap-3 px-[18px] py-3.5 text-left ${ROW} ${FOCUS_RING}`}>
                  <span className={`${TILE} bg-t-ai-bg font-mono text-[10px] text-t-ai`}>AI</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{t('home.ai_describe')}</span>
                    <span className="text-[13px] text-text-2">{t('home.quick.ai_desc')}</span>
                  </span>
                </button>
              </section>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
