import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { store } from '../storage.ts';
import ar from './ar.ts';
import en, { type Catalog, type MessageKey } from './en.ts';

export const LOCALES = { en: { label: 'English', catalog: en, rtl: false }, ar: { label: 'العربية', catalog: ar, rtl: true } } as const;
export type Locale = keyof typeof LOCALES;

function detect(): Locale {
  const saved = store.get('locale');
  if (saved && saved in LOCALES) return saved as Locale;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return nav in LOCALES ? (nav as Locale) : 'en';
}

export function translate(catalog: Catalog, locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  let msg = catalog[key] ?? en[key] ?? key;
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  if (typeof msg === 'object') {
    const n = typeof vars.n === 'number' ? vars.n : 0;
    // Arabic distinguishes zero/one/two/few/many/other; Intl handles it.
    const cat = n === 0 && msg.zero ? 'zero' : new Intl.PluralRules(locale).select(n);
    msg = (msg as Record<string, string>)[cat] ?? msg.other;
  }
  return String(msg).replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return typeof v === 'number' ? num(v) : v === undefined ? '' : String(v);
  });
}

interface I18nValue {
  locale: Locale;
  setLocale(l: Locale): void;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
  fmtNumber(n: number, o?: Intl.NumberFormatOptions): string;
  fmtUsdc(v: number | string | null | undefined): string;
  fmtTime(v: number | string | Date): string;
  fmtDateTime(v: number | string | Date): string;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detect);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALES[locale].rtl ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    store.set('locale', l);
    setLocaleState(l);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const catalog = LOCALES[locale].catalog;
    const nf = (n: number, o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, o).format(n);
    return {
      locale,
      setLocale,
      t: (key, vars) => translate(catalog, locale, key, vars),
      fmtNumber: nf,
      // USDC isn't ISO-4217, so Intl's currency style can't be used directly.
      fmtUsdc: (v) => {
        const n = Number(v);
        if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '— USDC';
        const precision = store.get('usdcPrecision') === '7' ? 7 : 2;
        return translate(catalog, locale, 'usdc', { amount: nf(n, { minimumFractionDigits: precision, maximumFractionDigits: precision }) });
      },
      fmtTime: (v) => new Date(v).toLocaleTimeString(locale),
      fmtDateTime: (v) => new Date(v).toLocaleString(locale),
    };
  }, [locale, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}
