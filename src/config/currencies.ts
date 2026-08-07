/**
 * Currency registry + Iranian redenomination plan.
 *
 * All monetary amounts are stored as INTEGER minor units of the invoice's
 * currency (like cents). `minorPerMajor` says how many minor units make one
 * major unit, so the money math in `lib/money.ts` stays currency-agnostic:
 *   EUR : 1 € = 100 cents            (minorPerMajor 100, 2 decimals)
 *   IRR : Rial has no sub-unit       (minorPerMajor 1,   0 decimals)
 *   IRT : Toman (= 10 Rial)          (minorPerMajor 1,   0 decimals)
 *   IRT_NEW : redenominated unit with «قران» sub-unit (configurable)
 *
 * Toman and Rial are modelled as SEPARATE currencies: an invoice created in
 * Toman stores whole Toman, one in Rial stores whole Rial — no lossy in-invoice
 * conversion. Selecting Rial vs Toman is a choice made per invoice.
 */

export type CurrencyCode = 'EUR' | 'IRR' | 'IRT' | 'IRT_NEW';

export interface CurrencyDef {
  code: CurrencyCode;
  /** How many minor units in one major unit (for integer storage). */
  minorPerMajor: number;
  /** Display fraction digits. */
  decimals: number;
  labelFa: string; // e.g. «ریال»
  labelDe: string; // e.g. «Rial»
  /** Sub-unit label, or null when the currency has no sub-unit. */
  minorLabelFa: string | null;
  /** Suffix shown after the amount (fa). */
  suffixFa: string;
  /** Suffix/symbol for the German/Latin template. */
  suffixLatin: string;
  usePersianDigits: boolean;
  groupSeparator: string;
  decimalSeparator: string;
}

const persianGroup = '٬'; // U+066C
const persianDecimal = '٫'; // U+066B

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  EUR: {
    code: 'EUR', minorPerMajor: 100, decimals: 2,
    labelFa: 'یورو', labelDe: 'Euro', minorLabelFa: 'سنت',
    suffixFa: '€', suffixLatin: '€', usePersianDigits: false,
    groupSeparator: '.', decimalSeparator: ',',
  },
  IRR: {
    code: 'IRR', minorPerMajor: 1, decimals: 0,
    labelFa: 'ریال', labelDe: 'Rial', minorLabelFa: null,
    suffixFa: 'ریال', suffixLatin: 'IRR', usePersianDigits: true,
    groupSeparator: persianGroup, decimalSeparator: persianDecimal,
  },
  IRT: {
    code: 'IRT', minorPerMajor: 1, decimals: 0,
    labelFa: 'تومان', labelDe: 'Toman', minorLabelFa: null,
    suffixFa: 'تومان', suffixLatin: 'Toman', usePersianDigits: true,
    groupSeparator: persianGroup, decimalSeparator: persianDecimal,
  },
  // Redenominated national unit ("new Toman"). Sub-unit «قران».
  IRT_NEW: {
    code: 'IRT_NEW', minorPerMajor: 100, decimals: 2,
    labelFa: 'تومان', labelDe: 'New Toman', minorLabelFa: 'قران',
    suffixFa: 'تومان', suffixLatin: 'Toman(new)', usePersianDigits: true,
    groupSeparator: persianGroup, decimalSeparator: persianDecimal,
  },
};

export function getCurrency(code: string): CurrencyDef {
  return CURRENCIES[(code as CurrencyCode)] ?? CURRENCIES.EUR;
}

/**
 * Iranian redenomination ("حذف صفر") plan.
 *
 * The law fixes 1 new unit = 10,000 old Rial, with «قران» as the sub-unit.
 * The exact قران-per-unit ratio and the effective date are NOT finalized, so
 * they are configurable and the whole thing is DISABLED by default. When the
 * central bank sets a date, an admin flips `active` (stored in DB settings,
 * group ARCHIVE/LOCALIZATION) — historical invoices keep their stored currency
 * (immutability is preserved); only new invoices default to the new unit.
 */
export interface RedenominationConfig {
  active: boolean;
  /** 1 new unit = this many old Rial. Fixed by law at 10,000. */
  oldRialPerNewUnit: number;
  /** Sub-unit «قران» per one new unit. Provisional default 100; law TBD. */
  qeranPerNewUnit: number;
  newUnitCode: CurrencyCode;
  subUnitLabelFa: string;
  /** ISO date the redenomination takes effect, or null while unknown. */
  effectiveDate: string | null;
}

export const REDENOMINATION_DEFAULT: RedenominationConfig = {
  active: false,
  oldRialPerNewUnit: 10000,
  qeranPerNewUnit: 100,
  newUnitCode: 'IRT_NEW',
  subUnitLabelFa: 'قران',
  effectiveDate: null,
};

/**
 * Convert an amount of old Rial into the new unit's minor units (قران),
 * rounding half away from zero. Provided for reporting/migration tooling — it
 * is NEVER applied automatically to stored invoices.
 *   qeran = round(rial × qeranPerNewUnit / oldRialPerNewUnit)
 */
export function oldRialToNewMinor(rial: number, cfg: RedenominationConfig = REDENOMINATION_DEFAULT): number {
  const num = BigInt(rial) * BigInt(cfg.qeranPerNewUnit);
  const den = BigInt(cfg.oldRialPerNewUnit);
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return Number(neg ? -rounded : rounded);
}

/** Toman ↔ Rial helper (1 Toman = 10 Rial). */
export const RIAL_PER_TOMAN = 10;
