/**
 * Iranian tax rules for rial/toman invoices (قانون مالیات بر ارزش افزوده +
 * سامانه مؤدیان).
 *
 * - MICRO seller (کسب‌وکار خرد, not VAT-registered): no VAT may be charged;
 *   the invoice states that VAT is not included.
 * - VAT_REGISTERED seller: VAT at the seller's configured rate (default 10%,
 *   the general rate for 1405). Invoices are type 1 (buyer identified by
 *   national ID / economic code → buyer gets VAT credit) or type 2 (consumer,
 *   buyer identity not required).
 *
 * The rate is configurable because it is set yearly by the budget law.
 * This module is pure so it can be unit-tested.
 */
import { AppError } from '../lib/errors';

export const IRAN_CURRENCIES = new Set(['IRR', 'IRT', 'IRT_NEW']);
export const DEFAULT_IRAN_VAT_BP = 1000;

export type IranTaxStatus = 'MICRO' | 'VAT_REGISTERED';
export type IranTaxMode = 'MICRO' | 'VAT';

export function isIranCurrency(currency: string | null | undefined): boolean {
  return IRAN_CURRENCIES.has(currency ?? '');
}

export interface IranSellerTax {
  iran_tax_status?: string | null;
  iran_vat_rate_bp?: number | null;
  national_id?: string | null;
  economic_code?: string | null;
}
export interface IranBuyer {
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  national_id?: string | null;
  economic_code?: string | null;
  postal_code?: string | null;
}

export interface IranTreatment {
  mode: IranTaxMode;
  rateBp: number;
  invoiceType: 1 | 2 | null;
}

/** Decide VAT treatment for an Iranian-currency invoice from the seller profile. */
export function iranTreatment(seller: IranSellerTax | null, requestedType?: number | null): IranTreatment {
  if (seller?.iran_tax_status === 'VAT_REGISTERED') {
    const rate = Number.isFinite(seller.iran_vat_rate_bp) ? Number(seller.iran_vat_rate_bp) : DEFAULT_IRAN_VAT_BP;
    return { mode: 'VAT', rateBp: rate, invoiceType: requestedType === 2 ? 2 : 1 };
  }
  return { mode: 'MICRO', rateBp: 0, invoiceType: null };
}

/** Seller identification required to issue an Iranian invoice. */
export function assertIranSellerIssuable(seller: IranSellerTax): void {
  if (!seller.national_id?.trim()) {
    throw new AppError('SELLER_INCOMPLETE', 'Iranian national ID missing', { national_id: 'iran_national_id_required' });
  }
  if (seller.iran_tax_status === 'VAT_REGISTERED' && !seller.economic_code?.trim()) {
    throw new AppError('SELLER_INCOMPLETE', 'economic code missing', { economic_code: 'iran_economic_code_required' });
  }
}

/** Buyer requirements: name always; type 1 also needs an ID and postal code. */
export function assertIranBuyerIssuable(buyer: IranBuyer, t: IranTreatment): void {
  const hasName = Boolean(buyer.company_name || buyer.last_name || buyer.first_name);
  if (!hasName) throw new AppError('VALIDATION_ERROR', 'buyer name missing', { customer: 'customer_required' });
  if (t.mode === 'VAT' && t.invoiceType === 1) {
    if (!buyer.national_id?.trim() && !buyer.economic_code?.trim()) {
      throw new AppError('VALIDATION_ERROR', 'type 1 needs buyer ID', { customer: 'iran_buyer_id_required' });
    }
    if (!buyer.postal_code?.trim()) {
      throw new AppError('VALIDATION_ERROR', 'type 1 needs buyer postal code', { customer: 'iran_buyer_postal_required' });
    }
  }
}

/** Localized line printed on the invoice for the Iranian tax treatment. */
export function iranTaxNote(t: IranTreatment, lang: 'fa' | 'de' | 'en'): string {
  if (t.mode === 'MICRO') {
    return {
      fa: 'فروشنده در نظام مالیات بر ارزش افزوده ثبت‌نام نشده است (کسب‌وکار خرد)؛ مالیات بر ارزش افزوده در این صورتحساب محاسبه نشده است.',
      de: 'Der Verkäufer ist im iranischen Mehrwertsteuersystem nicht registriert (Kleinstunternehmen); es wird keine Mehrwertsteuer berechnet.',
      en: 'The seller is not registered for Iranian VAT (micro business); no VAT is charged on this invoice.',
    }[lang];
  }
  const type = t.invoiceType === 2
    ? { fa: 'صورتحساب نوع دوم', de: 'Rechnung Typ 2', en: 'Type 2 invoice' }
    : { fa: 'صورتحساب نوع اول', de: 'Rechnung Typ 1', en: 'Type 1 invoice' };
  return {
    fa: `${type.fa} — مالیات بر ارزش افزوده طبق قانون محاسبه و در مبلغ کل منظور شده است.`,
    de: `${type.de} — iranische Mehrwertsteuer gemäß Gesetz berechnet und im Gesamtbetrag enthalten.`,
    en: `${type.en} — Iranian VAT calculated as required by law and included in the total.`,
  }[lang];
}

/**
 * Iranian ID format check: 10-digit کد ملی (with checksum) for persons,
 * 11-digit شناسه ملی for legal entities.
 */
export function isValidIranNationalId(id: string): boolean {
  if (/^\d{11}$/.test(id)) return true;
  if (!/^\d{10}$/.test(id) || /^(\d)\1{9}$/.test(id)) return false;
  const d = id.split('').map(Number);
  const sum = d.slice(0, 9).reduce((s, v, i) => s + v * (10 - i), 0) % 11;
  return d[9] === (sum < 2 ? sum : 11 - sum);
}

/** کد اقتصادی: 10 (person, = national ID), 11 (legal entity), 12 (old) or 14 digits. */
export function isValidEconomicCode(code: string): boolean {
  return /^(\d{10,12}|\d{14})$/.test(code);
}

/** Validate + normalize optional Iranian IDs; throws a field error. */
export function cleanIranIds<T extends { national_id?: string | null; economic_code?: string | null }>(v: T): { national_id: string | null; economic_code: string | null } {
  const national_id = normalizeId(v.national_id);
  const economic_code = normalizeId(v.economic_code);
  if (national_id && !isValidIranNationalId(national_id)) {
    throw new AppError('VALIDATION_ERROR', 'invalid national id', { national_id: 'iran_national_id_invalid' });
  }
  if (economic_code && !isValidEconomicCode(economic_code)) {
    throw new AppError('VALIDATION_ERROR', 'invalid economic code', { economic_code: 'iran_economic_code_invalid' });
  }
  return { national_id, economic_code };
}

/** Normalize Persian/Arabic digits and strip separators from an ID. */
export function normalizeId(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\-–_.]/g, '');
  return s || null;
}
