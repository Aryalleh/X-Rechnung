import { describe, it, expect } from 'vitest';
import {
  iranTreatment, assertIranSellerIssuable, assertIranBuyerIssuable, isValidIranNationalId,
  isValidEconomicCode, cleanIranIds, iranTaxNote, isIranCurrency,
} from '../src/services/iran-tax';

describe('Iranian tax rules', () => {
  it('only rial/toman currencies are Iranian', () => {
    expect(isIranCurrency('IRT')).toBe(true);
    expect(isIranCurrency('IRR')).toBe(true);
    expect(isIranCurrency('EUR')).toBe(false);
  });

  it('micro business charges no VAT', () => {
    expect(iranTreatment({ iran_tax_status: 'MICRO', iran_vat_rate_bp: 1000 })).toEqual({ mode: 'MICRO', rateBp: 0, invoiceType: null });
    expect(iranTreatment(null).rateBp).toBe(0);
  });

  it('VAT-registered seller charges the configured rate, type 1 by default', () => {
    expect(iranTreatment({ iran_tax_status: 'VAT_REGISTERED', iran_vat_rate_bp: 1000 })).toEqual({ mode: 'VAT', rateBp: 1000, invoiceType: 1 });
    expect(iranTreatment({ iran_tax_status: 'VAT_REGISTERED', iran_vat_rate_bp: 1200 }, 2).invoiceType).toBe(2);
  });

  it('seller needs national ID; VAT-registered also economic code', () => {
    expect(() => assertIranSellerIssuable({ iran_tax_status: 'MICRO' })).toThrow();
    expect(() => assertIranSellerIssuable({ iran_tax_status: 'MICRO', national_id: '0499370899' })).not.toThrow();
    expect(() => assertIranSellerIssuable({ iran_tax_status: 'VAT_REGISTERED', national_id: '0499370899' })).toThrow();
  });

  it('type 1 invoice needs buyer ID + postal code; type 2 / micro only a name', () => {
    const vat1 = iranTreatment({ iran_tax_status: 'VAT_REGISTERED' }, 1);
    const vat2 = iranTreatment({ iran_tax_status: 'VAT_REGISTERED' }, 2);
    const micro = iranTreatment({ iran_tax_status: 'MICRO' });
    const nameOnly = { company_name: 'شرکت نگار' };
    expect(() => assertIranBuyerIssuable(nameOnly, micro)).not.toThrow();
    expect(() => assertIranBuyerIssuable(nameOnly, vat2)).not.toThrow();
    expect(() => assertIranBuyerIssuable(nameOnly, vat1)).toThrow();
    expect(() => assertIranBuyerIssuable({ ...nameOnly, national_id: '10101234567', postal_code: '1234567890' }, vat1)).not.toThrow();
    expect(() => assertIranBuyerIssuable({}, micro)).toThrow();
  });

  it('validates national ID checksum and normalizes Persian digits', () => {
    expect(isValidIranNationalId('0499370899')).toBe(true);
    expect(isValidIranNationalId('0499370898')).toBe(false);
    expect(isValidIranNationalId('1111111111')).toBe(false);
    expect(isValidIranNationalId('10101234567')).toBe(true);
    expect(cleanIranIds({ national_id: '۰۴۹-۹۳۷۰۸۹۹' }).national_id).toBe('0499370899');
    expect(() => cleanIranIds({ national_id: '123' })).toThrow();
    expect(isValidEconomicCode('411111111111')).toBe(true);
    expect(isValidEconomicCode('12345')).toBe(false);
  });

  it('prints a localized tax note', () => {
    expect(iranTaxNote(iranTreatment(null), 'fa')).toContain('کسب‌وکار خرد');
    expect(iranTaxNote(iranTreatment({ iran_tax_status: 'VAT_REGISTERED' }, 2), 'fa')).toContain('نوع دوم');
    expect(iranTaxNote(iranTreatment({ iran_tax_status: 'VAT_REGISTERED' }), 'de')).toContain('Typ 1');
  });
});
