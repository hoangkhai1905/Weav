import { useI18nStore, translations } from '../stores/i18n.store';

export function useTranslation() {
  const language = useI18nStore((s) => s.language);
  const toggleLanguage = useI18nStore((s) => s.toggleLanguage);
  const setLanguage = useI18nStore((s) => s.setLanguage);

  const t = (key: string): string => {
    return translations[language]?.[key] || key;
  };

  return {
    language,
    toggleLanguage,
    setLanguage,
    t,
  };
}
