import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { sha256Hex, canonicalJson, encryptSecret, decryptSecret, bytesToBase64 } from '../src/lib/crypto';

// Provide Web Crypto in the Node test environment.
if (!globalThis.crypto) (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;

describe('crypto', () => {
  it('produces a stable SHA-256 hex', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('canonical JSON is order-independent', () => {
    const a = canonicalJson({ b: 1, a: { d: 4, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 4 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it('content hash changes when data changes', async () => {
    const h1 = await sha256Hex(canonicalJson({ total: 125000 }));
    const h2 = await sha256Hex(canonicalJson({ total: 125001 }));
    expect(h1).not.toBe(h2);
  });

  it('AES-GCM round-trips a secret', async () => {
    const key = bytesToBase64(webcrypto.getRandomValues(new Uint8Array(32)));
    const enc = await encryptSecret('super-secret-api-key', key);
    expect(enc.ciphertext).not.toContain('super-secret');
    const dec = await decryptSecret(enc, key);
    expect(dec).toBe('super-secret-api-key');
  });
});
