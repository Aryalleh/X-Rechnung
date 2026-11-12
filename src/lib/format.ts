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

// ───────────────────────── Language-aware invoice formatting ─────────────────────────

export type DocLang = 'de' | 'en' | 'fa';

const SEP: Record<DocLang, { group: string; dec: string }> = {
  de: { group: '.', dec: ',' },
  en: { group: ',', dec: '.' },
  fa: { group: '٬', dec: '٫' },
};
const SYMBOL: Record<string, Record<DocLang, string>> = {
  EUR: { de: '€', en: '€', fa: 'یورو' },
  IRR: { de: 'Rial', en: 'Rial', fa: 'ریال' },
  IRT: { de: 'Toman', en: 'Toman', fa: 'تومان' },
  IRT_NEW: { de: 'Toman', en: 'Toman', fa: 'تومان' },
};

/**
 * Money in the invoice LANGUAGE's conventions, for any currency:
 *   de 1.250,00 €  ·  en €1,250.00  ·  fa ۱٬۲۵۰٫۰۰ یورو
 *   de 50.000.000 Toman  ·  en 50,000,000 Toman  ·  fa ۵۰٬۰۰۰٬۰۰۰ تومان
 */
export function formatMoneyFor(minorAmount: number, code: string, lang: DocLang): string {
  const c = getCurrency(code);
  const { group, dec } = SEP[lang];
  const abs = Math.abs(minorAmount);
  let n = Math.trunc(abs / c.minorPerMajor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  if (c.decimals > 0) n += dec + String(abs % c.minorPerMajor).padStart(c.decimals, '0');
  if (lang === 'fa') n = toPersianDigits(n);
  const sign = minorAmount < 0 ? '−' : '';
  const sym = (SYMBOL[c.code] ?? SYMBOL.EUR!)[lang];
  return lang === 'en' && c.code === 'EUR' ? `${sign}${sym}${n}` : `${sign}${n} ${sym}`;
}

/** Gregorian → Jalali (Solar Hijri), exact arithmetic algorithm (no ICU dependency). */
export function toJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1]!;
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Date in the invoice language's convention:
 *   de 05.11.2026  ·  en 5 Nov 2026  ·  fa ۱۴۰۵/۰۸/۱۴ (Shamsi, as on Iranian invoices)
 */
export function formatDateFor(iso: string | null | undefined, lang: DocLang): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (lang === 'de') return `${m[3]}.${m[2]}.${m[1]}`;
  if (lang === 'en') return `${d} ${EN_MONTHS[mo - 1]} ${y}`;
  const [jy, jm, jd] = toJalali(y, mo, d);
  return toPersianDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

// Persian number words (for «مبلغ به حروف» on Iranian invoices).
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون', 'کوادریلیون'];

function threeDigitsFa(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (r >= 10 && r < 20) parts.push(TEENS[r - 10]!);
  else {
    if (Math.floor(r / 10)) parts.push(TENS[Math.floor(r / 10)]!);
    if (r % 10) parts.push(ONES[r % 10]!);
  }
  return parts.join(' و ');
}

/** 5500000 → «پنج میلیون و پانصد هزار». Integers up to 10^18. */
export function numberToPersianWords(n: number | bigint): string {
  let v = BigInt(n);
  if (v === 0n) return 'صفر';
  const neg = v < 0n;
  if (neg) v = -v;
  const groups: string[] = [];
  let i = 0;
  while (v > 0n) {
    const chunk = Number(v % 1000n);
    // Persian says «هزار», not «یک هزار»; larger scales keep «یک» (یک میلیون).
    if (chunk) groups.unshift(i === 1 && chunk === 1 ? 'هزار' : `${threeDigitsFa(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
    v /= 1000n;
    i++;
  }
  return `${neg ? 'منفی ' : ''}${groups.join(' و ')}`;
}

/** «مبلغ به حروف»: whole units + sub-units, e.g. «پنج میلیون تومان و پنجاه قران». */
export function amountInWordsFa(minorAmount: number, code: string): string {
  const c = getCurrency(code);
  const sym = (SYMBOL[c.code] ?? SYMBOL.EUR!).fa;
  const abs = Math.abs(minorAmount);
  const major = Math.trunc(abs / c.minorPerMajor);
  const minor = abs % c.minorPerMajor;
  const sub = c.code === 'EUR' ? 'سنت' : c.minorLabelFa;
  let out = `${numberToPersianWords(major)} ${sym}`;
  if (minor && sub) out += ` و ${numberToPersianWords(minor)} ${sub}`;
  return minorAmount < 0 ? `منفی ${out}` : out;
}
