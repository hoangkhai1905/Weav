export type DayBucket = 'today' | 'yesterday' | 'earlier';

export interface DayGroup<T> {
  /** yyyy-MM-dd in the device time zone; stable list key. */
  key: string;
  bucket: DayBucket;
  /** The day itself, used to print the date for "earlier". */
  date: Date;
  items: T[];
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Groups items (already newest first) by local calendar day, keeping their order.
 * Items with an unreadable timestamp are skipped.
 */
export function groupByDay<T>(items: readonly T[], getTime: (item: T) => string, now: Date = new Date()): DayGroup<T>[] {
  const today = startOfDay(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const at = new Date(getTime(item));
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
    let group = byKey.get(key);
    if (!group) {
      const bucket: DayBucket = key === dayKey(today) ? 'today' : key === dayKey(yesterday) ? 'yesterday' : 'earlier';
      group = { key, bucket, date: startOfDay(at), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
