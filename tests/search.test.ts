import { describe, it, expect } from 'vitest';
import { normalizeText, rankCustomers, editDistance, scoreCustomer } from '../src/lib/search';

const rows = [
  { customer_code: 'KD-0001', company_name: 'Muster GmbH', city: 'Berlin', email: 'info@muster.de', is_active: 1 },
  { customer_code: 'KD-0012', company_name: 'Müller Medien', city: 'München', email: 'hallo@mueller.de', is_active: 1 },
  { customer_code: 'KD-0003', first_name: 'Anna', last_name: 'Schmidt', city: 'Hamburg', phone: '+49 170 1234567', is_active: 1 },
  { customer_code: 'KD-0004', company_name: 'شرکت نگار', city: 'تهران', is_active: 1 },
  { customer_code: 'KD-0005', company_name: 'Alt GmbH', city: 'Köln', is_active: 0 },
];
const codes = (q: string) => rankCustomers(q, rows).map((r) => r.customer_code);

describe('normalizeText', () => {
  it('folds German diacritics and ß', () => {
    expect(normalizeText('Müller Straße')).toBe('muller strasse');
  });
  it('unifies Arabic/Persian letters and digits', () => {
    expect(normalizeText('كيان ۱۲۳ ٤')).toBe('کیان 123 4');
  });
});

describe('editDistance', () => {
  it('counts transpositions as one edit', () => {
    expect(editDistance('smtih', 'smith')).toBe(1);
  });
});

describe('rankCustomers', () => {
  it('matches loose numeric codes', () => {
    expect(codes('12')[0]).toBe('KD-0012');
    expect(codes('kd12')[0]).toBe('KD-0012');
    expect(codes('KD-0001')[0]).toBe('KD-0001');
  });
  it('finds umlaut names without umlauts', () => {
    expect(codes('muller')).toContain('KD-0012');
  });
  it('tolerates a typo', () => {
    expect(codes('Schmdit')).toContain('KD-0003');
  });
  it('ANDs multiple words across fields', () => {
    expect(codes('anna hamburg')).toEqual(['KD-0003']);
    expect(codes('anna berlin')).toEqual([]);
  });
  it('searches Persian with Arabic keyboard variants', () => {
    expect(codes('نگار')).toEqual(['KD-0004']);
    expect(codes('تهران')).toEqual(['KD-0004']);
  });
  it('matches phone fragments', () => {
    expect(codes('1234567')).toContain('KD-0003');
  });
  it('ranks inactive customers lower', () => {
    expect(scoreCustomer('gmbh', rows[4]!)!).toBeGreaterThan(scoreCustomer('gmbh', rows[0]!)!);
  });
});
