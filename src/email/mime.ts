/**
 * Minimal MIME parser for inbound e-invoice emails.
 *
 * Extracts headers and attachment parts (multipart/*), decoding base64 and
 * quoted-printable. This is intentionally small and defensive — it never
 * executes or interprets content, only slices bytes and decodes transfer
 * encodings.
 */

export interface MimePart {
  headers: Record<string, string>;
  contentType: string;
  filename: string | null;
  disposition: string | null;
  body: Uint8Array;
}

export interface ParsedEmail {
  headers: Record<string, string>;
  from: string | null;
  to: string | null;
  subject: string | null;
  messageId: string | null;
  parts: MimePart[];
}

const decoder = new TextDecoder('latin1');

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function splitHeaderBody(bytes: Uint8Array): { header: string; bodyStart: number } {
  const sep = new TextEncoder().encode('\r\n\r\n');
  let idx = indexOfSequence(bytes, sep, 0);
  let sepLen = 4;
  if (idx === -1) {
    const sep2 = new TextEncoder().encode('\n\n');
    idx = indexOfSequence(bytes, sep2, 0);
    sepLen = 2;
  }
  if (idx === -1) return { header: decoder.decode(bytes), bodyStart: bytes.length };
  return { header: decoder.decode(bytes.subarray(0, idx)), bodyStart: idx + sepLen };
}

function parseHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // Unfold continuation lines.
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    headers[key] = line.slice(idx + 1).trim();
  }
  return headers;
}

function getParam(headerValue: string, param: string): string | null {
  const re = new RegExp(`${param}\\s*=\\s*"?([^";]+)"?`, 'i');
  const m = re.exec(headerValue);
  return m ? m[1]!.trim() : null;
}

function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeQuotedPrintable(input: string): Uint8Array {
  const text = input.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '=' && i + 2 < text.length) {
      out.push(parseInt(text.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(text.charCodeAt(i));
    }
  }
  return new Uint8Array(out);
}

function decodeBody(headers: Record<string, string>, raw: Uint8Array): Uint8Array {
  const cte = (headers['content-transfer-encoding'] ?? '').toLowerCase();
  const text = decoder.decode(raw);
  if (cte === 'base64') return decodeBase64(text);
  if (cte === 'quoted-printable') return decodeQuotedPrintable(text);
  return raw;
}

function parsePart(bytes: Uint8Array): MimePart[] {
  const { header, bodyStart } = splitHeaderBody(bytes);
  const headers = parseHeaders(header);
  const contentType = (headers['content-type'] ?? 'text/plain').toLowerCase();
  const body = bytes.subarray(bodyStart);

  if (contentType.startsWith('multipart/')) {
    const boundary = getParam(headers['content-type'] ?? '', 'boundary');
    if (!boundary) return [];
    const parts: MimePart[] = [];
    const delimiter = new TextEncoder().encode(`--${boundary}`);
    let pos = indexOfSequence(body, delimiter, 0);
    while (pos !== -1) {
      let start = pos + delimiter.length;
      // End boundary "--"?
      if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
      if (body[start] === 0x0d) start++;
      if (body[start] === 0x0a) start++;
      const next = indexOfSequence(body, delimiter, start);
      const end = next === -1 ? body.length : next;
      const sub = body.subarray(start, end);
      parts.push(...parsePart(sub));
      pos = next;
    }
    return parts;
  }

  const cd = headers['content-disposition'] ?? '';
  const filename = getParam(cd, 'filename') ?? getParam(headers['content-type'] ?? '', 'name');
  return [{
    headers,
    contentType: contentType.split(';')[0]!.trim(),
    filename,
    disposition: cd.split(';')[0]!.trim() || null,
    body: decodeBody(headers, body),
  }];
}

export function parseEmail(raw: Uint8Array): ParsedEmail {
  const { header } = splitHeaderBody(raw);
  const headers = parseHeaders(header);
  return {
    headers,
    from: headers['from'] ?? null,
    to: headers['to'] ?? null,
    subject: decodeMimeWord(headers['subject'] ?? null),
    messageId: headers['message-id'] ?? null,
    parts: parsePart(raw),
  };
}

/** Decode RFC 2047 encoded-words in a header (basic UTF-8 B/Q support). */
function decodeMimeWord(value: string | null): string | null {
  if (!value) return value;
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _charset, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === 'B'
        ? decodeBase64(data)
        : decodeQuotedPrintable(String(data).replace(/_/g, ' '));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return data;
    }
  });
}
