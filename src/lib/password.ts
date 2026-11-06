/**
 * Password hashing with PBKDF2-SHA256 (Web Crypto, available in Workers and
 * Node). 100 000 iterations is the maximum the Workers runtime allows.
 * Stored format: "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>".
 */
import { base64ToBytes, bytesToBase64, timingSafeEqual, toArrayBuffer } from './crypto';

const ITERATIONS = 100_000;
const KEY_BITS = 256;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(password.normalize('NFC'))), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, iter, saltB64, hashB64] = stored.split('$');
  const iterations = Number(iter);
  if (algo !== 'pbkdf2-sha256' || !saltB64 || !hashB64 || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  const hash = await derive(password, base64ToBytes(saltB64), iterations);
  return timingSafeEqual(bytesToBase64(hash), hashB64);
}

/** Server-side policy check; returns an i18n error key or null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return 'password_too_short';
  if (password.length > PASSWORD_MAX) return 'password_too_long';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) return 'password_contains_email';
  return null;
}
