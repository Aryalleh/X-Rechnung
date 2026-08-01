/** Web Crypto helpers: SHA-256, AES-GCM secret storage, canonical JSON. */

const enc = new TextEncoder();

/** Copy into a fresh ArrayBuffer so Web Crypto sees a concrete BufferSource
 * (avoids TS 5.7's Uint8Array<ArrayBufferLike> vs ArrayBuffer friction). */
export function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(b.byteLength);
  new Uint8Array(ab).set(b);
  return ab;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** SHA-256 hex of a string or bytes. */
export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === 'string'
      ? enc.encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return bytesToHex(new Uint8Array(digest));
}

/** Constant-time string comparison (for token-hash checks). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Deterministic canonical JSON: object keys sorted recursively so that the
 * SHA-256 content hash of an invoice is stable regardless of property order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = sortValue(obj[key]);
    return sorted;
  }
  return value;
}

async function importAesKey(rawKeyBase64: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(rawKeyBase64);
  if (keyBytes.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)');
  }
  return crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  version: number;
}

/** AES-GCM encrypt a plaintext secret with a fresh random IV. */
export async function encryptSecret(plaintext: string, keyBase64: string): Promise<EncryptedSecret> {
  const key = await importAesKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, toArrayBuffer(enc.encode(plaintext)));
  return {
    ciphertext: bytesToBase64(new Uint8Array(ct)),
    iv: bytesToBase64(iv),
    version: 1,
  };
}

export async function decryptSecret(secret: EncryptedSecret, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64);
  const iv = toArrayBuffer(base64ToBytes(secret.iv));
  const ct = base64ToBytes(secret.ciphertext);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, toArrayBuffer(ct));
  return new TextDecoder().decode(pt);
}
