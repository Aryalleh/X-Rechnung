import { describe, it, expect } from 'vitest';
import {
  customVariables, extractVariables, missingFields, missingVariables, parseBlocks, parseFields, renderBlocksHtml, standardVariables, substitute,
} from '../src/lib/contract-doc';

const body = `# Vertrag
zwischen {{seller_name}} und {{customer_name}}.

## 1. Vergütung
Honorar: {{honorar}}. Drehort: [[Drehort]], Termin: [[Termin:date]].
- Stunden: [[Stunden:number]]
[[Ich stimme zu:checkbox]]`;

describe('contract template parsing', () => {
  it('finds variables and separates custom ones', () => {
    expect(extractVariables(body)).toEqual(['seller_name', 'customer_name', 'honorar']);
    expect(customVariables(body)).toEqual(['honorar']);
  });
  it('parses customer fields with types; checkbox optional', () => {
    expect(parseFields(body)).toEqual([
      { key: 'f1', label: 'Drehort', type: 'text', required: true },
      { key: 'f2', label: 'Termin', type: 'date', required: true },
      { key: 'f3', label: 'Stunden', type: 'number', required: true },
      { key: 'f4', label: 'Ich stimme zu', type: 'checkbox', required: false },
    ]);
  });
  it('keeps colons in labels that are not a type', () => {
    expect(parseFields('[[Zeit: von – bis]]')[0]).toMatchObject({ label: 'Zeit: von – bis', type: 'text' });
  });
  it('block field numbering matches parseFields', () => {
    const keys = parseBlocks(body).flatMap((b) => b.lines.flat()).filter((p) => p.kind === 'field').map((p) => (p as { field: { key: string } }).field.key);
    expect(keys).toEqual(['f1', 'f2', 'f3', 'f4']);
  });
  it('substitutes values, leaves missing visible, and strips template syntax from values', () => {
    const out = substitute(body, { seller_name: 'A', customer_name: 'B [[x]]', honorar: '' });
    expect(out).toContain('zwischen A und B x.');
    expect(out).toContain('{{honorar}}');
    expect(missingVariables(body, { seller_name: 'A', customer_name: 'B' })).toEqual(['honorar']);
  });
  it('validates required customer fields', () => {
    const f = parseFields(body);
    expect(missingFields(f, { f1: 'Berlin', f2: '2026-12-01' })).toEqual(['Stunden']);
    expect(missingFields(f, { f1: 'Berlin', f2: '2026-12-01', f3: '8' })).toEqual([]);
  });
  it('renders escaped HTML (no injection from contract text or values)', () => {
    const html = renderBlocksHtml(parseBlocks('<script>x</script> [[Name]]'), { values: { f1: '<img onerror=1>' } });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img onerror=1&gt;');
  });
  it('standard variables from parties, localized date', () => {
    const v = standardVariables({
      seller: { full_name: 'Max', business_name: 'Studio', street: 'Weg 1', postal_code: '10115', city: 'Berlin', country: 'DE' },
      customer: { company_name: 'ACME', street: 'Str 2', postal_code: '1', city: 'Wien', country: 'AT' },
      lang: 'fa', number: 'VT-2026-0001', title: 'T', today: '2026-11-06',
    });
    expect(v.seller_name).toBe('Max · Studio');
    expect(v.customer_address).toBe('Str 2, 1 Wien, AT');
    expect(v.today).toBe('۱۴۰۵/۰۸/۱۵');
  });
});
