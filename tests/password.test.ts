import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, passwordProblem } from '../src/lib/password';

describe('password hashing', () => {
  it('round-trips and rejects wrong passwords', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', h)).toBe(false);
  });
  it('uses a random salt', async () => {
    expect(await hashPassword('same password 123')).not.toBe(await hashPassword('same password 123'));
  });
  it('handles Persian passwords (NFC-normalized)', async () => {
    const h = await hashPassword('رمز عبور بسیار امن ۱۴۰۵');
    expect(await verifyPassword('رمز عبور بسیار امن ۱۴۰۵', h)).toBe(true);
  });
  it('fails closed on missing or malformed hashes', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$999999999$AA==$AA==')).toBe(false);
  });
});

describe('password policy', () => {
  it('enforces length and blocks the e-mail name', () => {
    expect(passwordProblem('short')).toBe('password_too_short');
    expect(passwordProblem('x'.repeat(129))).toBe('password_too_long');
    expect(passwordProblem('mohammad-2026-secure', 'mohammad@example.com')).toBe('password_contains_email');
    expect(passwordProblem('a long and fine passphrase', 'mohammad@example.com')).toBeNull();
  });
});
