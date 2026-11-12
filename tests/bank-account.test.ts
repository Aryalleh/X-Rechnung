import { describe, it, expect } from 'vitest';
import { isValidShaba, normalizeShaba, sellerProfileSchema } from '../src/lib/schemas';
import { bankLines, groupAccount, renderInvoiceHtml, type TemplateData } from '../src/services/pdf/template';

const SHABA = 'IR062960000000100324200001';
const IBAN = 'DE89370400440532013000';

describe('Sheba (شبا)', () => {
  it('accepts a valid Sheba, with Persian digits, spaces or without the IR prefix', () => {
    expect(isValidShaba(SHABA)).toBe(true);
    expect(normalizeShaba('IR06 2960 0000 0010 0324 2000 01')).toBe(SHABA);
    expect(normalizeShaba('۰۶۲۹۶۰۰۰۰۰۰۰۱۰۰۳۲۴۲۰۰۰۰۱')).toBe(SHABA);
  });
  it('rejects a wrong checksum or a non-Iranian IBAN', () => {
    expect(isValidShaba('IR072960000000100324200001')).toBe(false);
    expect(isValidShaba(IBAN)).toBe(false);
  });
});

describe('seller schema bank accounts', () => {
  const base = {
    full_name: 'A', job_title: 'B', street: 'S', postal_code: '1', city: 'C', email: 'a@b.de', steuernummer: '1',
  };
  it('requires at least one of IBAN or Sheba', () => {
    expect(sellerProfileSchema.safeParse(base).success).toBe(false);
    expect(sellerProfileSchema.safeParse({ ...base, iban: IBAN }).success).toBe(true);
    expect(sellerProfileSchema.safeParse({ ...base, shaba: SHABA }).success).toBe(true);
  });
  it('treats NULL columns from the DB as unset', () => {
    expect(sellerProfileSchema.safeParse({ ...base, iban: IBAN, shaba: null, bic: null, iran_card_number: null }).success).toBe(true);
  });
});

describe('invoice bank block follows the currency', () => {
  const seller = { full_name: 'Max', iban: IBAN, bic: 'COBADEFFXXX', bank_name: 'Commerzbank', shaba: SHABA, iran_bank_name: 'ملت', iran_card_number: '6104337812345678' };
  it('EUR → German IBAN only', () => {
    const keys = bankLines(seller, false).map((l) => l.key);
    expect(keys).toEqual(['holder', 'bank', 'iban', 'bic']);
  });
  it('IRR/IRT → Sheba + card only', () => {
    const lines = bankLines(seller, true);
    expect(lines.map((l) => l.key)).toEqual(['holder', 'bank', 'shaba', 'card']);
    expect(lines.find((l) => l.key === 'shaba')!.value).toBe(groupAccount(SHABA));
  });
  it('never falls back to the German IBAN on a toman invoice', () => {
    expect(bankLines({ ...seller, shaba: null }, true)).toEqual([]);
  });

  const data = (currency: string, language: 'de' | 'fa'): TemplateData => ({
    invoiceNumber: 'RE-1', documentType: 'RECHNUNG', invoiceDate: '2026-11-05', dueDate: '2026-11-19',
    serviceDate: null, servicePeriodStart: null, servicePeriodEnd: null, currency, seller, customer: { company_name: 'X' },
    customerCode: 'K1', projectNumber: null, projectName: null, buyerReference: null, orderReference: null,
    items: [{ position: 1, description: 'x', quantity: '1', unit: 'Stunde', unitPriceCents: 100, discountCents: 0, lineTotalCents: 100, rightsText: null }],
    totalCents: 100, taxExemptionText: '', paymentTermsText: null, thanksText: null, showBank: true, draft: false, language,
  });
  it('renders IBAN on EUR and Sheba on IRT invoices', () => {
    const eur = renderInvoiceHtml(data('EUR', 'de'));
    expect(eur).toContain('DE89 3704 0044 0532 0130 00');
    expect(eur).not.toContain('IR06');
    const irt = renderInvoiceHtml(data('IRT', 'fa'));
    expect(irt).toContain('IR06 2960 0000 0010 0324 2000 01');
    expect(irt).not.toContain('DE89');
  });
});
