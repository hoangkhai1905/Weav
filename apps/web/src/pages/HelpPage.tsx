import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import { useI18nStore } from '../store/useI18nStore';

const TRIGGERS = ['manual', 'schedule', 'webhook', 'telegram', 'gmail'] as const;
const NODES = ['http', 'email', 'sheets', 'drive', 'calendar', 'telegram', 'set', 'condition', 'switch', 'ai'] as const;
const EXAMPLES = ['telegram', 'sheets', 'condition'] as const;

const section = 'space-y-3 rounded-2xl border border-border bg-card p-5';
const code = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground';

export function HelpPage() {
  const { t } = useI18nStore();

  return (
    <div data-testid="help-page" className="mx-auto max-w-4xl space-y-5 pb-10">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border border-run/30 bg-run-bg text-run"><HelpCircle size={17} aria-hidden="true" /></span>
          <h1 className="text-xl font-bold text-foreground">{t('nav.help')}</h1>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-text-2">{t('hp.help.subtitle')}</p>
        <p className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-run">
          <Link to="/workflows/new#templates-list" className="hover:underline">{t('hp.help.link_templates')}</Link>
          <Link to="/ai/workflow-generator" className="hover:underline">{t('hp.help.link_ai')}</Link>
          <Link to="/connections" className="hover:underline">{t('hp.help.link_connections')}</Link>
        </p>
      </div>

      <section aria-labelledby="help-start" className={section}>
        <h2 id="help-start" className="text-sm font-bold text-foreground">{t('hp.help.start_title')}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-text-2">
          {[1, 2, 3, 4].map((step) => <li key={step}>{t(`hp.help.start.${step}`)}</li>)}
        </ol>
      </section>

      <section aria-labelledby="help-triggers" className={section}>
        <h2 id="help-triggers" className="text-sm font-bold text-foreground">{t('hp.help.triggers_title')}</h2>
        <p className="text-xs text-text-2">{t('hp.help.triggers_intro')}</p>
        <dl className="space-y-2 text-xs leading-5">
          {TRIGGERS.map((key) => (
            <div key={key}>
              <dt className="font-semibold text-foreground">{t(`hp.help.trigger.${key}.name`)}</dt>
              <dd className="text-text-2">{t(`hp.help.trigger.${key}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="help-nodes" className={section}>
        <h2 id="help-nodes" className="text-sm font-bold text-foreground">{t('hp.help.nodes_title')}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs leading-5 md:grid-cols-2">
          {NODES.map((key) => (
            <div key={key}>
              <dt className="font-semibold text-foreground">{t(`hp.help.node.${key}.name`)}</dt>
              <dd className="text-text-2">{t(`hp.help.node.${key}.text`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="help-syntax" className={section}>
        <h2 id="help-syntax" className="text-sm font-bold text-foreground">{t('hp.help.syntax_title')}</h2>
        <p className="text-xs leading-5 text-text-2">{t('hp.help.syntax_intro')}</p>
        <ul className="space-y-2 text-xs leading-5 text-text-2">
          <li><code className={code}>{'{{ trigger.input.name }}'}</code> {t('hp.help.syntax.trigger')}</li>
          <li><code className={code}>{'{{ nodes.fetch_data.output.data }}'}</code> {t('hp.help.syntax.node')}</li>
          <li><code className={code}>{'{{ trigger.input.attachments[0] }}'}</code> {t('hp.help.syntax.index')}</li>
          <li><code className={code}>{'Xin chào {{ trigger.input.name }}!'}</code> {t('hp.help.syntax.text')}</li>
        </ul>
        <p className="text-[11px] text-muted-foreground">{t('hp.help.syntax_note')}</p>
      </section>

      <section aria-labelledby="help-examples" className={section}>
        <h2 id="help-examples" className="text-sm font-bold text-foreground">{t('hp.help.examples_title')}</h2>
        <div className="space-y-4">
          {EXAMPLES.map((key) => (
            <article key={key} className="rounded-xl border border-border bg-subtle p-4">
              <h3 className="text-xs font-bold text-foreground">{t(`hp.help.example.${key}.title`)}</h3>
              <p className="mt-1 text-xs leading-5 text-text-2">{t(`hp.help.example.${key}.steps`)}</p>
              <p className="mt-1 font-mono text-[11px] leading-5 text-foreground">{t(`hp.help.example.${key}.code`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="help-publish" className={section}>
        <h2 id="help-publish" className="text-sm font-bold text-foreground">{t('hp.help.publish_title')}</h2>
        <p className="text-xs leading-5 text-text-2">{t('hp.help.publish_text')}</p>
      </section>
    </div>
  );
}
