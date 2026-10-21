import { useLang } from './i18n';

/** Medium date (for example "4 Mar 2026") in the language the admin picked. */
export function useFormatDate(): (iso: string) => string {
  const locale = useLang() === 'EN' ? 'en-GB' : 'vi-VN';
  return (iso) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Short date and time (for example "04 Mar 2026, 09:42") in the language the admin picked; "—" when missing. */
export function useFormatDateTime(): (iso: string | null | undefined) => string {
  const locale = useLang() === 'EN' ? 'en-GB' : 'vi-VN';
  return (iso) => (iso ? new Date(iso).toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
}
