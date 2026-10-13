import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { LanguageSwitch, ThemeToggle } from '../components/layout/ShellControls';
import { WeavMark } from '../components/common/WeavMark';
import { statusBadgeClass } from '../components/common/statusBadgeClass';
import { BTN_PRIMARY, BTN_SECONDARY, CARD, FOCUS_RING } from '../lib/uiClasses';
import { useI18nStore } from '../store/useI18nStore';

type Kind = 'tr' | 'act' | 'lg' | 'ai';

const KIND_CLASS: Record<Kind, string> = {
  tr: 'bg-t-trigger-bg text-t-trigger',
  act: 'bg-t-action-bg text-t-action',
  lg: 'bg-t-logic-bg text-t-logic',
  ai: 'bg-t-ai-bg text-t-ai',
};

/** Step-type tile with a short code, e.g. "Gm". Decorative: the label next to it carries the meaning. */
function Tile({ kind, code, size = 32 }: { kind: Kind; code: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-[7px] text-[11px] font-semibold ${KIND_CLASS[kind]}`}
      style={{ width: size, height: size, fontSize: size < 30 ? 10 : 11 }}
    >
      {code}
    </span>
  );
}

const WRAP = 'mx-auto w-full max-w-[1200px] px-5 sm:px-8';
const NAV_LINK = `rounded-sm text-[15px] font-medium text-text-2 hover:text-foreground ${FOCUS_RING}`;
const EYEBROW = 'text-[13px] font-semibold tracking-[0.02em] text-accent-ink';
const H2 = 'text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-foreground sm:text-[40px]';
const LANDING_BTN = 'h-11 px-[18px] text-[15px]';

function Heading({ eyebrow, id, children }: { eyebrow: string; id: string; children: ReactNode }) {
  return (
    <div className="flex max-w-[640px] flex-col gap-3">
      <span className={EYEBROW}>{eyebrow}</span>
      <h2 id={id} className={H2}>{children}</h2>
    </div>
  );
}

const APPS: Array<{ kind: Kind; code: string; name: string }> = [
  { kind: 'act', code: 'Gm', name: 'Gmail' },
  { kind: 'act', code: 'Sh', name: 'Google Sheets' },
  { kind: 'act', code: 'Dr', name: 'Google Drive' },
  { kind: 'act', code: 'Ca', name: 'lp.app.calendar' },
  { kind: 'act', code: 'Tg', name: 'Telegram' },
  { kind: 'act', code: 'Ds', name: 'Discord' },
  { kind: 'act', code: 'Sl', name: 'Slack' },
  { kind: 'act', code: 'Te', name: 'Microsoft Teams' },
  { kind: 'tr', code: 'Wh', name: 'Webhook' },
  { kind: 'act', code: 'OC', name: 'lp.app.ocr' },
  { kind: 'ai', code: 'AI', name: 'lp.app.ai' },
];

/** Public landing page, shown at `/` to signed-out visitors (signed-in users go to the dashboard). */
export function LandingPage() {
  const { t } = useI18nStore();
  const label = (value: string) => (value.startsWith('lp.') ? t(value) : value);

  const demoSteps: Array<{ kind: Kind; code: string; key: string; first?: boolean; delay: string }> = [
    { kind: 'tr', code: 'Gm', key: 'lp.demo.s1', first: true, delay: '0s' },
    { kind: 'ai', code: 'AI', key: 'lp.demo.s2', delay: '1.5s' },
    { kind: 'act', code: 'Sh', key: 'lp.demo.s3', delay: '3s' },
    { kind: 'act', code: 'Tg', key: 'lp.demo.s4', delay: '4.5s' },
  ];

  const uses: Array<{ role: string; title: string; steps: Array<{ kind: Kind; code: string }> }> = [
    { role: 'lp.uc1.r', title: 'lp.uc1.t', steps: [{ kind: 'tr', code: 'Gm' }, { kind: 'ai', code: 'AI' }, { kind: 'act', code: 'Sh' }] },
    { role: 'lp.uc2.r', title: 'lp.uc2.t', steps: [{ kind: 'tr', code: 'Gm' }, { kind: 'ai', code: 'AI' }, { kind: 'lg', code: t('lp.step.logic') }, { kind: 'act', code: 'Te' }] },
    { role: 'lp.uc3.r', title: 'lp.uc3.t', steps: [{ kind: 'tr', code: 'Wh' }, { kind: 'act', code: 'Tg' }] },
    { role: 'lp.uc4.r', title: 'lp.uc4.t', steps: [{ kind: 'tr', code: t('lp.step.time') }, { kind: 'act', code: 'Ca' }, { kind: 'act', code: 'Sl' }] },
  ];

  const faqs = [1, 2, 3, 4, 5];

  return (
    <div className="h-full w-full overflow-y-auto scroll-smooth bg-background text-base leading-relaxed text-foreground">
      <header className="border-b border-border">
        <div className={`${WRAP} flex min-h-[68px] flex-wrap items-center gap-x-6 gap-y-2 py-2.5`}>
          <a href="#top" className={`flex items-center gap-2.5 rounded-md ${FOCUS_RING}`}>
            <WeavMark className="h-7 w-7" />
            <span className="text-lg font-bold tracking-tight">Weav</span>
          </a>
          <nav aria-label={t('lp.nav_label')} className="hidden flex-wrap gap-6 md:flex">
            <a className={NAV_LINK} href="#how">{t('lp.nav.how')}</a>
            <a className={NAV_LINK} href="#features">{t('lp.nav.features')}</a>
            <a className={NAV_LINK} href="#apps">{t('lp.nav.apps')}</a>
            <a className={NAV_LINK} href="#faq">{t('lp.nav.faq')}</a>
          </nav>
          <div className="flex-1" />
          <LanguageSwitch />
          <ThemeToggle />
          <Link to="/login" className={`${BTN_SECONDARY} h-9 px-3.5 text-sm`}>{t('lp.login')}</Link>
          <Link to="/register" className={`${BTN_PRIMARY} h-9 px-3.5 text-sm`}>{t('lp.start')}</Link>
        </div>
      </header>

      <main id="top">
        <section className={`${WRAP} grid items-center gap-12 pb-24 pt-14 sm:pt-[88px] lg:grid-cols-2 lg:gap-16`}>
          <div className="flex flex-col gap-6">
            <span className={EYEBROW}>{t('lp.eyebrow')}</span>
            <h1 className="text-[40px] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[60px]">
              {t('lp.h1a')}<br />{t('lp.h1b')}
            </h1>
            <p className="max-w-[520px] text-[19px] leading-relaxed text-text-2">{t('lp.lead')}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/register" className={`${BTN_PRIMARY} ${LANDING_BTN}`}>
                {t('lp.cta_primary')}
                <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
              </Link>
              <a href="#how" className={`${BTN_SECONDARY} ${LANDING_BTN}`}>{t('lp.cta_secondary')}</a>
            </div>
            <p className="flex flex-wrap gap-x-[18px] gap-y-1 text-sm text-muted-foreground">
              {['lp.point1', 'lp.point2'].map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <Check size={16} strokeWidth={1.75} className="text-ok" aria-hidden="true" />
                  {t(key)}
                </span>
              ))}
            </p>
          </div>

          <div aria-hidden="true" className="relative rounded-2xl border border-border bg-subtle p-5 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px] sm:p-7">
            <div className={`${CARD} mx-auto flex max-w-[440px] flex-col p-[18px]`}>
              <div className="mb-3.5 flex items-center justify-between gap-2 border-b border-border pb-3.5">
                <span className="font-semibold">{t('lp.demo.title')}</span>
                <span className={statusBadgeClass('ok')}>
                  <span className="wv-blink h-[7px] w-[7px] rounded-full bg-ok" />
                  {t('lp.demo.running')}
                </span>
              </div>
              {demoSteps.map((step, index) => (
                <div key={step.key}>
                  {index > 0 && <span className="wv-flow ml-[29px] block h-5 w-0.5" />}
                  <div className="wv-step flex items-center gap-3 rounded-[10px] border border-border-strong bg-card px-3.5 py-3" style={{ animationDelay: step.delay }}>
                    <Tile kind={step.kind} code={step.code} />
                    <span className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{step.first ? t('lp.demo.when') : t('lp.demo.then')}</span>
                      <span className="text-[15px] font-semibold">{t(step.key)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className={`${CARD} absolute -bottom-5 right-2 flex items-center gap-2.5 px-3.5 py-2.5 shadow-pop sm:-right-3`}>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] bg-ok-bg text-ok">
                <Check size={15} strokeWidth={1.75} />
              </span>
              <span className="text-[13px] font-semibold">{t('lp.demo.done')}</span>
            </div>
          </div>
        </section>

        <section id="apps" aria-labelledby="apps-h" className="border-y border-border bg-card">
          <div className={`${WRAP} flex flex-col gap-5 py-12`}>
            <h2 id="apps-h" className="text-[15px] font-semibold text-text-2">{t('lp.apps.title')}</h2>
            <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
              {APPS.map((app) => (
                <li key={app.code} className="inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-border bg-card py-0 pl-2 pr-4 text-[15px] font-medium">
                  <Tile kind={app.kind} code={app.code} />
                  {label(app.name)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" aria-labelledby="how-h" className={`${WRAP} flex flex-col gap-12 pb-16 pt-24 sm:pt-28`}>
          <Heading eyebrow={t('lp.how.eyebrow')} id="how-h">{t('lp.how.h')}</Heading>
          <ol className="m-0 grid list-none gap-5 p-0 md:grid-cols-3">
            {[
              { n: '01', t: 'lp.how1', tiles: [['tr', 'Gm'], ['tr', 'Tg'], ['tr', t('lp.step.time')], ['tr', 'Wh']] as Array<[Kind, string]> },
              { n: '02', t: 'lp.how2', tiles: [['act', 'Sh'], ['ai', 'AI'], ['lg', t('lp.step.logic')], ['act', 'OC']] as Array<[Kind, string]> },
              { n: '03', t: 'lp.how3', tiles: [] as Array<[Kind, string]> },
            ].map((card) => (
              <li key={card.n} className={`${CARD} flex flex-col gap-3.5 p-7`}>
                <span className="font-mono text-[13px] text-muted-foreground">{card.n}</span>
                <h3 className="text-xl font-semibold">{t(`${card.t}.t`)}</h3>
                <p className="text-text-2">{t(`${card.t}.b`)}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {card.tiles.map(([kind, code]) => <Tile key={code} kind={kind} code={code} />)}
                  {card.n === '03' && (
                    <>
                      <span className={statusBadgeClass('ok')}>{t('lp.how3.ok')}</span>
                      <span className={statusBadgeClass('err')}>{t('lp.how3.err')}</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" aria-labelledby="feat-h" className={`${WRAP} flex flex-col gap-12 pb-28 pt-16`}>
          <Heading eyebrow={t('lp.feat.eyebrow')} id="feat-h">{t('lp.feat.h')}</Heading>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <article className={`${CARD} flex flex-col gap-4 p-7 lg:col-span-2`}>
              <h3 className="text-xl font-semibold">{t('lp.feat.ai.t')}</h3>
              <p className="max-w-[560px] text-text-2">{t('lp.feat.ai.b')}</p>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[10px] border border-border-strong bg-subtle p-4 text-[15px]">{t('lp.feat.ai.q')}</div>
                <div className="flex flex-col gap-2">
                  {([['tr', 'Gm', 's1'], ['ai', 'AI', 's2'], ['act', 'Sh', 's3'], ['act', 'Tg', 's4']] as Array<[Kind, string, string]>).map(([kind, code, key]) => (
                    <span key={key} className="flex items-center gap-2.5 text-sm"><Tile kind={kind} code={code} size={26} />{t(`lp.feat.ai.${key}`)}</span>
                  ))}
                </div>
              </div>
            </article>
            <article className={`${CARD} flex flex-col gap-4 p-7`}>
              <h3 className="text-xl font-semibold">{t('lp.feat.err.t')}</h3>
              <p className="text-text-2">{t('lp.feat.err.b')}</p>
              <div className="flex flex-col gap-2.5 rounded-[10px] bg-err-bg p-3.5 text-sm">
                <span className="font-semibold">{t('lp.feat.err.msg')}</span>
                <span className="inline-flex h-8 items-center self-start rounded-md border border-border-strong bg-card px-3 text-sm font-medium">{t('lp.feat.err.btn')}</span>
              </div>
            </article>
            <article className={`${CARD} flex flex-col gap-4 p-7`}>
              <h3 className="text-xl font-semibold">{t('lp.feat.bot.t')}</h3>
              <p className="text-text-2">{t('lp.feat.bot.b')}</p>
              <div className="flex flex-col gap-2 text-sm">
                <span className="self-end rounded-xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground">{t('lp.feat.bot.q')}</span>
                <span className="self-start rounded-xl rounded-tl-sm bg-subtle px-3 py-2">{t('lp.feat.bot.a')}</span>
              </div>
            </article>
            <article className={`${CARD} flex flex-col gap-4 p-7`}>
              <h3 className="text-xl font-semibold">{t('lp.feat.team.t')}</h3>
              <p className="text-text-2">{t('lp.feat.team.b')}</p>
              <dl className="m-0 flex flex-col gap-2 text-sm">
                {(['owner', 'member'] as const).map((role) => (
                  <div key={role} className="flex flex-col">
                    <dt className="font-medium">{t(`lp.feat.team.${role}`)}</dt>
                    <dd className="m-0 text-muted-foreground">{t(`lp.feat.team.${role}_d`)}</dd>
                  </div>
                ))}
              </dl>
            </article>
            <article className={`${CARD} flex flex-col gap-4 p-7`}>
              <h3 className="text-xl font-semibold">{t('lp.feat.ocr.t')}</h3>
              <p className="text-text-2">{t('lp.feat.ocr.b')}</p>
              <div className="flex items-center gap-2.5" aria-hidden="true">
                <Tile kind="tr" code="Tg" /><ArrowRight size={18} strokeWidth={1.75} className="text-muted-foreground" />
                <Tile kind="act" code="OC" /><ArrowRight size={18} strokeWidth={1.75} className="text-muted-foreground" />
                <Tile kind="act" code="Sh" />
              </div>
            </article>
            <article className={`${CARD} flex flex-col gap-4 p-7`}>
              <h3 className="text-xl font-semibold">{t('lp.feat.mobile.t')}</h3>
              <p className="text-text-2">{t('lp.feat.mobile.b')}</p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex h-[22px] items-center rounded-full bg-subtle px-2 text-xs font-medium text-text-2">Android</span>
                <span className="inline-flex h-[22px] items-center rounded-full bg-subtle px-2 text-xs font-medium text-text-2">iOS</span>
              </div>
            </article>
          </div>
        </section>

        <section aria-labelledby="uc-h" className="border-t border-border bg-card">
          <div className={`${WRAP} flex flex-col gap-10 py-24`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Heading eyebrow={t('lp.uc.eyebrow')} id="uc-h">{t('lp.uc.h')}</Heading>
              <Link to="/login" className={`${BTN_SECONDARY} h-9 px-3.5 text-sm`}>{t('lp.uc.all')}</Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {uses.map((use) => (
                <Link key={use.title} to="/login" className={`flex flex-col gap-3 rounded-xl border border-border bg-background p-[22px] text-foreground transition-colors hover:border-border-strong ${FOCUS_RING}`}>
                  <span className="text-[13px] font-semibold text-muted-foreground">{t(use.role)}</span>
                  <span className="text-[17px] font-semibold leading-snug">{t(use.title)}</span>
                  <span className="mt-auto flex gap-1" aria-hidden="true">
                    {use.steps.map((step) => <Tile key={step.code} kind={step.kind} code={step.code} size={26} />)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-h" className={`${WRAP} grid gap-12 pb-24 pt-24 lg:grid-cols-3 lg:pt-28`}>
          <Heading eyebrow={t('lp.faq.eyebrow')} id="faq-h">{t('lp.faq.h')}</Heading>
          <div className="border-t border-border lg:col-span-2">
            {faqs.map((n) => (
              <details key={n} open={n === 1} className="group border-b border-border py-1">
                <summary className={`flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-[17px] font-semibold [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
                  {t(`lp.faq${n}.q`)}
                  <span aria-hidden="true" className="font-mono text-xl font-normal text-muted-foreground group-open:hidden">+</span>
                  <span aria-hidden="true" className="hidden font-mono text-xl font-normal text-muted-foreground group-open:inline">−</span>
                </summary>
                <p className="max-w-[760px] pb-[18px] text-text-2">{t(`lp.faq${n}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`${WRAP} pb-24`}>
          <div className="flex flex-wrap items-center justify-between gap-8 rounded-2xl border border-border-strong bg-card px-6 py-12 sm:px-12 sm:py-14">
            <div className="flex max-w-[620px] flex-col gap-2.5">
              <h2 className="text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">{t('lp.cta.h')}</h2>
              <p className="text-text-2">{t('lp.cta.p')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/login" className={`${BTN_SECONDARY} ${LANDING_BTN}`}>{t('lp.login')}</Link>
              <Link to="/register" className={`${BTN_PRIMARY} ${LANDING_BTN}`}>{t('lp.cta.signup')}</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className={`${WRAP} flex flex-wrap items-center gap-6 pb-10 pt-8 text-sm text-muted-foreground`}>
          <span className="flex items-center gap-2 font-semibold text-foreground"><WeavMark className="h-[22px] w-[22px]" />Weav</span>
          <div className="flex-1" />
          <a className={NAV_LINK} href="#how">{t('lp.nav.how')}</a>
          <a className={NAV_LINK} href="#faq">{t('lp.nav.faq')}</a>
          <Link className={NAV_LINK} to="/login">{t('lp.login')}</Link>
        </div>
      </footer>
    </div>
  );
}
