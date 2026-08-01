import { describe, it, expect } from 'vitest';
import { enforceTaxScenario } from '../src/services/invoice-service';
import { formatInvoiceNumber, formatCustomerCode } from '../src/lib/ids';
import { buildZip } from '../src/lib/zip';
import { sniff, validateUpload } from '../src/lib/file-signature';

describe('Kleinunternehmer §19 rules', () => {
  it('rejects stray VAT fields in KLEINUNTERNEHMER_DE mode', () => {
    const withVat = { tax_scenario: 'KLEINUNTERNEHMER_DE', vat_rate: 19, items: [] } as never;
    expect(() => enforceTaxScenario(withVat)).toThrow();
  });
  it('accepts a clean Kleinunternehmer draft', () => {
    const clean = { tax_scenario: 'KLEINUNTERNEHMER_DE', items: [] } as never;
    expect(() => enforceTaxScenario(clean)).not.toThrow();
  });
});

describe('numbering formats', () => {
  it('formats invoice numbers per year with padding', () => {
    expect(formatInvoiceNumber('RE', 2026, 1)).toBe('RE-2026-000001');
    expect(formatInvoiceNumber('ST', 2026, 123)).toBe('ST-2026-000123');
    expect(formatInvoiceNumber('GS', 2027, 1)).toBe('GS-2027-000001');
  });
  it('formats customer codes', () => {
    expect(formatCustomerCode(1)).toBe('KD-0001');
    expect(formatCustomerCode(21)).toBe('KD-0021');
  });
});

describe('ZIP writer', () => {
  it('produces a valid local-file + EOCD signature', () => {
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
    // Local file header magic PK\x03\x04
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End of central directory magic PK\x05\x06 near the end
    const tail = zip.subarray(zip.length - 22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});

describe('file signature sniffing (never trust MIME)', () => {
  it('detects PDF / XML and rejects unknown', () => {
    expect(sniff(new Uint8Array([0x25, 0x50, 0x44, 0x46])).detected).toBe('pdf');
    expect(sniff(new TextEncoder().encode('  <?xml')).detected).toBe('xml');
    expect(sniff(new Uint8Array([0x00, 0x01])).ok).toBe(false);
  });
  it('validateUpload requires signature to match declared MIME', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(validateUpload(pdf, 'application/pdf')).toBe(true);
    expect(validateUpload(pdf, 'application/xml')).toBe(false);
    expect(validateUpload(pdf, 'application/x-evil')).toBe(false); // MIME not allowed
  });
});
