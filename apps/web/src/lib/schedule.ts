// Friendly schedule <-> Spring 6-field cron (second minute hour day-of-month month day-of-week).
// The Workflow Service accepts any valid Spring CronExpression with no minimum interval, so only
// the patterns below get a guided form; every other cron stays in the advanced mode untouched.

export type ScheduleMode = 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'advanced';
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const MINUTE_STEPS = [5, 10, 15, 30] as const;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 12] as const;

export interface ScheduleForm {
  mode: ScheduleMode;
  /** Step for the "every N minutes/hours" modes. */
  n: number;
  /** HH:MM, 24h. */
  time: string;
  days: Weekday[];
  /** Day of month, 1-31. */
  dom: number;
}

export const DEFAULT_FORM: ScheduleForm = { mode: 'daily', n: 15, time: '09:00', days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], dom: 1 };

/** Consecutive weekdays (Mon..Sun order) as [first, last] runs. */
export function weekdayRuns(days: readonly Weekday[]): Array<[Weekday, Weekday]> {
  const idx = WEEKDAYS.map((d) => days.includes(d));
  const runs: Array<[Weekday, Weekday]> = [];
  for (let i = 0; i < 7; i += 1) {
    if (!idx[i]) continue;
    let j = i;
    while (j + 1 < 7 && idx[j + 1]) j += 1;
    runs.push([WEEKDAYS[i], WEEKDAYS[j]]);
    i = j;
  }
  return runs;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function buildCron(form: ScheduleForm): string {
  const [hour, minute] = form.time.split(':').map(Number);
  switch (form.mode) {
    case 'minutes': return `0 */${form.n} * * * *`;
    case 'hours': return `0 0 */${form.n} * * *`;
    case 'daily': return `0 ${minute} ${hour} * * *`;
    case 'monthly': return `0 ${minute} ${hour} ${form.dom} * *`;
    default: {
      // Runs of 3+ days become ranges (MON-FRI); shorter runs are listed.
      const dow = weekdayRuns(form.days).flatMap(([a, b]) => {
        const span = WEEKDAYS.indexOf(b) - WEEKDAYS.indexOf(a);
        return span >= 2 ? [`${a}-${b}`] : span === 1 ? [a, b] : [a];
      }).join(',');
      return `0 ${minute} ${hour} * * ${dow || 'MON'}`;
    }
  }
}

const num = (value: string, max: number): number | null => (/^\d{1,2}$/.test(value) && Number(value) <= max ? Number(value) : null);

function parseDays(field: string): Weekday[] | null {
  const days = new Set<Weekday>();
  for (const part of field.toUpperCase().split(',')) {
    const [a, b = a, extra] = part.split('-');
    const from = WEEKDAYS.indexOf(a as Weekday);
    const to = WEEKDAYS.indexOf(b as Weekday);
    if (extra !== undefined || from < 0 || to < from) return null;
    for (let i = from; i <= to; i += 1) days.add(WEEKDAYS[i]);
  }
  return WEEKDAYS.filter((d) => days.has(d));
}

/** Returns the form for a cron the picker can represent exactly, otherwise null (use advanced mode). */
export function parseCron(cron: string): ScheduleForm | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 6 || f[0] !== '0' || f[4] !== '*') return null;
  const [, min, hour, dom, , dow] = f;
  const step = (field: string, allowed: readonly number[]) => {
    const m = /^\*\/(\d{1,2})$/.exec(field);
    return m && allowed.includes(Number(m[1])) ? Number(m[1]) : null;
  };
  if (hour === '*' && dom === '*' && dow === '*') {
    const n = step(min, MINUTE_STEPS);
    return n ? { ...DEFAULT_FORM, mode: 'minutes', n } : null;
  }
  if (min === '0' && dom === '*' && dow === '*') {
    const n = step(hour, HOUR_STEPS);
    if (n) return { ...DEFAULT_FORM, mode: 'hours', n };
  }
  const m = num(min, 59);
  const h = num(hour, 23);
  if (m === null || h === null) return null;
  const time = `${pad(h)}:${pad(m)}`;
  if (dom === '*' && dow === '*') return { ...DEFAULT_FORM, mode: 'daily', time };
  if (dom === '*') {
    const days = parseDays(dow);
    return days?.length ? { ...DEFAULT_FORM, mode: 'weekly', time, days } : null;
  }
  const d = num(dom, 31);
  return dow === '*' && d !== null && d >= 1 ? { ...DEFAULT_FORM, mode: 'monthly', time, dom: d } : null;
}
