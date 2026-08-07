/** Frontend currency display (mirrors src/config/currencies.ts). */
export interface Cur {
  code: string; minorPerMajor: number; decimals: number;
  labelFa: string; minorLabelFa: string | null; suffixFa: string;
  persian: boolean; group: string; dec: string;
}

const EUR: Cur = { code: 'EUR', minorPerMajor: 100, decimals: 2, labelFa: 'یورو', minorLabelFa: 'سنت', suffixFa: '€', persian: false, group: '.', dec: ',' };

export const CURRENCIES: Record<string, Cur> = {
  EUR,
  IRR: { code: 'IRR', minorPerMajor: 1, decimals: 0, labelFa: 'ریال', minorLabelFa: null, suffixFa: 'ریال', persian: true, group: '٬', dec: '٫' },
  IRT: { code: 'IRT', minorPerMajor: 1, decimals: 0, labelFa: 'تومان', minorLabelFa: null, suffixFa: 'تومان', persian: true, group: '٬', dec: '٫' },
  IRT_NEW: { code: 'IRT_NEW', minorPerMajor: 100, decimals: 2, labelFa: 'تومان', minorLabelFa: 'قران', suffixFa: 'تومان', persian: true, group: '٬', dec: '٫' },
};

const FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
export const toFa = (s: string) => s.replace(/[0-9]/g, (d) => FA[Number(d)] ?? d);

export function getCur(code: string): Cur {
  return CURRENCIES[code] ?? EUR;
}

/** Format an integer minor amount for display. */
export function money(minor: number, code: string): string {
  const c = getCur(code);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.trunc(abs / c.minorPerMajor);
  const sub = abs % c.minorPerMajor;
  let out = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, c.group);
  if (c.decimals > 0) out += c.dec + String(sub).padStart(c.decimals, '0');
  if (c.persian) out = toFa(out);
  return `${neg ? '-' : ''}${out} ${c.suffixFa}`;
}

/** Label for the per-unit price input, given the currency. */
export function unitLabel(code: string): string {
  const c = getCur(code);
  return c.minorLabelFa ? `قیمت واحد (${c.minorLabelFa})` : `قیمت واحد (${c.labelFa})`;
}
