import React, { useState } from 'react';
import { useI18nStore } from '../../store/useI18nStore';
import {
  DEFAULT_FORM,
  HOUR_STEPS,
  MINUTE_STEPS,
  WEEKDAYS,
  buildCron,
  parseCron,
  weekdayRuns,
  type ScheduleForm,
  type ScheduleMode,
  type Weekday,
} from '../../lib/schedule';

const fieldCls = 'w-full min-w-0 rounded-md border border-border-strong bg-card px-2.5 py-1.5 text-xs text-foreground outline-none hover:border-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';
const labelCls = 'mb-1 block text-[11px] font-medium text-text-2';
const hintCls = 'text-[10px] leading-relaxed text-muted-foreground';

const MODES: ScheduleMode[] = ['minutes', 'hours', 'daily', 'weekly', 'monthly', 'advanced'];
// [IANA id, i18n key of the friendly name]
const ZONES: Array<[string, string]> = [
  ['Asia/Ho_Chi_Minh', 'builder.schedule.tz_vn'],
  ['Asia/Bangkok', 'builder.schedule.tz_bangkok'],
  ['Asia/Singapore', 'builder.schedule.tz_singapore'],
  ['Asia/Tokyo', 'builder.schedule.tz_tokyo'],
  ['Asia/Seoul', 'builder.schedule.tz_seoul'],
  ['Australia/Sydney', 'builder.schedule.tz_sydney'],
  ['Europe/London', 'builder.schedule.tz_london'],
  ['Europe/Paris', 'builder.schedule.tz_paris'],
  ['America/New_York', 'builder.schedule.tz_new_york'],
  ['America/Los_Angeles', 'builder.schedule.tz_los_angeles'],
  ['UTC', 'builder.schedule.tz_utc'],
];
const OTHER = '__other';

interface SchedulePickerProps {
  cron: string;
  timezone: string;
  onChange: (updates: { cron?: string; timezone?: string }) => void;
}

