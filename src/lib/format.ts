/** German (de-DE) + Persian (fa-IR) formatting for amounts and dates. No external deps. */
import { getCurrency } from '../config/currencies';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Map ASCII digits to Persian digits. */
export function toPersianDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]!);
}

/**
 * Format an integer minor amount in ANY registered currency (EUR, IRR/Rial,
 * IRT/Toman, IRT_NEW). Storage stays integer; formatting uses per-currency
 * separators, decimals, sub-unit and (for fa) Persian digits.
 *   formatMoney(125000, 'EUR')  -> "1.250,00 €"
 *   formatMoney(2500000, 'IRR') -> "۲٬۵۰۰٬۰۰۰ ریال"
 *   formatMoney(250000, 'IRT')  -> "۲۵۰٬۰۰۰ تومان"
 */
export function formatMoney(minorAmount: number, code: string, opts: { withSuffix?: boolean } = {}): string {
  const c = getCurrency(code);
  const negative = minorAmount < 0;
  const abs = Math.abs(minorAmount);
  const major = Math.trunc(abs / c.minorPerMajor);
  const minor = abs % c.minorPerMajor;

  let digits = groupWith(major.toString(), c.groupSeparator);
  if (c.decimals > 0) {
    const minorStr = String(minor).padStart(c.decimals, '0').slice(0, c.decimals);
    digits += c.decimalSeparator + minorStr;
  }
  if (c.usePersianDigits) digits = toPersianDigits(digits);
  const sign = negative ? '-' : '';
  const suffix = opts.withSuffix === false ? '' : ` ${c.suffixFa}`;
  return `${sign}${digits}${suffix}`.trim();
}

/** Latin-script money for the German invoice template (EUR etc.). */
export function formatMoneyLatin(minorAmount: number, code: string): string {
  const c = getCurrency(code);
  if (code === 'EUR') return formatEuro(minorAmount);
  const negative = minorAmount < 0;
  const abs = Math.abs(minorAmount);
  const major = Math.trunc(abs / c.minorPerMajor);
  const minor = abs % c.minorPerMajor;
  let digits = groupWith(major.toString(), '.');
  if (c.decimals > 0) digits += ',' + String(minor).padStart(c.decimals, '0');
  return `${negative ? '-' : ''}${digits} ${c.suffixLatin}`.trim();
}

function groupWith(digits: string, sep: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}


/** 125000 cents -> "1.250,00 €" */
export function formatEuro(cents: number, currency = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : currency;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  const eurosStr = groupThousands(euros.toString());
  const restStr = rest.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${eurosStr},${restStr} ${symbol}`.trim();
}

/** 125000 -> "1.250,00" (no symbol) */
export function formatAmount(cents: number): string {
  return formatEuro(cents, '').trim();
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** ISO date/datetime "2026-08-01..." -> "01.08.2026" */
export function formatDateDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const datePart = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Today's date in Europe/Berlin as YYYY-MM-DD. */
export function berlinToday(now: Date = new Date()): string {
  // en-CA yields ISO-like YYYY-MM-DD; timeZone shifts to Berlin wall clock.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Add N days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Year (number) of a YYYY-MM-DD date. */
export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}
