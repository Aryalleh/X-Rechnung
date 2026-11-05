/** ID and token generation. */

/** Prefixed UUID id, e.g. newId('inv') -> 'inv_9f8c...'. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** URL-safe random token (default 32 bytes -> ~43 chars base64url). */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Next customer code from a numeric sequence, e.g. 1 -> "KD-0001". */
export function formatCustomerCode(n: number, prefix = 'KD', digits = 4): string {
  return `${prefix}-${String(n).padStart(digits, '0')}`;
}

/** Invoice number: RE-2026-000001 */
export function formatInvoiceNumber(prefix: string, year: number, seq: number, digits = 6): string {
  return `${prefix}-${year}-${String(seq).padStart(digits, '0')}`;
}

/** Config version code: CONFIG-2026-000001 */
export function formatConfigVersion(year: number, seq: number): string {
  return `CONFIG-${year}-${String(seq).padStart(6, '0')}`;
}
