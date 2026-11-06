/** Tiny typed API client. All mutating calls carry the CSRF header the
 * backend requires (X-Requested-With) and the UI language (X-UI-Lang) so
 * server messages come back in the user's language. */
import { getCurrentLang } from './i18n';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; fields?: Record<string, string>; detail?: string };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', 'X-UI-Lang': getCurrentLang() };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const json = (await res.json().catch(() => ({ ok: false, error: { code: 'NETWORK', message: '' } }))) as ApiEnvelope<T>;
  // Session expired / signed out elsewhere → let the app show the login screen.
  if (res.status === 401 && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('xr:unauthorized'));
  if (!json.ok) {
    const err = new Error(json.error?.message ?? '');
    (err as Error & { code?: string; fields?: unknown }).code = json.error?.code;
    (err as Error & { fields?: unknown }).fields = json.error?.fields;
    throw err;
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  raw: (path: string) => fetch(`/api${path}`, { headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-UI-Lang': getCurrentLang() } }),
};
