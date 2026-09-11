import { create } from 'zustand';
import { TRANSLATIONS, type Language } from '../lib/i18n/translations';

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string) => string;
}

const SAVED_LANG_KEY = 'weav_lang_v1';
const getInitialLanguage = (): Language => {
  const saved = localStorage.getItem(SAVED_LANG_KEY);
  return saved === 'EN' || saved === 'VI' ? saved : 'VI';
};

const initialLang = getInitialLanguage();

export const useI18nStore = create<I18nState>((set, get) => ({
  language: initialLang,
  setLanguage: (language: Language) => {
    localStorage.setItem(SAVED_LANG_KEY, language);
    set({ language });
  },
  toggleLanguage: () => {
    const current = get().language;
    const next: Language = current === 'VI' ? 'EN' : 'VI';
    localStorage.setItem(SAVED_LANG_KEY, next);
    set({ language: next });
  },
  t: (key: string) => {
    const lang = get().language;
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.EN;
    return dict[key] || TRANSLATIONS.EN[key] || key;
  },
}));
