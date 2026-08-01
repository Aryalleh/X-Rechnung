/** Magic-byte / signature checks — declared MIME and filename are never trusted. */
import { FILE_SIGNATURES } from '../config/constants';

export interface SniffResult {
  ok: boolean;
  detected: 'pdf' | 'xml' | 'zip' | 'png' | 'jpeg' | 'unknown';
}

export function sniff(bytes: Uint8Array): SniffResult {
  const startsWith = (sig: number[]): boolean => sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { ok: true, detected: 'pdf' };
  if (startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06])) return { ok: true, detected: 'zip' };
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return { ok: true, detected: 'png' };
  if (startsWith([0xff, 0xd8, 0xff])) return { ok: true, detected: 'jpeg' };
  // XML: allow BOM + leading whitespace before '<'.
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] === 0x3c) return { ok: true, detected: 'xml' };
  return { ok: false, detected: 'unknown' };
}

/** Validate declared MIME is consistent with an allowed signature. */
export function validateUpload(bytes: Uint8Array, declaredMime: string): boolean {
  const sigs = FILE_SIGNATURES[declaredMime];
  if (sigs === undefined) return false; // MIME not allowed at all
  if (sigs.length === 0) return true; // e.g. message/rfc822 — no reliable magic
  return sigs.some((sig) => sig.every((b, i) => bytes[i] === b));
}
