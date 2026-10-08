/** "2026-10-05T09:00" from a datetime-local input -> RFC 3339 with the browser's UTC offset ("...+07:00"). */
export const withLocalOffset = (local: string): string => {
  const minutes = -new Date(local).getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** What a datetime-local input shows for a stored start/end: the same instant in browser time (no shifting). */
export const toLocalInput = (text: string): string => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(text)) return '';
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(text)) return text.slice(0, 16); // no offset: a wall-clock time in the event's own time zone
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
