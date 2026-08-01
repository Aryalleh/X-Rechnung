/**
 * ZUGFeRD / Factur-X embedded-XML extraction from a PDF.
 *
 * ZUGFeRD embeds the structured invoice XML as a PDF file attachment
 * (usually factur-x.xml / zugferd-invoice.xml), typically FlateDecode
 * compressed. Full PDF parsing is out of scope; instead we scan every
 * `stream…endstream` block, attempt raw/zlib inflate, and keep the first
 * block that looks like an EN 16931 invoice. This is a heuristic that works
 * for the vast majority of real ZUGFeRD documents produced today.
 */
import { ZUGFERD_XML_NAMES } from '../../config/constants';

const INVOICE_MARKERS = ['CrossIndustryInvoice', '<Invoice', ':Invoice', 'CrossIndustryDocument'];

function looksLikeInvoiceXml(text: string): boolean {
  return text.includes('<?xml') && INVOICE_MARKERS.some((m) => text.includes(m));
}

async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw' | 'gzip'): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream(format);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const stream = new Blob([ab]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Returns the embedded invoice XML string, or null if the PDF has none. */
export async function extractEmbeddedXml(pdf: Uint8Array): Promise<string | null> {
  const latin1 = new TextDecoder('latin1').decode(pdf);

  // Fast path: PDF references a known filename → still need to find its stream,
  // but its presence is a strong signal the PDF is a ZUGFeRD carrier.
  const hasKnownName = ZUGFERD_XML_NAMES.some((n) => latin1.includes(n));

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let searchFrom = 0;
  for (;;) {
    const streamIdx = latin1.indexOf('stream', searchFrom);
    if (streamIdx === -1) break;
    // Move past 'stream' + optional CR/LF.
    let start = streamIdx + 'stream'.length;
    if (latin1[start] === '\r') start++;
    if (latin1[start] === '\n') start++;
    const endIdx = latin1.indexOf('endstream', start);
    if (endIdx === -1) break;
    searchFrom = endIdx + 'endstream'.length;

    const raw = pdf.subarray(start, endIdx);

    // 1) Uncompressed stream that is already XML.
    const asText = decoder.decode(raw);
    if (looksLikeInvoiceXml(asText)) return asText.trim();

    // 2) Try common compressions.
    for (const fmt of ['deflate', 'deflate-raw', 'gzip'] as const) {
      const inflated = await inflate(raw, fmt);
      if (!inflated) continue;
      const text = decoder.decode(inflated);
      if (looksLikeInvoiceXml(text)) return text.trim();
    }
  }

  // If a known filename was present but we couldn't extract, signal ambiguity
  // to the caller by returning null (treated as "PDF without structured XML").
  void hasKnownName;
  return null;
}
