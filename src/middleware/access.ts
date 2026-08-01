/**
 * Cloudflare Access JWT verification.
 *
 * We do NOT trust the presence of the header. We verify the RS256 signature
 * against the team's JWKS, check `aud` (ACCESS_AUD) and `iss` (team domain),
 * and confirm expiry. Team domain + AUD come from D1 settings (never
 * hardcoded). The `email` claim must match an ACTIVE admin_user.
 */
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv, Actor } from '../http-types';
import { AppError } from '../lib/errors';
import { base64ToBytes, toArrayBuffer } from '../lib/crypto';
import { getAccessConfig } from '../services/settings-service';
import { findAdminByEmail } from '../db/repositories/admin-repo';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

interface JwksCache {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}
const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCacheByTeam = new Map<string, JwksCache>();

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return base64ToBytes(b64);
}
function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function importJwk(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

async function getKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const cached = jwksCacheByTeam.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(certsUrl, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new AppError('UNAUTHORIZED', `JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) keys.set(jwk.kid, await importJwk(jwk));
  jwksCacheByTeam.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

interface AccessClaims {
  aud: string | string[];
  email?: string;
  iss: string;
  exp: number;
  sub?: string;
  identity_nonce?: string;
}

export async function verifyAccessJwt(
  token: string,
  aud: string,
  teamDomain: string,
): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('UNAUTHORIZED', 'malformed JWT');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const header = JSON.parse(b64urlToString(headerB64)) as { kid: string; alg: string };
  if (header.alg !== 'RS256') throw new AppError('UNAUTHORIZED', 'unexpected alg');

  const keys = await getKeys(teamDomain);
  const key = keys.get(header.kid);
  if (!key) throw new AppError('UNAUTHORIZED', 'unknown signing key');

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, toArrayBuffer(b64urlToBytes(sigB64)), toArrayBuffer(data));
  if (!valid) throw new AppError('UNAUTHORIZED', 'invalid signature');

  const claims = JSON.parse(b64urlToString(payloadB64)) as AccessClaims;
  const audList = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audList.includes(aud)) throw new AppError('UNAUTHORIZED', 'aud mismatch');
  if (claims.iss !== `https://${teamDomain}`) throw new AppError('UNAUTHORIZED', 'iss mismatch');
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new AppError('UNAUTHORIZED', 'token expired');
  }
  return claims;
}

function extractToken(req: Request): string | null {
  const header = req.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = req.headers.get('Cookie') ?? '';
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Middleware enforcing Access. When Access is not yet configured (fresh setup)
 * this middleware is bypassed by the setup gate so the operator is never locked
 * out. Routes still behind Access require a verified, known admin.
 */
export const requireAccess: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const access = await getAccessConfig(c.env.DB);

  // Dev escape hatch: only when ENVIRONMENT !== production AND Access unconfigured.
  if (!access.aud || !access.teamDomain) {
    if (c.env.ENVIRONMENT !== 'production') {
      c.set('actor', { email: 'dev@localhost', role: 'OWNER' });
      await next();
      return;
    }
    throw new AppError('UNAUTHORIZED', 'Access not configured');
  }

  const token = extractToken(c.req.raw);
  if (!token) throw new AppError('UNAUTHORIZED', 'missing Access token');

  const claims = await verifyAccessJwt(token, access.aud, access.teamDomain);
  const email = claims.email?.toLowerCase();
  if (!email) throw new AppError('UNAUTHORIZED', 'no email claim');

  const admin = await findAdminByEmail(c.env.DB, email);
  if (!admin || admin.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'not an active admin');

  const actor: Actor = {
    email,
    role: admin.role,
    ...(claims.sub ? { identityId: claims.sub } : {}),
  };
  c.set('actor', actor);
  await next();
};

/** Restrict a route to specific roles. */
export function requireRole(...roles: Actor['role'][]): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const actor = c.get('actor');
    if (!actor || !roles.includes(actor.role)) throw new AppError('FORBIDDEN');
    await next();
  };
}
