import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import en from './en';
import zh from './zh';
import type { Translations } from './en';

type Locale = 'en' | 'zh';

const HASH_MAP: Record<string, Locale> = {
  'zh-CN': 'zh',
  'en-US': 'en',
};

const LOCALE_TO_HASH: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en-US',
};

const locales: Record<Locale, Translations> = { en, zh };

function getLocaleFromHash(): Locale {
  const hash = location.hash.replace('#', '');
  return HASH_MAP[hash] || 'zh';
}

const I18nContext = createContext<{
  t: Translations;
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({ t: zh, locale: 'zh', setLocale: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const l = getLocaleFromHash();
    if (!location.hash) location.hash = LOCALE_TO_HASH[l];
    return l;
  });

  const changeLocale = useCallback((l: Locale) => {
    setLocale(l);
    location.hash = LOCALE_TO_HASH[l];
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const l = getLocaleFromHash();
      setLocale(l);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <I18nContext.Provider value={{ t: locales[locale], locale, setLocale: changeLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
