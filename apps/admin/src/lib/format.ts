import { useLang } from './i18n';

/** Medium date (for example "4 Mar 2026") in the language the admin picked. */
export function useFormatDate(): (iso: string) => string {
  const locale = useLang() === 'EN' ? 'en-GB' : 'vi-VN';
  return (iso) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