/** Guided editor for trigger.schedule. Remount per node (key) because the form state is seeded from the saved cron once. */
export const SchedulePicker: React.FC<SchedulePickerProps> = ({ cron, timezone, onChange }) => {
  const { t } = useI18nStore();
  // An unrecognised cron opens in advanced mode and is only rewritten when the user edits it.
  const [form, setForm] = useState<ScheduleForm>(() => parseCron(cron) ?? { ...DEFAULT_FORM, mode: 'advanced' });
  const [otherZone, setOtherZone] = useState(() => Boolean(timezone) && !ZONES.some(([id]) => id === timezone));
  const advanced = form.mode === 'advanced';

  const update = (patch: Partial<ScheduleForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (next.mode !== 'advanced') onChange({ cron: buildCron(next) });
  };
  const changeMode = (mode: ScheduleMode) => {
    const steps: readonly number[] = mode === 'hours' ? HOUR_STEPS : MINUTE_STEPS;
    update({ mode, n: steps.includes(form.n) ? form.n : mode === 'hours' ? 2 : 15 });
  };
  const toggleDay = (day: Weekday) => {
    const days = form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day];
    if (days.length) update({ days: WEEKDAYS.filter((d) => days.includes(d)) });
  };

  const zoneName = (id: string) => {
    const zone = ZONES.find(([zoneId]) => zoneId === id);
    return zone ? t(zone[1]) : id;
  };
  const zoneLabel = timezone ? ` (${zoneName(timezone)})` : '';
  const dayName = (d: Weekday) => t(`builder.schedule.day_full_${d.toLowerCase()}`);
  const days = weekdayRuns(form.days)
    .map(([a, b]) => (a === b ? dayName(a) : `${dayName(a)} – ${dayName(b)}`))
    .join(', ');
  const summaryKey = `builder.schedule.summary_${form.mode}`;
  const summary = advanced ? '' : t(summaryKey)
    .replace('{n}', String(form.n))
    .replace('{time}', form.time)
    .replace('{days}', days)
    .replace('{dom}', String(form.dom)) + (form.mode === 'minutes' || form.mode === 'hours' ? '' : zoneLabel);

  return (
    <div data-testid="schedule-config" className="space-y-3">
      <div>
        <label htmlFor="schedule-repeat" className={labelCls}>{t('builder.schedule.repeat')}</label>
        <select id="schedule-repeat" data-testid="schedule-repeat" value={form.mode} onChange={(event) => changeMode(event.target.value as ScheduleMode)} className={fieldCls}>
          {MODES.map((mode) => <option key={mode} value={mode}>{t(`builder.schedule.mode_${mode}`)}</option>)}
        </select>
      </div>

      {(form.mode === 'minutes' || form.mode === 'hours') && (
        <div>
          <label htmlFor="schedule-step" className={labelCls}>{t(form.mode === 'minutes' ? 'builder.schedule.every_minutes' : 'builder.schedule.every_hours')}</label>
          <select id="schedule-step" data-testid="schedule-step" value={form.n} onChange={(event) => update({ n: Number(event.target.value) })} className={fieldCls}>
            {(form.mode === 'minutes' ? MINUTE_STEPS : HOUR_STEPS).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      {form.mode === 'weekly' && (
        <fieldset>
          <legend className={labelCls}>{t('builder.schedule.weekdays')}</legend>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => (
              <button
                key={day}
                type="button"
                data-testid={`schedule-day-${day}`}
                aria-pressed={form.days.includes(day)}
                aria-label={dayName(day)}
                onClick={() => toggleDay(day)}
                className={`h-8 min-w-9 rounded-md border px-1.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${form.days.includes(day) ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-card text-text-2 hover:border-muted-foreground'}`}
              >
                {t(`builder.schedule.day_short_${day.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {form.mode === 'monthly' && (
        <div>
          <label htmlFor="schedule-dom" className={labelCls}>{t('builder.schedule.day_of_month')}</label>
          <select id="schedule-dom" data-testid="schedule-dom" value={form.dom} onChange={(event) => update({ dom: Number(event.target.value) })} className={fieldCls}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {form.dom > 28 && <p className={`mt-1 ${hintCls}`}>{t('builder.schedule.short_month_hint')}</p>}
        </div>
      )}

      {(form.mode === 'daily' || form.mode === 'weekly' || form.mode === 'monthly') && (
        <div>
          <label htmlFor="schedule-time" className={labelCls}>{t('builder.schedule.time')}</label>
          <input
            id="schedule-time"
            data-testid="schedule-time"
            type="time"
            value={form.time}
            onChange={(event) => { if (/^\d{2}:\d{2}$/.test(event.target.value)) update({ time: event.target.value }); }}
            className={fieldCls}
          />
        </div>
      )}

      {advanced && (
        <div>
          <label htmlFor="schedule-cron" className={labelCls}>{t('builder.schedule.cron')}</label>
          <input
            id="schedule-cron"
            data-testid="schedule-cron"
            value={cron}
            placeholder="0 0 9 * * *"
            onChange={(event) => onChange({ cron: event.target.value })}
            className={`${fieldCls} font-mono`}
          />
          <p className={`mt-1 ${hintCls}`}>{t('builder.schedule.cron_hint')}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] font-medium text-run hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('builder.schedule.cron_help_title')}</summary>
            <p className={`mt-1 ${hintCls}`}>{t('builder.schedule.cron_help')}</p>
          </details>
        </div>
      )}

      <div>
        <label htmlFor="schedule-timezone" className={labelCls}>{t('builder.schedule.timezone')}</label>
        <select
          id="schedule-timezone"
          data-testid="schedule-timezone"
          value={otherZone ? OTHER : timezone}
          onChange={(event) => {
            if (event.target.value === OTHER) { setOtherZone(true); return; }
            setOtherZone(false);
            onChange({ timezone: event.target.value });
          }}
          className={fieldCls}
        >
          {!otherZone && !timezone && <option value="">—</option>}
          {ZONES.map(([id, key]) => <option key={id} value={id}>{id === t(key) ? id : `${t(key)} (${id})`}</option>)}
          <option value={OTHER}>{t('builder.schedule.tz_other')}</option>
        </select>
        {otherZone && (
          <input
            data-testid="schedule-timezone-other"
            aria-label={t('builder.schedule.tz_other_label')}
            value={timezone}
            placeholder="Asia/Ho_Chi_Minh"
            onChange={(event) => onChange({ timezone: event.target.value })}
            className={`${fieldCls} mt-1.5 font-mono`}
          />
        )}
      </div>

      {summary && <p data-testid="schedule-summary" className="rounded border border-border bg-subtle px-2.5 py-2 text-[11px] leading-relaxed text-text-2">{summary}</p>}
    </div>
  );
};
