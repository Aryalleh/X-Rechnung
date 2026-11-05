import type { Context } from 'hono';
import { AppError, messageFor, resolveUiLang } from './errors';

/** Standardized API envelope. */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}
export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    /** Only populated when ENVIRONMENT !== 'production'. */
    detail?: string;
  };
}

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json<ApiSuccess<T>>({ ok: true, data }, status as 200);
}

export function fail(c: Context, err: unknown, environment: string) {
  const isProd = environment === 'production';
  const lang = resolveUiLang(c.req.header('X-UI-Lang'), c.req.header('Accept-Language'));
  if (err instanceof AppError) {
    const body: ApiError = {
      ok: false,
      error: {
        code: err.code,
        message: messageFor(err.code, lang),
        ...(err.fields ? { fields: err.fields } : {}),
        ...(!isProd && err.detail ? { detail: err.detail } : {}),
      },
    };
    return c.json(body, err.status as 400);
  }
  const detail = err instanceof Error ? err.message : String(err);
  const body: ApiError = {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: messageFor('INTERNAL', lang),
      ...(!isProd ? { detail } : {}),
    },
  };
  return c.json(body, 500);
}
