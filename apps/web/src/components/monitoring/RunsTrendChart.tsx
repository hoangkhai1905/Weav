import { useI18nStore } from '../../store/useI18nStore';
import { appLocale } from '../../lib/i18n/tr';
import type { MonitoringSummary } from '../../api/monitoring.api';

const WIDTH = 560;
const HEIGHT = 140;
const BASE = 120;
const TOP = 12;

/**
 * Stacked daily bars (success under failed) from the zero-filled UTC trend. The SVG is described for screen
 * readers by a text summary and a visually hidden table, so no information lives only in the colours.
 */
export function RunsTrendChart({ trend }: { trend: MonitoringSummary['trend'] }) {
  const { t } = useI18nStore();
  const locale = appLocale();
  const max = Math.max(1, ...trend.map((day) => day.total));
  const slot = WIDTH / Math.max(1, trend.length);
  const bar = Math.min(40, slot * 0.6);
  const scale = (BASE - TOP) / max;
  const label = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const labelEvery = Math.ceil(trend.length / 8);
  const total = trend.reduce((sum, day) => sum + day.total, 0);

  return (
    <figure data-testid="monitoring-trend" className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('monitoring.trend_label').replace('{count}', String(total)).replace('{days}', String(trend.length))} className="h-auto w-full">
        <line x1="0" y1={BASE} x2={WIDTH} y2={BASE} className="stroke-border" strokeWidth="1" />
        {trend.map((day, index) => {
          const x = index * slot + (slot - bar) / 2;
          const successHeight = day.success * scale;
          const failedHeight = day.failed * scale;
          const otherHeight = Math.max(0, day.total - day.success - day.failed) * scale;
          return (
            <g key={day.date} data-testid="monitoring-trend-day" data-date={day.date}>
              <title>{`${label(day.date)}: ${day.total} (${day.success} ${t('monitoring.success')}, ${day.failed} ${t('monitoring.failed')})`}</title>
              <rect x={x} y={BASE - successHeight} width={bar} height={successHeight} className="fill-ok" />
              <rect x={x} y={BASE - successHeight - failedHeight} width={bar} height={failedHeight} className="fill-err" />
              <rect x={x} y={BASE - successHeight - failedHeight - otherHeight} width={bar} height={otherHeight} className="fill-muted-foreground/40" />
              {index % labelEvery === 0 && (
                <text x={x + bar / 2} y={HEIGHT - 4} textAnchor="middle" className="fill-muted-foreground" fontSize="10">{label(day.date)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ok" aria-hidden="true" />{t('monitoring.success')}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-err" aria-hidden="true" />{t('monitoring.failed')}</span>
        <span>{t('monitoring.utc_days')}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{t('monitoring.trend_table')}</caption>
        <thead><tr><th>{t('monitoring.col_date')}</th><th>{t('monitoring.total')}</th><th>{t('monitoring.success')}</th><th>{t('monitoring.failed')}</th></tr></thead>
        <tbody>
          {trend.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.total}</td><td>{day.success}</td><td>{day.failed}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
