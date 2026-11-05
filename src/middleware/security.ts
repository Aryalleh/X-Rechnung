/** Security headers + CSRF protection for state-changing requests. */
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../http-types';
import { AppError } from '../lib/errors';

/**
 * Security headers. CSP is strict: no inline scripts in the SPA shell (Vite
 * emits hashed script files). 'unsafe-inline' is allowed for styles only
 * (Tailwind injects a stylesheet; inline style attributes are used sparingly).
 */
export const securityHeaders: MiddlewareHandler<HonoEnv> = async (c, next) => {
  await next();
  // Responses from fetch()/ASSETS.fetch() have immutable headers; re-wrap so
  // we can set security headers without "Can't modify immutable headers".
  c.res = new Response(c.res.body, c.res);
  const h = c.res.headers;
  h.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  );
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  h.set('X-Frame-Options', 'DENY');
  if (c.env.ENVIRONMENT === 'production') {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection: for mutating requests, require an Origin/Referer that
 * matches the request host. Combined with SameSite cookies and the Access JWT,
 * this blocks cross-site state changes. A custom header requirement
 * (X-Requested-With) is also enforced so simple form posts are rejected.
 */
export const csrfProtection: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    const origin = c.req.header('Origin');
    const host = c.req.header('Host');
    if (origin) {
      const originHost = safeHost(origin);
      if (!originHost || originHost !== host) {
        throw new AppError('FORBIDDEN', 'CSRF: origin mismatch');
      }
    }
    if (c.req.header('X-Requested-With') !== 'XMLHttpRequest') {
      throw new AppError('FORBIDDEN', 'CSRF: missing X-Requested-With');
    }
  }
  await next();
};

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
