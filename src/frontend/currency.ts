/** Frontend currency display + input parsing (mirrors src/config/currencies.ts). */
import type { Lang } from './i18n';
import { toFaDigits } from './i18n';

export interface Cur {
  code: string;
  minorPerMajor: number;
  decimals: number;
  symbol: Record<Lang, string>;
  /** Symbol before the number (en/EUR: €1,234.56). */
  prefix: Partial<Record<Lang, boolean>>;
}

export const CURRENCIES: Record<string, Cur> = {
  EUR: { code: 'EUR', minorPerMajor: 100, decimals: 2, symbol: { fa: '€', de: '€', en: '€' }, prefix: { en: true } },
  IRR: { code: 'IRR', minorPerMajor: 1, decimals: 0, symbol: { fa: 'ریال', de: 'Rial', en: 'IRR' }, prefix: {} },
  IRT: { code: 'IRT', minorPerMajor: 1, decimals: 0, symbol: { fa: 'تومان', de: 'Toman', en: 'Toman' }, prefix: {} },
  IRT_NEW: { code: 'IRT_NEW', minorPerMajor: 100, decimals: 2, symbol: { fa: 'تومان', de: 'Toman', en: 'Toman' }, prefix: {} },
};

const SEPARATORS: Record<Lang, { group: string; dec: string }> = {
  fa: { group: '٬', dec: '٫' },
  de: { group: '.', dec: ',' },
  en: { group: ',', dec: '.' },
};

export function getCur(code: string | null | undefined): Cur {
  return CURRENCIES[code ?? 'EUR'] ?? CURRENCIES.EUR!;
}

function formatNumber(minor: number, c: Cur, lang: Lang): string {
  const { group, dec } = SEPARATORS[lang];
  const abs = Math.abs(minor);
  const major = Math.trunc(abs / c.minorPerMajor);
  const sub = abs % c.minorPerMajor;
  let out = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  if (c.decimals > 0) out += dec + String(sub).padStart(c.decimals, '0');
  return lang === 'fa' ? toFaDigits(out) : out;
}

/** Format an integer minor amount for display, e.g. 123456 EUR → "1.234,56 €" (de). */
export function money(minor: number, code: string | null | undefined, lang: Lang): string {
  const c = getCur(code);
  const n = formatNumber(minor, c, lang);
  const sign = minor < 0 ? '−' : '';
  const sym = c.symbol[lang];
  return c.prefix[lang] ? `${sign}${sym}${n}` : `${sign}${n} ${sym}`;
}

/** Major-unit string for an input field, e.g. 123456 → "1234.56" / "1234,56". */
export function toInput(minor: number, code: string, lang: Lang): string {
  const c = getCur(code);
  if (!minor) return '';
  const major = minor / c.minorPerMajor;
  const s = c.decimals ? major.toFixed(c.decimals) : String(Math.round(major));
  return lang === 'de' ? s.replace('.', ',') : s;
}

/**
 * Parse what a user typed (any of "1.234,56", "1,234.56", "1234,5", "۱۲۳۴٫۵",
 * "1 234") into integer minor units. Returns null if not a number.
 */
export function parseMoney(input: string, code: string): number | null {
  const c = getCur(code);
  let s = input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬\s'’]/g, '')
    .replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const grpSep = decSep === '.' ? ',' : '.';
    s = s.split(grpSep).join('').replace(decSep, '.');
  } else if (lastComma >= 0) {
    // "1,5" → decimal; "1,000,000" or any comma in a no-decimals currency → grouping.
    const parts = s.split(',');
    s = parts.length > 2 || c.decimals === 0 ? parts.join('') : parts.join('.');
  } else if (lastDot >= 0) {
    // "1.5" → decimal; "1.234" / "1.000.000" / no-decimals currency → grouping.
    const parts = s.split('.');
    if (parts.length > 2 || c.decimals === 0 || (parts[1]?.length === 3 && c.decimals < 3)) s = parts.join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * c.minorPerMajor);
}

/** Parse a quantity like "1,5" or "۲" → "1.5" (string, as the API expects). */
export function normalizeQty(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.]/g, '');
}
