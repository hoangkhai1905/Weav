import { useI18nStore } from '../../store/useI18nStore';

/** Non-hook translation for modules outside React (API clients, error mappers). */
/** BCP-47 locale for number/date formatting that follows the selected UI language. */
export const appLocale = (): string => (useI18nStore.getState().language === 'VI' ? 'vi-VN' : 'en-US');

export const tr = (key: string): string => useI18nStore.getState().t(key);
