import { en, type TKey } from './en';
import { he } from './he';
import { useApp } from '../store';
import { formatBytes, formatDate, formatNumber } from '@shared/format';

const dicts = { en, he } as const;

export function translate(lang: 'en' | 'he', key: TKey | string, args?: Record<string, string | number>): string {
  const d = dicts[lang] as Record<string, string>;
  let s = d[key] ?? (en as Record<string, string>)[key] ?? key;
  if (args) for (const [k, v] of Object.entries(args)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function useT() {
  const lang = useApp((s) => s.settings?.language ?? 'en');
  const t = (key: TKey | string, args?: Record<string, string | number>) => translate(lang, key, args);
  return {
    t,
    lang,
    rtl: lang === 'he',
    // Directional isolates keep "58.7 GB" in left-to-right order inside Hebrew (RTL) text.
    bytes: (b: number | null | undefined, digits?: number) => (lang === 'he' ? `\u2066${formatBytes(b, digits)}\u2069` : formatBytes(b, digits)),
    num: (n: number | null | undefined) => formatNumber(n, lang),
    date: (ts: number | null | undefined, withTime = true) => formatDate(ts, lang, withTime),
  };
}

export type { TKey };
