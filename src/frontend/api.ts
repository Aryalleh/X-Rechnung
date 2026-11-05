/** Tiny typed API client. All mutating calls carry the CSRF header the
 * backend requires (X-Requested-With). */

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; fields?: Record<string, string>; detail?: string };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const json = (await res.json().catch(() => ({ ok: false, error: { code: 'INTERNAL', message: 'خطای شبکه' } }))) as ApiEnvelope<T>;
  if (!json.ok) {
    const fieldMsgs = json.error?.fields ? Object.values(json.error.fields).filter(Boolean) : [];
    const msg = [json.error?.message ?? 'خطا', ...fieldMsgs].join(' — ');
    const err = new Error(msg);
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
  raw: (path: string) => fetch(`/api${path}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }),
};

/** German money formatter for display. */
export function euro(cents: number, currency = 'EUR'): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = (abs / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? '-' : ''}${s} ${currency === 'EUR' ? '€' : currency}`;
}
