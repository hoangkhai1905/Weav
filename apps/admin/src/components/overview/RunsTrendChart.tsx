import { useEffect, useRef, useState } from 'react';
import { useLang, useT } from '../../lib/i18n';
import type { TrendDay } from '../../api/executions';

const HEIGHT = 160;
const BASE = 136;
const TOP = 12;
const FONT = 12;
/** Pixels reserved per date label, so a narrow phone shows fewer dates instead of tiny or overlapping ones. */
const LABEL_SLOT = 64;

/**
 * Stacked daily bars (success under failed) from the zero-filled UTC trend. The SVG is described for screen
 * readers by a text summary and a visually hidden table, so no information lives only in the colours.
 * Same approach as the user web's RunsTrendChart; hand-written SVG, no chart library.
 */
export function RunsTrendChart({ trend }: { trend: TrendDay[] }) {
  const t = useT();
  // The viewBox is as wide as the chart really is, so 1 unit = 1 px and the labels keep the same readable size on every screen.
  const box = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const locale = useLang() === 'EN' ? 'en-GB' : 'vi-VN';
  const max = Math.max(1, ...trend.map((day) => day.total));
  const slot = width / Math.max(1, trend.length);
  const bar = Math.min(40, slot * 0.6);
  const scale = (BASE - TOP) / max;
  const label = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const labelEvery = Math.ceil(trend.length / Math.max(2, Math.floor(width / LABEL_SLOT)));
  const total = trend.reduce((sum, day) => sum + day.total, 0);
  const hasOther = trend.some((day) => day.total > day.success + day.failed);
  const success = t('run.status.SUCCESS');
  const failed = t('run.status.FAILED');

  return (
    <figure ref={box} data-testid="trend-chart" className="relative m-0">
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={t('overview.trend_label', { count: total, days: trend.length })} className="h-auto w-full">
        <line x1="0" y1={BASE} x2={width} y2={BASE} className="stroke-border" strokeWidth="1" />
        {trend.map((day, index) => {
          const x = index * slot + (slot - bar) / 2;
          const center = x + bar / 2;
          const successHeight = day.success * scale;
          const failedHeight = day.failed * scale;
          const otherHeight = Math.max(0, day.total - day.success - day.failed) * scale;
          return (
            <g key={day.day} data-testid="trend-day" data-date={day.day}>
              <title>{`${label(day.day)}: ${day.total} (${day.success} ${success}, ${day.failed} ${failed})`}</title>
              <rect x={x} y={BASE - successHeight} width={bar} height={successHeight} className="fill-ok" />
              <rect x={x} y={BASE - successHeight - failedHeight} width={bar} height={failedHeight} className="fill-err" />
              <rect x={x} y={BASE - successHeight - failedHeight - otherHeight} width={bar} height={otherHeight} className="fill-muted-foreground/40" />
              {index % labelEvery === 0 && (
                <text x={center} y={HEIGHT - 4} textAnchor={center < 20 ? 'start' : center > width - 20 ? 'end' : 'middle'} className="fill-muted-foreground" fontSize={FONT}>{label(day.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ok" aria-hidden="true" />{success}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-err" aria-hidden="true" />{failed}</span>
        {hasOther && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted-foreground/40" aria-hidden="true" />{t('overview.legend_other')}</span>}
        <span>{t('overview.utc_days')}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{t('overview.trend_table')}</caption>
        <thead><tr><th>{t('overview.col_date')}</th><th>{t('overview.col_total')}</th><th>{success}</th><th>{failed}</th></tr></thead>
        <tbody>
          {trend.map((day) => <tr key={day.day}><td>{day.day}</td><td>{day.total}</td><td>{day.success}</td><td>{day.failed}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
