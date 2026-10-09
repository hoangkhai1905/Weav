import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Send } from 'lucide-react';
import { connectionApi, type ConnectionResponse } from '../api/connection.api';
import { TELEGRAM_TEMPLATE_IDS, WORKFLOW_TEMPLATES } from '../lib/templates';
import { useI18nStore } from '../store/useI18nStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';

const STEP_KEYS = ['open', 'create', 'copy', 'connect'] as const;

export function TelegramPage() {
  const { t, language } = useI18nStore();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [bots, setBots] = useState<ConnectionResponse[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Drop the previous workspace's bots as soon as the workspace changes.
  const [seenWorkspaceId, setSeenWorkspaceId] = useState(activeWorkspaceId);
  if (seenWorkspaceId !== activeWorkspaceId) {
    setSeenWorkspaceId(activeWorkspaceId);
    setBots(null);
    setLoadFailed(false);
  }

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const controller = new AbortController();
    connectionApi
      .list(activeWorkspaceId, controller.signal)
      .then((items) => {
        setBots(items.filter((item) => item.provider === 'TELEGRAM'));
        setLoadFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [activeWorkspaceId]);

  const templates = WORKFLOW_TEMPLATES.filter((template) => TELEGRAM_TEMPLATE_IDS.includes(template.id));
  const card = 'rounded-2xl border border-border bg-card p-6';

  return (
    <div data-testid="telegram-page" className="mx-auto max-w-4xl space-y-6 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          {t('hp.tg.title')} <Send size={20} className="text-run" aria-hidden="true" />
        </h1>
        <p className="text-xs text-text-2">{t('hp.tg.subtitle')}</p>
      </div>

      <section aria-labelledby="telegram-bots-title" className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="telegram-bots-title" className="text-sm font-bold text-foreground">{t('hp.tg.bots_title')}</h2>
          <Link
            to="/connections"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('hp.tg.add_bot')} <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
        {!activeWorkspaceId ? (
          <p className="text-xs text-muted-foreground">{t('hp.tg.no_workspace')}</p>
        ) : loadFailed ? (
          <p role="alert" className="text-xs text-err">{t('hp.tg.load_failed')}</p>
        ) : bots === null ? (
          <p className="text-xs text-muted-foreground">{t('telegram.loading')}</p>
        ) : bots.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('hp.tg.no_bots')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {bots.map((bot) => (
              <li key={bot.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-run-bg text-run"><Bot size={18} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{bot.name}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${bot.status === 'ACTIVE' ? 'border-ok/30 bg-ok-bg text-ok' : 'border-err/30 bg-err-bg text-err'}`}>
                  {bot.status === 'ACTIVE' ? t('hp.tg.status_active') : t('hp.tg.status_inactive')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="telegram-steps-title" className={`${card} space-y-3`}>
        <h2 id="telegram-steps-title" className="text-sm font-bold text-foreground">{t('hp.tg.steps_title')}</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-5 text-text-2">
          {STEP_KEYS.map((key) => <li key={key}>{t(`hp.tg.step.${key}`)}</li>)}
        </ol>
        <p className="text-[11px] text-muted-foreground">{t('hp.tg.one_workflow_note')}</p>
      </section>

      <section aria-labelledby="telegram-templates-title" className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="telegram-templates-title" className="text-sm font-bold text-foreground">{t('hp.tg.templates_title')}</h2>
          <Link to="/workflows/new#templates-list" className="text-xs font-semibold text-run hover:underline">{t('hp.tg.all_templates')}</Link>
        </div>
        <ul className="space-y-2">
          {templates.map((template) => {
            const copy = language === 'VI' ? template.vi : template.en;
            return (
              <li key={template.id} className="rounded-xl border border-border bg-subtle px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{copy.name}</p>
                <p className="mt-0.5 text-xs text-text-2">{copy.description}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
