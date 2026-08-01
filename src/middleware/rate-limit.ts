/**
 * Best-effort in-isolate rate limiting for sensitive endpoints (setup, login
 * probes, uploads). Per-isolate memory is not globally consistent, so the
 * setup endpoint ALSO enforces a persistent attempts counter in D1
 * (setup_state.setup_attempts) as the real guard. This limiter reduces burst
 * abuse cheaply without extra infrastructure.
 */
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../http-types';
import { AppError } from '../lib/errors';

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { key: string; limit: number; windowMs: number }): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const bucketKey = `${opts.key}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + opts.windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > opts.limit) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        c.header('Retry-After', String(retryAfter));
        throw new AppError('RATE_LIMITED', `limit ${opts.limit}/${opts.windowMs}ms exceeded`);
      }
    }
    await next();
  };
}
