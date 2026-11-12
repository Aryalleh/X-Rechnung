import { describe, it, expect } from 'vitest';
import { formatMoneyFor, formatDateFor, toJalali, numberToPersianWords, amountInWordsFa } from '../src/lib/format';
import { buildTaxNote } from '../src/services/tax-note';

describe('money per language × currency', () => {
  it('EUR', () => {
    expect(formatMoneyFor(125000, 'EUR', 'de')).toBe('1.250,00 €');
    expect(formatMoneyFor(125000, 'EUR', 'en')).toBe('€1,250.00');
    expect(formatMoneyFor(125000, 'EUR', 'fa')).toBe('۱٬۲۵۰٫۰۰ یورو');
  });
  it('Toman / Rial / new unit', () => {
    expect(formatMoneyFor(55_000_000, 'IRT', 'de')).toBe('55.000.000 Toman');
    expect(formatMoneyFor(55_000_000, 'IRT', 'en')).toBe('55,000,000 Toman');
    expect(formatMoneyFor(55_000_000, 'IRT', 'fa')).toBe('۵۵٬۰۰۰٬۰۰۰ تومان');
    expect(formatMoneyFor(550_000_000, 'IRR', 'fa')).toBe('۵۵۰٬۰۰۰٬۰۰۰ ریال');
    expect(formatMoneyFor(550055, 'IRT_NEW', 'en')).toBe('5,500.55 Toman');
  });
  it('negative amounts', () => {
    expect(formatMoneyFor(-5000, 'EUR', 'en')).toBe('−€50.00');
  });
});

describe('dates', () => {
  it('Jalali conversion', () => {
    expect(toJalali(2026, 11, 6)).toEqual([1405, 8, 15]);
    expect(toJalali(2026, 3, 21)).toEqual([1405, 1, 1]); // Nowruz 1405
    expect(toJalali(2025, 3, 20)).toEqual([1403, 12, 30]); // leap-year Esfand 30
  });
  it('per language', () => {
    expect(formatDateFor('2026-11-06', 'de')).toBe('06.11.2026');
    expect(formatDateFor('2026-11-06', 'en')).toBe('6 Nov 2026');
    expect(formatDateFor('2026-11-06', 'fa')).toBe('۱۴۰۵/۰۸/۱۵');
  });
});

describe('Persian amount in words', () => {
  it('numbers', () => {
    expect(numberToPersianWords(0)).toBe('صفر');
    expect(numberToPersianWords(1900)).toBe('هزار و نهصد');
    expect(numberToPersianWords(55_000_000)).toBe('پنجاه و پنج میلیون');
    expect(numberToPersianWords(1_000_000)).toBe('یک میلیون');
    expect(numberToPersianWords(312)).toBe('سیصد و دوازده');
  });
  it('amounts with sub-units', () => {
    expect(amountInWordsFa(550055, 'IRT_NEW')).toBe('پنج هزار و پانصد تومان و پنجاه و پنج قران');
    expect(amountInWordsFa(190050, 'EUR')).toBe('هزار و نهصد یورو و پنجاه سنت');
  });
});

describe('tax note per currency × language', () => {
  const de19 = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';
  it('EUR without VAT → § 19 note in every language', () => {
    expect(buildTaxNote({ lang: 'de', iran: null, taxRateBp: 0, germanText: de19 })).toBe(de19);
    expect(buildTaxNote({ lang: 'en', iran: null, taxRateBp: 0 })).toContain('§ 19');
    const fa = buildTaxNote({ lang: 'fa', iran: null, taxRateBp: 0, germanText: de19 });
    expect(fa).toContain('بند ۱۹');
    expect(fa).toContain(de19);
  });
  it('EUR with VAT → no contradictory § 19 note', () => {
    expect(buildTaxNote({ lang: 'de', iran: null, taxRateBp: 1900, germanText: de19 })).toBe('');
  });
  it('Toman → Iranian note, plus public note', () => {
    const n = buildTaxNote({ lang: 'fa', iran: { mode: 'MICRO', rateBp: 0, invoiceType: null }, taxRateBp: 0, publicNote: 'یادداشت' });
    expect(n).toContain('کسب‌وکار خرد');
    expect(n.endsWith('یادداشت')).toBe(true);
  });
});
