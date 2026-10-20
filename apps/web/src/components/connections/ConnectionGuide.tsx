import { Copy, ExternalLink } from 'lucide-react';
import { useI18nStore } from '../../store/useI18nStore';

export type GuideTopic = 'TELEGRAM' | 'DISCORD' | 'SLACK' | 'TEAMS' | 'GOOGLE' | 'WEBHOOK' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI';

const STEP_COUNT: Record<GuideTopic, number> = { TELEGRAM: 4, DISCORD: 4, SLACK: 4, TEAMS: 4, GOOGLE: 3, WEBHOOK: 4, OPENAI: 3, ANTHROPIC: 3, GEMINI: 3 };

// Only official pages; Teams and Google have no single page worth sending a beginner to.
const EXTERNAL_LINK: Partial<Record<GuideTopic, string>> = {
  TELEGRAM: 'https://t.me/BotFather',
  DISCORD: 'https://support.discord.com/hc/articles/228383668',
  SLACK: 'https://api.slack.com/apps',
  OPENAI: 'https://platform.openai.com/api-keys',
  ANTHROPIC: 'https://console.anthropic.com/settings/keys',
  GEMINI: 'https://aistudio.google.com/apikey',
};

const WEBHOOK_URL_SAMPLE: Partial<Record<GuideTopic, string>> = {
  DISCORD: 'https://discord.com/api/webhooks/1234…/AbCd…',
  SLACK: 'https://hooks.slack.com/services/T0…/B0…/xYz…',
  TEAMS: 'https://….logic.azure.com/workflows/…/invoke?…&sig=…',
};

const AI_KEY_SAMPLE = { OPENAI: 'sk-proj-…xYz', ANTHROPIC: 'sk-ant-…xYz', GEMINI: 'AIza…xYz' } as const;

const GATEWAY_URL = (import.meta.env.VITE_API_GATEWAY_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** A small drawing of what the user will see in the other app, with the part to copy highlighted. */
function GuidePicture({ topic }: { topic: GuideTopic }) {
  const { t } = useI18nStore();
  const mark = 'rounded bg-warn-bg px-1 font-mono text-warn ring-1 ring-warn/40';
  if (topic === 'TELEGRAM') {
    return (
      <div className="space-y-1.5 rounded-md border border-border bg-subtle p-2.5 text-[11px]">
        <p className="font-semibold text-foreground">BotFather</p>
        <p className="ml-auto w-fit rounded-lg rounded-br-sm bg-run-bg px-2 py-1 font-mono text-run">/newbot</p>
        <div className="w-[88%] rounded-lg rounded-bl-sm border border-border bg-card px-2 py-1.5 text-text-2">
          {t('guide.picture.telegram_reply')}
          <span className={`mt-1 block w-fit break-all ${mark}`}>123456789:AAFk…xYz</span>
        </div>
        <p className="text-[10px] text-warn">↑ {t('guide.picture.copy_this')}</p>
      </div>
    );
  }
  if (topic === 'GOOGLE') {
    return (
      <div className="space-y-2 rounded-md border border-border bg-subtle p-2.5 text-[11px]">
        <p className="font-semibold text-foreground">{t('guide.picture.google_title')}</p>
        <p className="text-text-2">{t('guide.picture.google_body')}</p>
        <div className="flex justify-end gap-1.5">
          <span className="rounded border border-border bg-card px-2 py-0.5 text-text-2">{t('guide.picture.google_cancel')}</span>
          <span className="rounded bg-primary px-2 py-0.5 font-semibold text-primary-foreground ring-2 ring-warn/50">{t('guide.picture.google_allow')}</span>
        </div>
      </div>
    );
  }
  if (topic === 'OPENAI' || topic === 'ANTHROPIC' || topic === 'GEMINI') {
    return (
      <div className="space-y-1.5 rounded-md border border-border bg-subtle p-2.5 text-[11px]">
        <p className="font-semibold text-foreground">{t('guide.picture.ai_key')}</p>
        <span className={`block w-fit break-all ${mark}`}>{AI_KEY_SAMPLE[topic]}</span>
        <p className="text-[10px] text-warn">↑ {t('guide.picture.copy_this')}</p>
      </div>
    );
  }
  if (topic === 'WEBHOOK') {
    return (
      <pre className="overflow-x-auto rounded-md border border-border bg-subtle p-2.5 font-mono text-[10px] leading-relaxed text-text-2">
        <span className="text-run">POST</span> {GATEWAY_URL}/api/v1/webhooks/<span className={mark}>{'<endpoint key>'}</span>
        {'\n'}X-Webhook-Secret: <span className={mark}>{'<secret>'}</span>
        {'\n'}Content-Type: application/json
        {'\n\n'}{'{ "name": "An", "email": "an@example.com" }'}
      </pre>
    );
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-subtle p-2.5 text-[11px]">
      <p className="font-semibold text-foreground">Webhook</p>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1 font-mono text-[10px] text-text-2">{WEBHOOK_URL_SAMPLE[topic]}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary px-2 py-1 font-semibold text-primary-foreground ring-2 ring-warn/50">
          <Copy size={11} aria-hidden="true" />{t('guide.picture.copy_url')}
        </span>
      </div>
      <p className="text-[10px] text-warn">↑ {t('guide.picture.copy_this')}</p>
    </div>
  );
}

/** Step-by-step help for getting a bot token, webhook URL or Google access, shared by the connection dialog and the builder. */
export function ConnectionGuide({ topic }: { topic: GuideTopic }) {
  const { t } = useI18nStore();
  const key = topic.toLowerCase();
  const link = EXTERNAL_LINK[topic];
  return (
    <div data-testid={`connection-guide-${key}`} className="space-y-2.5 rounded-md border border-border bg-card p-3">
      <p className="text-xs font-semibold text-foreground">{t(`guide.${key}.title`)}</p>
      <ol className="space-y-1.5">
        {Array.from({ length: STEP_COUNT[topic] }, (_, index) => (
          <li key={index} className="flex gap-2 text-[11px] leading-relaxed text-text-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-run-bg text-[10px] font-semibold text-run">{index + 1}</span>
            <span>{t(`guide.${key}.step.${index + 1}`)}</span>
          </li>
        ))}
      </ol>
      <GuidePicture topic={topic} />
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-run hover:underline">
          {t(`guide.${key}.link`)} <ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
