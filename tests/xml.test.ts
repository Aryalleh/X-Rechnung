import { describe, it, expect } from 'vitest';
import { parseXml, textAt, XmlParseError } from '../src/lib/xml';

describe('hardened XML parser', () => {
  it('parses namespaced elements by local name', () => {
    const root = parseXml(`<?xml version="1.0"?><Invoice xmlns:cbc="urn:x"><cbc:ID>RE-1</cbc:ID></Invoice>`);
    expect(root.localName).toBe('Invoice');
    expect(textAt(root, ['ID'])).toBe('RE-1');
  });

  it('decodes predefined + numeric entities only', () => {
    const root = parseXml(`<a>A&amp;B &#65; &#x42;</a>`);
    expect(root.text).toBe('A&B A B');
  });

  it('REJECTS DOCTYPE / DTD (XXE protection)', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>`;
    expect(() => parseXml(evil)).toThrow(XmlParseError);
  });

  it('REJECTS standalone ENTITY declarations', () => {
    expect(() => parseXml(`<!ENTITY x "y"><a/>`)).toThrow(XmlParseError);
  });

  it('does not expand unknown/general entities', () => {
    // &custom; is left literal (never resolved to external content).
    const root = parseXml(`<a>&custom;</a>`);
    expect(root.text).toBe('&custom;');
  });
});
