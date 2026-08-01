/**
 * Format detection for incoming e-invoices.
 *
 * The declared filename/MIME is NEVER trusted on its own — we sniff magic
 * bytes and inspect XML structure. XML is parsed with the hardened parser
 * (no DTD/XXE). A PDF is probed for embedded ZUGFeRD/Factur-X XML.
 */
import type { EInvoiceFormat } from '../../config/constants';
import { parseXml, type XmlNode } from '../../lib/xml';
import { extractEmbeddedXml } from './zugferd';

export interface DetectionResult {
  format: EInvoiceFormat;
  xml?: string;
  xmlRoot?: XmlNode;
  /** true when a structured invoice was found (XRechnung/ZUGFeRD/EN16931). */
  structured: boolean;
  note?: string;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

function looksXml(bytes: Uint8Array): boolean {
  // Skip UTF-8 BOM.
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  // Skip whitespace.
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x3c; // '<'
}

/** Classify a parsed XML root into a concrete e-invoice format. */
export function classifyXml(root: XmlNode): EInvoiceFormat {
  const local = root.localName;
  // Find CustomizationID anywhere near the top for XRechnung detection.
  const customization = findCustomization(root).toLowerCase();
  if (local === 'Invoice') {
    // UBL Invoice
    if (customization.includes('xrechnung')) return 'XRECHNUNG_UBL';
    return 'EN16931_XML';
  }
  if (local === 'CrossIndustryInvoice' || local === 'CrossIndustryDocument') {
    if (customization.includes('xrechnung')) return 'XRECHNUNG_CII';
    return 'EN16931_XML'; // could be ZUGFeRD CII w/o xrechnung customization
  }
  return 'UNKNOWN';
}

function findCustomization(root: XmlNode): string {
  // BFS for a node whose localName is CustomizationID.
  const queue: XmlNode[] = [root];
  while (queue.length) {
    const n = queue.shift()!;
    if (n.localName === 'CustomizationID') return n.text;
    queue.push(...n.children);
  }
  return '';
}

export async function detectFormat(bytes: Uint8Array): Promise<DetectionResult> {
  if (isPdf(bytes)) {
    const xml = await extractEmbeddedXml(bytes);
    if (xml) {
      try {
        const root = parseXml(xml);
        const fmt = classifyXml(root);
        return { format: fmt === 'UNKNOWN' ? 'ZUGFERD' : 'ZUGFERD', xml, xmlRoot: root, structured: true };
      } catch {
        return { format: 'PDF_PLAIN', structured: false, note: 'Embedded XML present but unparseable' };
      }
    }
    return {
      format: 'PDF_PLAIN',
      structured: false,
      note: 'این فایل PDF معمولی است و E-Rechnung ساختاریافته محسوب نمی‌شود.',
    };
  }

  if (looksXml(bytes)) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const root = parseXml(text); // throws on DTD/XXE/malformed
    const fmt = classifyXml(root);
    return { format: fmt, xml: text, xmlRoot: root, structured: fmt !== 'UNKNOWN' };
  }

  return { format: 'UNKNOWN', structured: false, note: 'Unrecognized file type' };
}
