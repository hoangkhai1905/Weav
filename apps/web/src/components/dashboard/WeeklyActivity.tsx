import type { MonitoringSummary } from '../../api/monitoring.api';
import { CARD } from '../../lib/uiClasses';
import { useI18nStore } from '../../store/useI18nStore';

const DAY_MS = 86_400_000;
const CHART_HEIGHT = 130;

/** Bars for the last `days` days (UTC dates, same as the server). Success in accent blue, failures in red on top. */
export function WeeklyActivity({ summary, locale }: { summary: MonitoringSummary; locale: string }) {
  const { t } = useI18nStore();
  const byDate = new Map(summary.trend.map((point) => [point.date.slice(0, 10), point]));
  const end = Date.parse(summary.to);
  const lastDay = Number.isFinite(end) ? end : 0;
  const count = Math.min(Math.max(summary.days, 1), 7);
  const days = Array.from({ length: count }, (_, index) => {
    const date = new Date(lastDay - (count - 1 - index) * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    const point = byDate.get(key);
    return {
      key,
      total: point?.total ?? 0,
      failed: point?.failed ?? 0,
      label: date.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }),
      today: index === count - 1,
    };
  });
  const max = Math.max(1, ...days.map((day) => day.total));
  const peak = days.reduce((best, day) => (day.total > best.total ? day : best), days[0]);
  const chartLabel = summary.runs.total === 0
    ? t('home.activity.empty')
    : t('home.activity.chart_label').replace('{days}', String(days.length)).replace('{day}', peak.label).replace('{count}', String(peak.total));

  return (
    <section aria-labelledby="home-activity" className={`${CARD} flex flex-col gap-3.5 px-[18px] py-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="home-activity" className="text-[15px] font-semibold text-foreground">{t('home.activity.title').replace('{days}', String(days.length))}</h2>
        <span className="flex gap-3 text-xs text-text-2">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-run" />{t('home.activity.ok')}</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-err" />{t('home.activity.failed')}</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={chartLabel}
        className="grid h-[170px] items-end gap-2.5 border-b border-border pt-2.5"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((day) => (
          <div key={day.key} className="flex h-full flex-col items-stretch justify-end gap-0.5">
            <span className="text-center font-mono text-[10px] text-muted-foreground">{day.total}</span>
            {day.failed > 0 && <div className="rounded-sm bg-err" style={{ height: Math.max(3, Math.round((day.failed / max) * CHART_HEIGHT)) }} />}
            <div className="rounded-t-[3px] bg-run" style={{ height: Math.round(((day.total - day.failed) / max) * CHART_HEIGHT) }} />
          </div>
        ))}
      </div>
      <div className="grid gap-2.5 text-center text-xs text-muted-foreground" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => (
          <span key={day.key} className={day.today ? 'font-medium text-foreground' : undefined}>{day.today ? t('home.activity.today') : day.label}</span>
        ))}
      </div>
    </section>
  );
}
