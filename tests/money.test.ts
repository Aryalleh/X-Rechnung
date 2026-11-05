import { describe, it, expect } from 'vitest';
import { lineTotalCents, computeTotals, computeDocumentTotals, euroStringToCents, parseQuantity } from '../src/lib/money';

describe('document totals — discount, VAT, advance, installments', () => {
  const lines = [{ quantity: '10', unitPriceCents: 10000 }]; // 1.000,00

  it('percent discount + VAT + advance → amount due', () => {
    const d = computeDocumentTotals({ lines, discountMode: 'PERCENT', discountValue: 1000, taxRateBp: 1900, advancePaidCents: 20000 });
    expect(d.lineSubtotalCents).toBe(100000);
    expect(d.discountCents).toBe(10000);   // 10%
    expect(d.netCents).toBe(90000);
    expect(d.taxCents).toBe(17100);         // 19% of 90.000
    expect(d.totalCents).toBe(107100);
    expect(d.advancePaidCents).toBe(20000);
    expect(d.amountDueCents).toBe(87100);
  });

  it('fixed discount is capped at the subtotal', () => {
    const d = computeDocumentTotals({ lines, discountMode: 'FIXED', discountValue: 999999 });
    expect(d.discountCents).toBe(100000);
    expect(d.netCents).toBe(0);
    expect(d.totalCents).toBe(0);
  });

  it('Kleinunternehmer (no discount, no VAT) keeps total = subtotal', () => {
    const d = computeDocumentTotals({ lines });
    expect(d.totalCents).toBe(100000);
    expect(d.taxCents).toBe(0);
    expect(d.amountDueCents).toBe(100000);
  });

  it('Iranian 10% VAT (1000 bp)', () => {
    const d = computeDocumentTotals({ lines: [{ quantity: '1', unitPriceCents: 5000000 }], taxRateBp: 1000 });
    expect(d.taxCents).toBe(500000);
    expect(d.totalCents).toBe(5500000);
  });
});

describe('money — integer cents, no floats', () => {
  it('multiplies whole quantity by unit price', () => {
    expect(lineTotalCents('6', 10000)).toBe(60000); // 6 × 100,00 € = 600,00 €
  });

  it('handles decimal quantity via BigInt (no float error)', () => {
    // 0.1 + 0.2 float trap: 3 × 0.1 handled exactly.
    expect(lineTotalCents('1.5', 10000)).toBe(15000);
    expect(lineTotalCents('2,5', 8000)).toBe(20000); // comma separator
  });

  it('rounds half away from zero at the cent boundary', () => {
    // 3 × 33,33 € with a 0.005 fractional cent: 1.333 * 100? use qty 0.333
    expect(lineTotalCents('0.333', 100000)).toBe(33300); // 0.333 × 1000,00 = 333,00
    expect(lineTotalCents('1.005', 10000)).toBe(10050); // rounds 10050
  });

  it('applies absolute-cent discount after multiplication', () => {
    expect(lineTotalCents('2', 10000, 500)).toBe(19500); // 200,00 − 5,00
  });

  it('computes the seed invoice total to 1.250,00 €', () => {
    const totals = computeTotals([
      { quantity: '1', unitPriceCents: 20000 }, // Konzeption 200,00
      { quantity: '6', unitPriceCents: 10000 }, // Videodreh 6h × 100,00 = 600,00
      { quantity: '1', unitPriceCents: 30000 }, // Schnitt/Post 300,00
      { quantity: '1', unitPriceCents: 15000 }, // Nutzungsrechte 150,00
    ]);
    expect(totals.totalCents).toBe(125000); // 1.250,00 €
    expect(totals.subtotalCents).toBe(125000);
  });

  it('parses EUR strings in both German and plain formats', () => {
    expect(euroStringToCents('1.250,00')).toBe(125000);
    expect(euroStringToCents('1250.00')).toBe(125000);
    expect(euroStringToCents('7,00 €')).toBe(700);
  });

  it('parses quantities exactly', () => {
    expect(parseQuantity('1.5')).toEqual({ mantissa: 15n, scale: 1, negative: false });
    expect(parseQuantity('-2')).toEqual({ mantissa: 2n, scale: 0, negative: true });
  });

  it('rejects invalid quantity', () => {
    expect(() => lineTotalCents('abc', 100)).toThrow();
  });

  it('rejects non-integer cent unit prices', () => {
    expect(() => lineTotalCents('1', 100.5)).toThrow();
  });
});
