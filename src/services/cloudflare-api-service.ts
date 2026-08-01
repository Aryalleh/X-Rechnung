/**
 * Cloudflare API adapter used by Setup + the Cloudflare settings panel.
 *
 * The API token is provided per-operation (never stored by default) and is
 * used only for the duration of the call. Only scoped tokens are accepted — a
 * Global API Key (identified by the presence of an X-Auth-Email/Key style call)
 * is never used here; we only ever send `Authorization: Bearer <token>`.
 *
 * These are real Cloudflare REST calls. They run when a valid token + IDs are
 * supplied at deploy/runtime; nothing here is hardcoded.
 */
const API = 'https://api.cloudflare.com/client/v4';

export interface CfResult<T> {
  success: boolean;
  result: T;
  errors: { code: number; message: string }[];
}

async function cf<T>(token: string, path: string, init: RequestInit = {}): Promise<CfResult<T>> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({ success: false, errors: [{ code: res.status, message: res.statusText }], result: null }))) as CfResult<T>;
  return body;
}

/** Verify a token and return its status ('active') — rejects non-scoped tokens implicitly. */
export async function verifyToken(token: string): Promise<{ ok: boolean; status?: string; message?: string }> {
  const r = await cf<{ status: string }>(token, '/user/tokens/verify');
  if (!r.success) return { ok: false, message: r.errors[0]?.message ?? 'token verify failed' };
  return { ok: true, status: r.result.status };
}

export interface AccessAppInput {
  accountId: string;
  name: string;
  domain: string; // e.g. rechnung.example.de
  sessionDuration?: string;
}

export async function createAccessApp(token: string, input: AccessAppInput): Promise<{ appId: string; aud: string }> {
  const r = await cf<{ id: string; aud: string }>(token, `/accounts/${input.accountId}/access/apps`, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      domain: input.domain,
      type: 'self_hosted',
      session_duration: input.sessionDuration ?? '24h',
    }),
  });
  if (!r.success) throw new Error(`createAccessApp: ${r.errors[0]?.message}`);
  return { appId: r.result.id, aud: r.result.aud };
}

/** Owner-only Allow policy (Include: email == owner). Never "everyone". */
export async function createOwnerPolicy(
  token: string,
  accountId: string,
  appId: string,
  ownerEmail: string,
): Promise<{ policyId: string }> {
  const r = await cf<{ id: string }>(token, `/accounts/${accountId}/access/apps/${appId}/policies`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Owner only',
      decision: 'allow',
      include: [{ email: { email: ownerEmail } }],
    }),
  });
  if (!r.success) throw new Error(`createOwnerPolicy: ${r.errors[0]?.message}`);
  return { policyId: r.result.id };
}

/** Add owner email to an existing app's allow policy (used by ownership transfer). */
export async function updateOwnerPolicy(
  token: string,
  accountId: string,
  appId: string,
  policyId: string,
  emails: string[],
): Promise<void> {
  const r = await cf(token, `/accounts/${accountId}/access/apps/${appId}/policies/${policyId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Owner / Admins',
      decision: 'allow',
      include: emails.map((email) => ({ email: { email } })),
    }),
  });
  if (!r.success) throw new Error(`updateOwnerPolicy: ${r.errors[0]?.message}`);
}

export async function getAccessTeamDomain(token: string, accountId: string): Promise<string | null> {
  const r = await cf<{ auth_domain: string }>(token, `/accounts/${accountId}/access/organizations`);
  return r.success ? r.result.auth_domain : null;
}

export async function enableEmailRouting(token: string, zoneId: string): Promise<boolean> {
  const r = await cf(token, `/zones/${zoneId}/email/routing/enable`, { method: 'POST' });
  return r.success;
}

export async function createEmailRoutingRule(
  token: string,
  zoneId: string,
  address: string,
  workerName: string,
): Promise<{ ruleId: string }> {
  const r = await cf<{ tag: string }>(token, `/zones/${zoneId}/email/routing/rules`, {
    method: 'POST',
    body: JSON.stringify({
      name: `E-Rechnung to ${workerName}`,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: address }],
      actions: [{ type: 'worker', value: [workerName] }],
    }),
  });
  if (!r.success) throw new Error(`createEmailRoutingRule: ${r.errors[0]?.message}`);
  return { ruleId: r.result.tag };
}

export async function addWorkerCustomDomain(
  token: string,
  accountId: string,
  hostname: string,
  service: string,
  zoneId: string,
): Promise<{ id: string }> {
  const r = await cf<{ id: string }>(token, `/accounts/${accountId}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify({ hostname, service, zone_id: zoneId, environment: 'production' }),
  });
  if (!r.success) throw new Error(`addWorkerCustomDomain: ${r.errors[0]?.message}`);
  return { id: r.result.id };
}
