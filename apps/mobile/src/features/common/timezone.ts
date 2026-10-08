/** The device time zone (IANA id), the default for AI questions and the assistant. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Short list for the time zone picker; the device zone is always added in front. */
export const COMMON_TIME_ZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
] as const;

export function timeZoneChoices(device: string = deviceTimeZone()): string[] {
  return [device, ...COMMON_TIME_ZONES.filter((zone) => zone !== device)];
}
