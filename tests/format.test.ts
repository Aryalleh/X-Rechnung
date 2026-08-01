import { describe, it, expect } from 'vitest';
import { formatEuro, formatDateDe, addDays, yearOf } from '../src/lib/format';

describe('German formatting', () => {
  it('formats cents as 1.250,00 €', () => {
    expect(formatEuro(125000)).toBe('1.250,00 €');
    expect(formatEuro(700)).toBe('7,00 €');
    expect(formatEuro(-5000)).toBe('-50,00 €');
    expect(formatEuro(100000000)).toBe('1.000.000,00 €');
  });

  it('formats ISO dates as DD.MM.YYYY', () => {
    expect(formatDateDe('2026-08-01')).toBe('01.08.2026');
    expect(formatDateDe('2026-12-31T10:00:00Z')).toBe('31.12.2026');
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-08-01', 14)).toBe('2026-08-15');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
  });

  it('extracts the year', () => {
    expect(yearOf('2026-08-01')).toBe(2026);
  });
});
