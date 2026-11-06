#!/usr/bin/env node
/**
 * Set (or reset) an admin user's login password directly in D1.
 *
 *   node scripts/set-password.mjs <email> [--local]
 *
 * The password is read from a hidden prompt (never from argv, so it does not
 * end up in shell history), hashed locally with the same PBKDF2 format the
 * Worker uses, and only the hash is written. Also clears any login lockout and
 * signs the user out of existing sessions.
 */
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import readline from 'node:readline';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const target = args.includes('--local') ? '--local' : '--remote';
if (!email || !/^[^@\s'"]+@[^@\s'"]+\.[^@\s'"]+$/.test(email)) {
  console.error('Usage: node scripts/set-password.mjs <email> [--local]');
  process.exit(1);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // hide typed chars
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const pw1 = await ask('New password: ');
const pw2 = await ask('Repeat password: ');
if (pw1 !== pw2) { console.error('Passwords do not match.'); process.exit(1); }
if (pw1.length < 10 || pw1.length > 128) { console.error('Password must be 10–128 characters.'); process.exit(1); }

const ITER = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw1.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
const b64 = (u) => Buffer.from(u).toString('base64');
const hash = `pbkdf2-sha256$${ITER}$${b64(salt)}$${b64(bits)}`;

const e = email.toLowerCase().replace(/'/g, "''");
const sql = `UPDATE admin_users SET password_hash='${hash}', password_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), failed_logins=0, locked_until=NULL WHERE lower(email)='${e}';`
  + ` DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE lower(email)='${e}');`
  + ` SELECT email, role, status, (password_hash IS NOT NULL) AS has_password FROM admin_users WHERE lower(email)='${e}';`;

const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', target, '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const rows = JSON.parse(out).flatMap((r) => r.results ?? []);
if (!rows.length) { console.error(`No admin user with e-mail ${email}.`); process.exit(1); }
console.log(`Password set for ${rows[0].email} (${rows[0].role}, ${rows[0].status}).`);
