/**
 * Friendly schedule picker -> the text the AI backend understands. The generate endpoint feeds
 * `answers` back to the model, whose prompt defines trigger.schedule.cron as 6 space-separated
 * fields "second minute hour day-of-month month day-of-week" ("0 0 8 * * *" = 08:00 daily).
 */
export type ScheduleFrequency = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const WEEKDAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export interface ScheduleChoice {
  frequency: ScheduleFrequency;
  /** 0..23 (ignored for HOURLY). */
  hour: number;
  /** 0..59. */
  minute: number;
  weekday: WeekdayCode;
  /** 1..28 so that every month has the day. */
  monthDay: number;
}

export const DEFAULT_SCHEDULE: ScheduleChoice = {
  frequency: 'DAILY',
  hour: 8,
  minute: 0,
  weekday: 'MON',
  monthDay: 1,
};

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isValidSchedule(choice: ScheduleChoice): boolean {
  return (
    inRange(choice.minute, 0, 59) &&
    (choice.frequency === 'HOURLY' || inRange(choice.hour, 0, 23)) &&
    (choice.frequency !== 'WEEKLY' || WEEKDAY_CODES.includes(choice.weekday)) &&
    (choice.frequency !== 'MONTHLY' || inRange(choice.monthDay, 1, 28))
  );
}

/** Six-field cron, seconds first. Returns null for an invalid choice. */
export function buildCron(choice: ScheduleChoice): string | null {
  if (!isValidSchedule(choice)) return null;
  const { minute, hour } = choice;
  switch (choice.frequency) {
    case 'HOURLY':
      return `0 ${minute} * * * *`;
    case 'DAILY':
      return `0 ${minute} ${hour} * * *`;
    case 'WEEKLY':
      return `0 ${minute} ${hour} * * ${choice.weekday}`;
    case 'MONTHLY':
      return `0 ${minute} ${hour} ${choice.monthDay} * *`;
  }
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The answer sent to the backend: the plain-language sentence plus the exact cron. */
export function buildScheduleAnswer(choice: ScheduleChoice, sentence: string): string | null {
  const cron = buildCron(choice);
  return cron ? `${sentence.trim()} (cron: ${cron})` : null;
}
