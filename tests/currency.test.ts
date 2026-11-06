import { describe, it, expect } from 'vitest';
import { formatMoney, formatMoneyLatin, toPersianDigits } from '../src/lib/format';
import { oldRialToNewMinor, REDENOMINATION_DEFAULT, RIAL_PER_TOMAN, getCurrency } from '../src/config/currencies';

describe('multi-currency formatting', () => {
  it('formats EUR unchanged (German style)', () => {
    expect(formatMoney(125000, 'EUR')).toBe('1.250,00 €');
  });

  it('formats Rial with Persian digits + separators, no decimals', () => {
    expect(formatMoney(2500000, 'IRR')).toBe('۲٬۵۰۰٬۰۰۰ ریال');
  });

  it('formats Toman with Persian digits', () => {
    expect(formatMoney(250000, 'IRT')).toBe('۲۵۰٬۰۰۰ تومان');
  });

  it('formats the redenominated unit with qeran sub-unit (2 decimals)', () => {
    // 100 qeran = 1 new Toman → 12345 minor = 123.45
    expect(formatMoney(12345, 'IRT_NEW')).toBe('۱۲۳٫۴۵ تومان');
  });

  it('Latin formatter keeps IRR/IRT ASCII for mixed documents', () => {
    expect(formatMoneyLatin(2500000, 'IRR')).toBe('2.500.000 IRR');
    expect(formatMoneyLatin(125000, 'EUR')).toBe('1.250,00 €');
  });

  it('Persian digit mapping (only digits change, separators stay)', () => {
    expect(toPersianDigits('01.08.2026')).toBe('۰۱.۰۸.۲۰۲۶');
  });
});

describe('redenomination (حذف صفر)', () => {
  it('is disabled by default with no effective date', () => {
    expect(REDENOMINATION_DEFAULT.active).toBe(false);
    expect(REDENOMINATION_DEFAULT.effectiveDate).toBeNull();
    expect(REDENOMINATION_DEFAULT.oldRialPerNewUnit).toBe(10000);
  });

  it('converts old Rial to new-unit minor (qeran), half-away-from-zero', () => {
    // 10,000 Rial = 1 new unit = 100 qeran
    expect(oldRialToNewMinor(10000)).toBe(100);
    // 1,000,000 Rial = 100 new units = 10,000 qeran
    expect(oldRialToNewMinor(1_000_000)).toBe(10000);
    // 150 Rial → 1.5 qeran → rounds to 2
    expect(oldRialToNewMinor(150)).toBe(2);
  });

  it('Toman↔Rial ratio constant', () => {
    expect(RIAL_PER_TOMAN).toBe(10);
  });

  it('unknown currency falls back to EUR def', () => {
    expect(getCurrency('ZZZ').code).toBe('EUR');
  });
});

import { convertPrice, marketOf } from '../src/frontend/currency';
describe('template market separation', () => {
  it('maps currencies to markets', () => {
    expect(marketOf('EUR')).toBe('DE');
    expect(marketOf('IRT')).toBe('IR');
    expect(marketOf('IRR')).toBe('IR');
    expect(marketOf('IRT_NEW')).toBe('IR');
  });
  it('converts Iranian template prices between rial, toman and the new unit', () => {
    expect(convertPrice(500_000, 'IRT', 'IRR')).toBe(5_000_000);
    expect(convertPrice(5_000_000, 'IRR', 'IRT')).toBe(500_000);
    expect(convertPrice(500_000, 'IRT', 'IRT_NEW')).toBe(50_000); // 500 000 toman = 5 000 000 rial = 500 new units = 50 000 qeran
  });
  it('never converts EUR', () => {
    expect(convertPrice(20_000, 'EUR', 'IRT')).toBe(20_000);
  });
});
