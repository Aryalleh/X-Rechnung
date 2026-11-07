/**
 * Exchange ActiveSync (protocol 14.0/14.1) for the built-in mailbox.
 *
 * Phones (Gmail app → "Exchange", iPhone Mail, Samsung Email, Outlook mobile) sync
 * Inbox / Sent / Archive / Deleted over HTTPS against this Worker and send through
 * the same send_email path as the web app. Auth is HTTP Basic with the user's app
 * password; each user sees exactly the mailboxes the web app shows them.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../config/env';
import type { Actor, HonoEnv } from '../http-types';
import { all, one, run } from '../db/client';
import { sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { checkCredentials } from '../services/auth-service';
import {
  attachmentsOf, getMail, listMail, purgeMail, scopeFor, scopeSql, sendMail, mailSettings, senderAddresses,
  type MailRow, type MailScope,
} from '../services/mail-service';
import { buildMime } from '../services/email/sender';
import { bodiesOf, parseAddress, parseEmail } from '../email/mime';
import { child, decode, el, encode, flag, kids, textOf, type WNode } from './wbxml';
import { contactFromApp, contactProps, eventFromApp, eventProps, noteFromApp, noteProps } from './pim';
import {
  getContact, getEvent, getNote, pimDelete, pimVersions, saveContact, saveEvent, saveNote, suggestAddresses, type PimKind,
} from '../services/pim-service';

export const EAS_PATH = '/Microsoft-Server-ActiveSync';
const VERSIONS = '14.0,14.1';
const COMMANDS = 'Sync,SendMail,SmartForward,SmartReply,GetAttachment,FolderSync,FolderCreate,FolderDelete,FolderUpdate,MoveItems,GetItemEstimate,MeetingResponse,Search,Settings,Ping,ItemOperations,Provision,ResolveRecipients,ValidateCert';
/** Long-poll ceiling for Ping / Sync-Wait; a client simply re-pings after an early "no changes". */
const MAX_WAIT_MS = 85_000;
const POLL_MS = 15_000;
const MAX_ITEMS = 1000;

/** The folders a phone sees. Drafts/Outbox exist because clients expect them; they stay empty. */
const FOLDERS = [
  { id: 'inbox', folder: 'INBOX', type: 2, name: 'Inbox' },
  { id: 'drafts', folder: null, type: 3, name: 'Drafts' },
  { id: 'trash', folder: 'TRASH', type: 4, name: 'Deleted Items' },
  { id: 'sent', folder: 'SENT', type: 5, name: 'Sent Items' },
  { id: 'outbox', folder: null, type: 6, name: 'Outbox' },
  { id: 'archive', folder: 'ARCHIVE', type: 12, name: 'Archive' },
  // Added in folder-hierarchy version 2.
  { id: 'calendar', folder: null, type: 8, name: 'Calendar' },
  { id: 'contacts', folder: null, type: 9, name: 'Contacts' },
  { id: 'notes', folder: null, type: 10, name: 'Notes' },
] as const;
/** Folder hierarchy versions: v1 = mail folders, v2 = + calendar/contacts/notes. */
const HIERARCHY_VERSION = 2;
const FOLDERS_SINCE: Record<string, number> = { calendar: 2, contacts: 2, notes: 2 };
const PIM: Record<string, PimKind> = { calendar: 'calendar', contacts: 'contacts', notes: 'notes' };
const CLASS_OF: Record<PimKind, string> = { calendar: 'Calendar', contacts: 'Contacts', notes: 'Notes' };
const folderById = (id: string | undefined) => FOLDERS.find((f) => f.id === id);
const idOfFolder = (folder: string) => FOLDERS.find((f) => f.folder === folder)?.id ?? 'inbox';

interface Device { id: string; user_id: string; device_id: string; policy_key: string | null; blocked: number; sync_cache: string | null; ping_cache: string | null }
interface Ctx { env: Env; actor: Actor; scope: MailScope; device: Device; version: string; multipart: boolean; waitUntil: (p: Promise<unknown>) => void }
interface BodyPref { type: number; truncation?: number }
interface CollOptions { filterType: number; prefs: BodyPref[]; mime: number }
type Snapshot = Record<string, string>;

// ----------------------------------------------------------------- request plumbing

interface Req { cmd: string; deviceId: string; deviceType: string; params: Record<string, string> }

/** Plain (?Cmd=Sync&DeviceId=…) or base64-encoded query (MS-ASHTTP 2.2.1.1.1.1). */
function parseQuery(url: URL): Req | null {
  const p = url.searchParams;
  if (p.get('Cmd')) {
    return { cmd: p.get('Cmd')!, deviceId: p.get('DeviceId') ?? '', deviceType: p.get('DeviceType') ?? '', params: Object.fromEntries(p) };
  }
  const raw = url.search.slice(1);
  if (!raw) return null;
  try {
    const b = Uint8Array.from(atob(decodeURIComponent(raw)), (ch) => ch.charCodeAt(0));
    const CMDS: Record<number, string> = { 0: 'Sync', 1: 'SendMail', 2: 'SmartForward', 3: 'SmartReply', 4: 'GetAttachment', 9: 'FolderSync', 10: 'FolderCreate',
      11: 'FolderDelete', 12: 'FolderUpdate', 13: 'MoveItems', 14: 'GetItemEstimate', 15: 'MeetingResponse', 16: 'Search', 17: 'Settings', 18: 'Ping',
      19: 'ItemOperations', 20: 'Provision', 21: 'ResolveRecipients', 22: 'ValidateCert' };
    let i = 4; // version, command, locale(2)
    const cmd = CMDS[b[1]!] ?? 'Unknown';
    const devLen = b[i++]!; const deviceId = [...b.slice(i, i + devLen)].map((x) => x.toString(16).padStart(2, '0')).join(''); i += devLen;
    const polLen = b[i++]!; i += polLen;
    const typeLen = b[i++]!; const deviceType = new TextDecoder().decode(b.slice(i, i + typeLen)); i += typeLen;
    const NAMES: Record<number, string> = { 0: 'AttachmentName', 1: 'CollectionId', 3: 'ItemId', 4: 'LongId', 6: 'Occurrence', 7: 'Options', 8: 'User', 9: 'SaveInSent' };
    const params: Record<string, string> = {};
    while (i < b.length) {
      const tag = b[i++]!; const len = b[i++]!;
      const val = b.slice(i, i + len); i += len;
      if (tag === 7) params.SaveInSent = val[0]! & 1 ? 'T' : 'F';
      else if (NAMES[tag]) params[NAMES[tag]!] = new TextDecoder().decode(val);
    }
    return { cmd, deviceId, deviceType, params };
  } catch {
    return null;
  }
}

function wbxml(node: WNode | null, status = 200): Response {
  const h = new Headers({ 'MS-Server-ActiveSync': '14.1', 'Cache-Control': 'private' });
  if (!node) return new Response(null, { status, headers: h });
  h.set('Content-Type', 'application/vnd.ms-sync.wbxml');
  return new Response(encode(node).slice().buffer as ArrayBuffer, { status, headers: h });
}

/** Multipart ItemOperations response: WBXML part 0 + raw data parts (MS-ASCMD 2.2.2.9.1.1). */
function multipart(node: WNode, parts: Uint8Array[]): Response {
  const all = [encode(node), ...parts];
  const headerLen = 4 + all.length * 8;
  const total = headerLen + all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, all.length, true);
  let off = headerLen;
  all.forEach((p, k) => { dv.setInt32(4 + k * 8, off, true); dv.setInt32(8 + k * 8, p.length, true); out.set(p, off); off += p.length; });
  return new Response(out, { headers: { 'Content-Type': 'application/vnd.ms-sync.multipart', 'MS-Server-ActiveSync': '14.1' } });
}

const unauthorized = () => new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="ActiveSync"' } });

// Successful logins are cached per isolate for a while so a phone's frequent requests
// don't re-run the slow password hash every time. Keyed by a hash of the header.
const authCache = new Map<string, { userId: string; until: number }>();
const AUTH_TTL_MS = 15 * 60_000;

async function authenticate(env: Env, header: string | undefined): Promise<Actor | null> {
  if (!header?.startsWith('Basic ')) return null;
  let user = ''; let pass = '';
  try {
    const dec = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6).trim()), (ch) => ch.charCodeAt(0)));
    const k = dec.indexOf(':');
    if (k < 0) return null;
    user = dec.slice(0, k); pass = dec.slice(k + 1);
  } catch { return null; }
  user = (user.includes('\\') ? user.split('\\').pop()! : user).trim().toLowerCase();
  if (!user || !pass || pass.length > 256) return null;

  const key = await sha256Hex(header);
  const row = await one<{ id: string; email: string; role: Actor['role']; status: string; mail_only: number; mail_address: string | null }>(env.DB,
    `SELECT id, email, role, status, mail_only, mail_address FROM admin_users WHERE lower(email) = ?1 OR lower(mail_address) = ?1 LIMIT 1`, user);
  const hit = authCache.get(key);
  if (!(hit && hit.until > Date.now() && row && hit.userId === row.id)) {
    authCache.delete(key);
    const cred = await checkCredentials(env.DB, row?.email ?? user, pass); // throws on failure, counts toward lockout
    if (authCache.size > 500) authCache.clear();
    authCache.set(key, { userId: cred.id, until: Date.now() + AUTH_TTL_MS });
  }
  if (!row || row.status !== 'ACTIVE') return null;
  return { email: row.email, role: row.mail_only ? 'MAIL_USER' : row.role, mailAddress: row.mail_address, userId: row.id, via: 'eas' };
}

async function loadDevice(env: Env, userId: string, req: Req, ua: string | undefined, version: string): Promise<Device> {
  const id = `eas_${(await sha256Hex(`${userId}|${req.deviceId}`)).slice(0, 24)}`;
  await run(env.DB, `INSERT INTO eas_devices (id, user_id, device_id, device_type, user_agent, protocol) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, device_id) DO UPDATE SET device_type = excluded.device_type, user_agent = coalesce(excluded.user_agent, user_agent),
      protocol = excluded.protocol, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  id, userId, req.deviceId, req.deviceType || null, ua?.slice(0, 200) ?? null, version);
  return (await one<Device>(env.DB, `SELECT id, user_id, device_id, policy_key, blocked, sync_cache, ping_cache FROM eas_devices WHERE id = ?1`, id))!;
}

// ----------------------------------------------------------------- mailbox state

async function currentItems(ctx: Ctx, collectionId: string, filterType: number): Promise<Snapshot> {
  if (PIM[collectionId]) return pimVersions(ctx.env.DB, PIM[collectionId]!, ctx.actor.userId!);
  const f = folderById(collectionId);
  if (!f?.folder) return {};
  const params: unknown[] = [];
  const where = [scopeSql(ctx.scope, params)];
  params.push(f.folder); where.push(`folder = ?${params.length}`);
  const DAYS: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 31, 6: 93, 7: 186 };
  if (DAYS[filterType]) { params.push(new Date(Date.now() - DAYS[filterType]! * 86_400_000).toISOString()); where.push(`created_at >= ?${params.length}`); }
  const rows = await all<{ id: string; is_read: number; is_starred: number }>(ctx.env.DB,
    `SELECT id, is_read, is_starred FROM mail_messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${MAX_ITEMS}`, ...params);
  const out: Snapshot = {};
  for (const r of rows) out[r.id] = `${r.is_read ? 1 : 0}${r.is_starred ? 1 : 0}`;
  return out;
}

interface State { sync_key: string; snapshot: string; prev_key: string | null; prev_snapshot: string | null; options: string | null }
const getState = (ctx: Ctx, coll: string) =>
  one<State>(ctx.env.DB, `SELECT sync_key, snapshot, prev_key, prev_snapshot, options FROM eas_sync_state WHERE device_pk = ?1 AND collection_id = ?2`, ctx.device.id, coll);
const putState = (ctx: Ctx, coll: string, key: string, snap: Snapshot, prevKey: string | null, prevSnap: Snapshot | null, opts: CollOptions) =>
  run(ctx.env.DB, `INSERT INTO eas_sync_state (device_pk, collection_id, sync_key, snapshot, prev_key, prev_snapshot, options) VALUES (?1,?2,?3,?4,?5,?6,?7)
    ON CONFLICT(device_pk, collection_id) DO UPDATE SET sync_key=excluded.sync_key, snapshot=excluded.snapshot, prev_key=excluded.prev_key,
      prev_snapshot=excluded.prev_snapshot, options=excluded.options, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ctx.device.id, coll, key, JSON.stringify(snap), prevKey, prevSnap ? JSON.stringify(prevSnap) : null, JSON.stringify(opts));

function diff(cur: Snapshot, known: Snapshot) {
  const adds = Object.keys(cur).filter((id) => !(id in known)); // newest first (query order)
  const changes = Object.keys(cur).filter((id) => id in known && known[id] !== cur[id]);
  const deletes = Object.keys(known).filter((id) => !(id in cur));
  return { adds, changes, deletes, count: adds.length + changes.length + deletes.length };
}

// ----------------------------------------------------------------- email → WBXML

const fmtAddr = (name: string | null, email: string | null) => (email ? (name ? `"${name.replace(/"/g, '')}" <${email}>` : email) : '');
const utf8 = new TextEncoder();

function truncate(data: Uint8Array, limit: number | undefined): { data: Uint8Array; truncated: boolean } {
  if (limit === undefined || data.length <= limit) return { data, truncated: false };
  return { data: data.slice(0, limit), truncated: true };
}

async function mimeOf(env: Env, m: MailRow): Promise<Uint8Array> {
  if (m.raw_r2_key) {
    const obj = await env.ARCHIVE_BUCKET.get(m.raw_r2_key);
    if (obj) return new Uint8Array(await obj.arrayBuffer());
  }
  const atts = [];
  for (const a of await attachmentsOf(env.DB, m.id)) {
    const obj = await env.ARCHIVE_BUCKET.get(a.r2_key);
    if (obj) atts.push({ filename: a.filename, mime: a.mime_type, bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  const { raw } = buildMime({
    from: m.from_email ?? 'unknown@localhost', ...(m.from_name ? { fromName: m.from_name } : {}), to: m.to_email ?? '', ...(m.cc_email ? { cc: m.cc_email } : {}),
    subject: m.subject ?? '', text: m.text_body ?? '', ...(m.html_body ? { html: m.html_body } : {}), ...(atts.length ? { attachments: atts } : {}),
  });
  return utf8.encode(raw);
}

/** Email properties (inside ApplicationData / Properties) with the body the client asked for. */
async function emailProps(ctx: Ctx, m: MailRow, opts: CollOptions): Promise<(WNode | null)[]> {
  const atts = await attachmentsOf(ctx.env.DB, m.id);
  const wantMime = opts.mime === 2 && opts.prefs.some((p) => p.type === 4);
  const pref = wantMime ? opts.prefs.find((p) => p.type === 4)!
    : opts.prefs.find((p) => p.type === 2 && m.html_body) ?? opts.prefs.find((p) => p.type === 1) ?? opts.prefs[0] ?? { type: 1 };
  let type = pref.type === 4 && !wantMime ? 1 : pref.type;
  let raw: Uint8Array;
  if (type === 4) raw = await mimeOf(ctx.env, m);
  else if (type === 2 && m.html_body) raw = utf8.encode(m.html_body);
  else { type = 1; raw = utf8.encode(m.text_body ?? ''); }
  const body = truncate(raw, pref.truncation);

  const date = (m.created_at ?? new Date().toISOString()).replace(/(\.\d{3})\d*Z$/, '$1Z');
  const flagged = !!m.is_starred;
  return [
    el('Email:To', m.to_email ?? ''),
    m.cc_email ? el('Email:Cc', m.cc_email) : null,
    el('Email:From', fmtAddr(m.from_name, m.from_email)),
    el('Email:Subject', m.subject ?? ''),
    el('Email:DateReceived', date),
    el('Email:DisplayTo', m.to_email ?? ''),
    el('Email:ThreadTopic', (m.subject ?? '').replace(/^((re|aw|fw|fwd|wg)\s*:\s*)+/i, '')),
    el('Email:Importance', 1),
    el('Email:Read', m.is_read ? 1 : 0),
    atts.length ? el('AirSyncBase:Attachments', atts.map((a) => el('AirSyncBase:Attachment',
      el('AirSyncBase:DisplayName', a.filename),
      el('AirSyncBase:FileReference', `${m.id}:${a.id}`),
      el('AirSyncBase:Method', 1),
      el('AirSyncBase:EstimatedDataSize', a.size_bytes),
      a.content_id ? el('AirSyncBase:ContentId', a.content_id) : null,
      a.content_id ? el('AirSyncBase:IsInline', 1) : null,
    ))) : null,
    el('AirSyncBase:Body',
      el('AirSyncBase:Type', type),
      el('AirSyncBase:EstimatedDataSize', raw.length),
      body.truncated ? el('AirSyncBase:Truncated', 1) : null,
      pref.truncation === 0 ? null : el('AirSyncBase:Data', utf8Text(body.data)),
    ),
    el('Email:MessageClass', 'IPM.Note'),
    el('Email:InternetCPID', 65001),
    flagged ? el('Email:Flag', el('Email:FlagStatus', 2), el('Email:FlagType', 'Flag for follow up')) : el('Email:Flag'),
    el('Email:ContentClass', 'urn:content-classes:message'),
    el('AirSyncBase:NativeBodyType', m.html_body ? 2 : 1),
  ];
}
/** Body bytes as text for STR_I (MIME is 7-bit/UTF-8 in practice; invalid bytes become U+FFFD). */
const utf8Text = (b: Uint8Array) => new TextDecoder().decode(b);

function readOptions(opt: WNode | undefined, fallback?: CollOptions): CollOptions {
  if (!opt) return fallback ?? { filterType: 0, prefs: [{ type: 1, truncation: 32768 }], mime: 0 };
  const prefs = kids(opt, 'AirSyncBase:BodyPreference').map((p) => {
    const t = textOf(p, 'AirSyncBase:TruncationSize');
    return { type: Number(textOf(p, 'AirSyncBase:Type') ?? 1), ...(t !== undefined ? { truncation: Number(t) } : {}) };
  });
  return {
    filterType: Number(textOf(opt, 'AirSync:FilterType') ?? fallback?.filterType ?? 0),
    prefs: prefs.length ? prefs : fallback?.prefs ?? [{ type: 1, truncation: 32768 }],
    mime: Number(textOf(opt, 'AirSync:MIMESupport') ?? fallback?.mime ?? 0),
  };
}

// ----------------------------------------------------------------- mutations

async function setFlags(ctx: Ctx, id: string, app: WNode | undefined): Promise<boolean> {
  const m = await getMail(ctx.env.DB, id, ctx.scope).catch(() => null);
  if (!m) return false;
  const read = textOf(app, 'Email:Read');
  const fl = child(app, 'Email:Flag');
  if (read !== undefined) await run(ctx.env.DB, `UPDATE mail_messages SET is_read = ?2 WHERE id = ?1`, id, read === '1' ? 1 : 0);
  if (fl) await run(ctx.env.DB, `UPDATE mail_messages SET is_starred = ?2 WHERE id = ?1`, id, textOf(fl, 'Email:FlagStatus') === '2' ? 1 : 0);
  return true;
}

async function moveTo(ctx: Ctx, id: string, folder: string): Promise<boolean> {
  const m = await getMail(ctx.env.DB, id, ctx.scope).catch(() => null);
  if (!m) return false;
  await run(ctx.env.DB, `UPDATE mail_messages SET folder = ?2 WHERE id = ?1`, id, folder);
  return true;
}

async function remove(ctx: Ctx, id: string, collectionId: string, asMove: boolean): Promise<boolean> {
  const m = await getMail(ctx.env.DB, id, ctx.scope).catch(() => null);
  if (!m) return false;
  if (collectionId === 'trash' || !asMove) await purgeMail(ctx.env, id);
  else await run(ctx.env.DB, `UPDATE mail_messages SET folder = 'TRASH' WHERE id = ?1`, id);
  return true;
}

// ----------------------------------------------------------------- commands

async function folderSync(_ctx: Ctx, req: WNode | null): Promise<Response> {
  const key = textOf(req, 'FolderHierarchy:SyncKey') ?? '0';
  // The sync key is the hierarchy version the phone has; send the folders added since then.
  const have = Number(key);
  if (!Number.isInteger(have) || have < 0 || have > HIERARCHY_VERSION) return wbxml(el('FolderHierarchy:FolderSync', el('FolderHierarchy:Status', 9)));
  const added = FOLDERS.filter((f) => (FOLDERS_SINCE[f.id] ?? 1) > have);
  return wbxml(el('FolderHierarchy:FolderSync',
    el('FolderHierarchy:Status', 1),
    el('FolderHierarchy:SyncKey', String(HIERARCHY_VERSION)),
    el('FolderHierarchy:Changes',
      el('FolderHierarchy:Count', added.length),
      added.map((f) => el('FolderHierarchy:Add',
        el('FolderHierarchy:ServerId', f.id), el('FolderHierarchy:ParentId', '0'),
        el('FolderHierarchy:DisplayName', f.name), el('FolderHierarchy:Type', f.type))),
    ),
  ));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sync(ctx: Ctx, reqIn: WNode | null): Promise<Response> {
  // Empty or partial requests reuse the last full one (MS-ASCMD 2.2.3.170).
  let req = reqIn;
  const cached = ctx.device.sync_cache ? decodeCache(ctx.device.sync_cache) : null;
  if (!req) {
    if (!cached) return wbxml(el('AirSync:Sync', el('AirSync:Status', 13)));
    req = cached;
  } else if (flag(req, 'AirSync:Partial') && cached) {
    const given = new Set(kids(child(req, 'AirSync:Collections'), 'AirSync:Collection').map((c) => textOf(c, 'AirSync:CollectionId')));
    const merged = kids(child(cached, 'AirSync:Collections'), 'AirSync:Collection').filter((c) => !given.has(textOf(c, 'AirSync:CollectionId')));
    child(req, 'AirSync:Collections')?.children.push(...merged);
  }
  const collections = kids(child(req, 'AirSync:Collections'), 'AirSync:Collection');
  if (!collections.length) return wbxml(el('AirSync:Sync', el('AirSync:Status', 13)));
  // Remember the request without client commands, with sync keys stripped (they move on).
  await run(ctx.env.DB, `UPDATE eas_devices SET sync_cache = ?2 WHERE id = ?1`, ctx.device.id, encodeCache(req));

  const globalWindow = Number(textOf(req, 'AirSync:WindowSize') ?? 100);
  const waitMin = textOf(req, 'AirSync:Wait');
  const hb = textOf(req, 'AirSync:HeartbeatInterval');
  const deadline = Date.now() + Math.min(MAX_WAIT_MS, (waitMin ? Number(waitMin) * 60_000 : hb ? Number(hb) * 1000 : 0));

  for (;;) {
    const out: WNode[] = [];
    let anything = false;
    for (const coll of collections) {
      const r = await syncCollection(ctx, coll, globalWindow, Date.now() < deadline);
      if (r.node) out.push(r.node);
      anything ||= r.changed;
    }
    if (anything || Date.now() >= deadline) {
      if (!anything && (waitMin || hb) && !out.length) return wbxml(null);
      return wbxml(el('AirSync:Sync', el('AirSync:Collections', out)));
    }
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

/** Sync one collection. With `quiet`, nothing is written unless there is something to send (long-poll). */
async function syncCollection(ctx: Ctx, coll: WNode, globalWindow: number, quiet: boolean): Promise<{ node: WNode | null; changed: boolean }> {
  const collId = textOf(coll, 'AirSync:CollectionId') ?? '';
  const key = textOf(coll, 'AirSync:SyncKey') ?? '0';
  const head = (k: string, status: number) => [el('AirSync:SyncKey', k), el('AirSync:CollectionId', collId), el('AirSync:Status', status)];
  if (!folderById(collId)) return { node: el('AirSync:Collection', head(key, 8)), changed: true };

  const state = await getState(ctx, collId);
  const opts = readOptions(child(coll, 'AirSync:Options'), state?.options ? JSON.parse(state.options) as CollOptions : undefined);

  if (key === '0') {
    await putState(ctx, collId, '1', {}, null, null, opts);
    return { node: el('AirSync:Collection', head('1', 1)), changed: true };
  }
  let base: Snapshot;
  if (state && key === state.sync_key) base = JSON.parse(state.snapshot) as Snapshot;
  else if (state && key === state.prev_key && state.prev_snapshot) base = JSON.parse(state.prev_snapshot) as Snapshot;
  else return { node: el('AirSync:Collection', head('0', 3)), changed: true }; // unknown key → client resyncs
  if (PIM[collId]) return syncPim(ctx, PIM[collId]!, coll, collId, key, state.sync_key, base, opts, globalWindow, quiet);

  const original = { ...base };
  const known = base;
  const responses: WNode[] = [];
  const asMove = flag(coll, 'AirSync:DeletesAsMoves') ?? true;
  const cmds = child(coll, 'AirSync:Commands');
  for (const c of cmds?.children ?? []) {
    const sid = textOf(c, 'AirSync:ServerId') ?? '';
    if (c.tag === 'AirSync:Change') {
      const ok = await setFlags(ctx, sid, child(c, 'AirSync:ApplicationData'));
      if (!ok) responses.push(el('AirSync:Change', el('AirSync:ServerId', sid), el('AirSync:Status', 8)));
    } else if (c.tag === 'AirSync:Delete') {
      await remove(ctx, sid, collId, asMove);
      delete known[sid];
    } else if (c.tag === 'AirSync:Add') {
      responses.push(el('AirSync:Add', el('AirSync:ClientId', textOf(c, 'AirSync:ClientId') ?? ''), el('AirSync:Status', 6)));
    } else if (c.tag === 'AirSync:Fetch') {
      const m = await getMail(ctx.env.DB, sid, ctx.scope).catch(() => null);
      responses.push(m
        ? el('AirSync:Fetch', el('AirSync:ServerId', sid), el('AirSync:Status', 1), el('AirSync:ApplicationData', await emailProps(ctx, m, opts)))
        : el('AirSync:Fetch', el('AirSync:ServerId', sid), el('AirSync:Status', 8)));
    }
  }
  // The client already knows about its own flag changes: don't echo them back.
  const cur = await currentItems(ctx, collId, opts.filterType);
  for (const c of cmds?.children ?? []) {
    const sid = textOf(c, 'AirSync:ServerId') ?? '';
    if (c.tag === 'AirSync:Change' && sid in known && sid in cur) known[sid] = cur[sid]!;
  }

  const getChanges = flag(coll, 'AirSync:GetChanges') ?? true;
  const window = Math.max(1, Math.min(512, Number(textOf(coll, 'AirSync:WindowSize') ?? globalWindow)));
  const commands: WNode[] = [];
  let more = false;
  if (getChanges) {
    const d = diff(cur, known);
    let budget = window;
    for (const id of d.deletes) { if (budget-- <= 0) { more = true; break; } commands.push(el('AirSync:Delete', el('AirSync:ServerId', id))); delete known[id]; }
    for (const id of d.changes) {
      if (budget-- <= 0) { more = true; break; }
      const [r, s] = cur[id]!.split('');
      commands.push(el('AirSync:Change', el('AirSync:ServerId', id), el('AirSync:ApplicationData',
        el('Email:Read', r!), s === '1' ? el('Email:Flag', el('Email:FlagStatus', 2), el('Email:FlagType', 'Flag for follow up')) : el('Email:Flag'))));
      known[id] = cur[id]!;
    }
    for (const id of d.adds) {
      if (budget-- <= 0) { more = true; break; }
      const m = await getMail(ctx.env.DB, id, ctx.scope).catch(() => null);
      if (!m) continue;
      commands.push(el('AirSync:Add', el('AirSync:ServerId', id), el('AirSync:ApplicationData', await emailProps(ctx, m, opts))));
      known[id] = cur[id]!;
    }
  }
  const changed = commands.length > 0 || responses.length > 0 || (cmds?.children.length ?? 0) > 0;
  if (quiet && !changed) return { node: null, changed: false };

  const newKey = String(Number(state.sync_key) + 1);
  await putState(ctx, collId, newKey, known, key, original, opts);
  return {
    node: el('AirSync:Collection', head(newKey, 1),
      responses.length ? el('AirSync:Responses', responses) : null,
      more ? el('AirSync:MoreAvailable') : null,
      commands.length ? el('AirSync:Commands', commands) : null),
    changed: true,
  };
}

// The cached Sync request: keep collection ids/options, drop commands and keys.
function encodeCache(req: WNode): string {
  const strip = (n: WNode): WNode => ({ tag: n.tag, children: n.children.filter((c) => c.tag !== 'AirSync:Commands').map(strip), ...(n.text !== undefined ? { text: n.text } : {}) });
  return JSON.stringify(strip(req));
}
function decodeCache(s: string): WNode | null {
  try { return JSON.parse(s) as WNode; } catch { return null; }
}

/** Sync keys for the cached request come from the stored state, not from the stale cache. */
async function refreshCachedKeys(ctx: Ctx, req: WNode | null): Promise<void> {
  for (const c of kids(child(req, 'AirSync:Collections'), 'AirSync:Collection')) {
    const st = await getState(ctx, textOf(c, 'AirSync:CollectionId') ?? '');
    const k = child(c, 'AirSync:SyncKey');
    if (st && k) k.text = st.sync_key;
  }
}

// ----------------------------------------------------------------- calendar / contacts / notes

async function pimProps(ctx: Ctx, kind: PimKind, id: string, opts: CollOptions): Promise<(WNode | null)[] | null> {
  const owner = ctx.actor.userId!;
  try {
    if (kind === 'calendar') return eventProps(await getEvent(ctx.env.DB, owner, id), opts.prefs);
    if (kind === 'contacts') return contactProps(await getContact(ctx.env.DB, owner, id), opts.prefs);
    return noteProps(await getNote(ctx.env.DB, owner, id), opts.prefs);
  } catch { return null; }
}

async function pimSave(ctx: Ctx, kind: PimKind, app: WNode | undefined, id?: string): Promise<{ id: string; version: number }> {
  const db = ctx.env.DB; const owner = ctx.actor.userId!;
  if (kind === 'calendar') {
    const prev = id ? await getEvent(db, owner, id) : undefined;
    const r = await saveEvent(db, owner, eventFromApp(app, prev), id);
    return { id: r.id, version: r.version };
  }
  if (kind === 'contacts') {
    const prev = id ? await getContact(db, owner, id) : undefined;
    const r = await saveContact(db, owner, contactFromApp(app, prev), id);
    return { id: r.id, version: r.version };
  }
  const prev = id ? await getNote(db, owner, id) : undefined;
  const r = await saveNote(db, owner, noteFromApp(app, prev), id);
  return { id: r.id, version: r.version };
}

async function syncPim(ctx: Ctx, kind: PimKind, coll: WNode, collId: string, key: string, storedKey: string, base: Snapshot,
  opts: CollOptions, globalWindow: number, quiet: boolean): Promise<{ node: WNode | null; changed: boolean }> {
  const original = { ...base };
  const known = base;
  const responses: WNode[] = [];
  const cmds = child(coll, 'AirSync:Commands');
  for (const c of cmds?.children ?? []) {
    const sid = textOf(c, 'AirSync:ServerId') ?? '';
    try {
      if (c.tag === 'AirSync:Add') {
        const r = await pimSave(ctx, kind, child(c, 'AirSync:ApplicationData'));
        known[r.id] = String(r.version);
        responses.push(el('AirSync:Add', el('AirSync:ClientId', textOf(c, 'AirSync:ClientId') ?? ''), el('AirSync:ServerId', r.id), el('AirSync:Status', 1)));
      } else if (c.tag === 'AirSync:Change') {
        const r = await pimSave(ctx, kind, child(c, 'AirSync:ApplicationData'), sid);
        known[r.id] = String(r.version);
      } else if (c.tag === 'AirSync:Delete') {
        await pimDelete(ctx.env.DB, kind, ctx.actor.userId!, sid);
        delete known[sid];
      } else if (c.tag === 'AirSync:Fetch') {
        const props = await pimProps(ctx, kind, sid, opts);
        responses.push(props
          ? el('AirSync:Fetch', el('AirSync:ServerId', sid), el('AirSync:Status', 1), el('AirSync:ApplicationData', props))
          : el('AirSync:Fetch', el('AirSync:ServerId', sid), el('AirSync:Status', 8)));
      }
    } catch {
      if (c.tag === 'AirSync:Add') responses.push(el('AirSync:Add', el('AirSync:ClientId', textOf(c, 'AirSync:ClientId') ?? ''), el('AirSync:Status', 6)));
      else responses.push(el(c.tag, el('AirSync:ServerId', sid), el('AirSync:Status', c.tag === 'AirSync:Change' ? 8 : 6)));
    }
  }

  const getChanges = flag(coll, 'AirSync:GetChanges') ?? true;
  const window = Math.max(1, Math.min(512, Number(textOf(coll, 'AirSync:WindowSize') ?? globalWindow)));
  const commands: WNode[] = [];
  let more = false;
  if (getChanges) {
    const cur = await currentItems(ctx, collId, opts.filterType);
    const d = diff(cur, known);
    let budget = window;
    for (const id of d.deletes) { if (budget-- <= 0) { more = true; break; } commands.push(el('AirSync:Delete', el('AirSync:ServerId', id))); delete known[id]; }
    for (const [list, tag] of [[d.changes, 'AirSync:Change'], [d.adds, 'AirSync:Add']] as const) {
      for (const id of list) {
        if (more || budget-- <= 0) { more = true; break; }
        const props = await pimProps(ctx, kind, id, opts);
        if (!props) continue;
        commands.push(el(tag, el('AirSync:ServerId', id), el('AirSync:ApplicationData', props)));
        known[id] = cur[id]!;
      }
    }
  }
  const changed = commands.length > 0 || responses.length > 0 || (cmds?.children.length ?? 0) > 0;
  if (quiet && !changed) return { node: null, changed: false };
  const newKey = String(Number(storedKey) + 1);
  await putState(ctx, collId, newKey, known, key, original, opts);
  return {
    node: el('AirSync:Collection', el('AirSync:SyncKey', newKey), el('AirSync:CollectionId', collId), el('AirSync:Status', 1),
      responses.length ? el('AirSync:Responses', responses) : null,
      more ? el('AirSync:MoreAvailable') : null,
      commands.length ? el('AirSync:Commands', commands) : null),
    changed: true,
  };
}

async function pendingFor(ctx: Ctx, collId: string): Promise<number | null> {
  const st = await getState(ctx, collId);
  if (!st || st.sync_key === '1' && st.snapshot === '{}') {
    // Not yet synced (or only primed): report whatever is there.
    const cur = await currentItems(ctx, collId, st?.options ? (JSON.parse(st.options) as CollOptions).filterType : 0);
    return st ? Object.keys(cur).length : null;
  }
  const opts = st.options ? JSON.parse(st.options) as CollOptions : readOptions(undefined);
  return diff(await currentItems(ctx, collId, opts.filterType), JSON.parse(st.snapshot) as Snapshot).count;
}

async function ping(ctx: Ctx, req: WNode | null): Promise<Response> {
  let folders = kids(child(req, 'Ping:Folders'), 'Ping:Folder').map((f) => textOf(f, 'Ping:Id') ?? '').filter(Boolean);
  let hb = Number(textOf(req, 'Ping:HeartbeatInterval') ?? 0);
  if (folders.length || hb) {
    const prev = ctx.device.ping_cache ? JSON.parse(ctx.device.ping_cache) as { folders: string[]; hb: number } : { folders: [], hb: 480 };
    if (!folders.length) folders = prev.folders;
    if (!hb) hb = prev.hb;
    await run(ctx.env.DB, `UPDATE eas_devices SET ping_cache = ?2 WHERE id = ?1`, ctx.device.id, JSON.stringify({ folders, hb }));
  } else if (ctx.device.ping_cache) {
    ({ folders, hb } = JSON.parse(ctx.device.ping_cache) as { folders: string[]; hb: number });
  }
  if (!folders.length) return wbxml(el('Ping:Ping', el('Ping:Status', 3))); // missing parameters
  const deadline = Date.now() + Math.min(MAX_WAIT_MS, (hb || 480) * 1000);
  for (;;) {
    const changed: string[] = [];
    for (const f of folders) {
      const n = await pendingFor(ctx, f);
      if (n === null) { changed.push(f); continue; } // never synced: let the client sync it
      if (n > 0) changed.push(f);
    }
    if (changed.length) return wbxml(el('Ping:Ping', el('Ping:Status', 2), el('Ping:Folders', changed.map((f) => el('Ping:Folder', f)))));
    if (Date.now() >= deadline) return wbxml(el('Ping:Ping', el('Ping:Status', 1)));
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

/** The phone already moved the item locally: update both snapshots so nothing is echoed back. */
async function moveInSnapshots(ctx: Ctx, id: string, srcColl: string, dstColl: string): Promise<void> {
  const src = await getState(ctx, srcColl);
  if (src) {
    const snap = JSON.parse(src.snapshot) as Snapshot;
    delete snap[id];
    await run(ctx.env.DB, `UPDATE eas_sync_state SET snapshot = ?3 WHERE device_pk = ?1 AND collection_id = ?2`, ctx.device.id, srcColl, JSON.stringify(snap));
  }
  const dst = await getState(ctx, dstColl);
  const row = await one<{ is_read: number; is_starred: number }>(ctx.env.DB, `SELECT is_read, is_starred FROM mail_messages WHERE id = ?1`, id);
  if (dst && row) {
    const snap = JSON.parse(dst.snapshot) as Snapshot;
    snap[id] = `${row.is_read ? 1 : 0}${row.is_starred ? 1 : 0}`;
    await run(ctx.env.DB, `UPDATE eas_sync_state SET snapshot = ?3 WHERE device_pk = ?1 AND collection_id = ?2`, ctx.device.id, dstColl, JSON.stringify(snap));
  }
}

async function getItemEstimate(ctx: Ctx, req: WNode | null): Promise<Response> {
  const out: WNode[] = [];
  for (const c of kids(child(req, 'GetItemEstimate:Collections'), 'GetItemEstimate:Collection')) {
    const id = textOf(c, 'GetItemEstimate:CollectionId') ?? textOf(c, 'AirSync:CollectionId') ?? '';
    if (!folderById(id)) { out.push(el('GetItemEstimate:Response', el('GetItemEstimate:Status', 2))); continue; }
    const n = await pendingFor(ctx, id);
    out.push(el('GetItemEstimate:Response', el('GetItemEstimate:Status', n === null ? 4 : 1),
      el('GetItemEstimate:Collection', el('GetItemEstimate:CollectionId', id), el('GetItemEstimate:Estimate', n ?? 0))));
  }
  return wbxml(el('GetItemEstimate:GetItemEstimate', out));
}

async function moveItems(ctx: Ctx, req: WNode | null): Promise<Response> {
  const out: WNode[] = [];
  for (const mv of kids(req, 'Move:Move')) {
    const src = textOf(mv, 'Move:SrcMsgId') ?? '';
    const dst = folderById(textOf(mv, 'Move:DstFldId'));
    if (!dst?.folder) { out.push(el('Move:Response', el('Move:SrcMsgId', src), el('Move:Status', 2))); continue; }
    const ok = await moveTo(ctx, src, dst.folder);
    if (ok) await moveInSnapshots(ctx, src, textOf(mv, 'Move:SrcFldId') ?? '', dst.id);
    out.push(el('Move:Response', el('Move:SrcMsgId', src), el('Move:Status', ok ? 3 : 1), ok ? el('Move:DstMsgId', src) : null));
  }
  return wbxml(el('Move:MoveItems', out));
}

function provision(ctx: Ctx, req: WNode | null): Promise<Response> | Response {
  const policy = child(child(req, 'Provision:Policies'), 'Provision:Policy');
  const type = textOf(policy, 'Provision:PolicyType') ?? 'MS-EAS-Provisioning-WBXML';
  const devInfo = child(req, 'Settings:DeviceInformation');
  const head = [el('Provision:Status', 1), devInfo ? el('Settings:DeviceInformation', el('Settings:Status', 1)) : null];
  if (!policy) return wbxml(el('Provision:Provision', head)); // remote-wipe ack or device info only
  const ack = textOf(policy, 'Provision:PolicyKey');
  const key = String((crypto.getRandomValues(new Uint32Array(1))[0]! | 1) >>> 0);
  return run(ctx.env.DB, `UPDATE eas_devices SET policy_key = ?2 WHERE id = ?1`, ctx.device.id, key).then(() => wbxml(el('Provision:Provision', head,
    el('Provision:Policies', el('Provision:Policy',
      el('Provision:PolicyType', type), el('Provision:Status', 1), el('Provision:PolicyKey', key),
      ack ? null : el('Provision:Data', el('Provision:EASProvisionDoc',
        el('Provision:DevicePasswordEnabled', 0), el('Provision:AttachmentsEnabled', 1), el('Provision:AllowSimpleDevicePassword', 1),
        el('Provision:AllowStorageCard', 1), el('Provision:AllowCamera', 1), el('Provision:RequireDeviceEncryption', 0),
        el('Provision:AllowHTMLEmail', 1), el('Provision:AllowBrowser', 1), el('Provision:AllowConsumerEmail', 1),
      )),
    )))));
}

async function settings(ctx: Ctx, req: WNode | null): Promise<Response> {
  const out: WNode[] = [el('Settings:Status', 1)];
  const dev = child(child(req, 'Settings:DeviceInformation'), 'Settings:Set');
  if (dev) {
    await run(ctx.env.DB, `UPDATE eas_devices SET model = ?2, friendly_name = ?3, os = ?4 WHERE id = ?1`, ctx.device.id,
      textOf(dev, 'Settings:Model')?.slice(0, 100) ?? null, textOf(dev, 'Settings:FriendlyName')?.slice(0, 100) ?? null, textOf(dev, 'Settings:OS')?.slice(0, 100) ?? null);
    out.push(el('Settings:DeviceInformation', el('Settings:Status', 1)));
  }
  if (child(req, 'Settings:UserInformation')) {
    const s = await mailSettings(ctx.env.DB);
    const addrs = senderAddresses(s, ctx.scope);
    const primary = ctx.scope.own ?? addrs[0] ?? ctx.actor.email;
    out.push(el('Settings:UserInformation', el('Settings:Status', 1), el('Settings:Get',
      ctx.version === '14.0'
        ? el('Settings:EmailAddresses', addrs.map((a) => el('Settings:SmtpAddress', a)))
        : el('Settings:Accounts', el('Settings:Account',
          el('Settings:UserDisplayName', ctx.actor.email),
          el('Settings:EmailAddresses', el('Settings:PrimarySmtpAddress', primary), addrs.filter((a) => a !== primary).map((a) => el('Settings:SmtpAddress', a))))),
    )));
  }
  if (child(req, 'Settings:Oof')) {
    out.push(el('Settings:Oof', el('Settings:Status', 1), child(child(req, 'Settings:Oof'), 'Settings:Get') ? el('Settings:Get', el('Settings:OofState', 0)) : null));
  }
  if (child(req, 'Settings:DevicePassword')) out.push(el('Settings:DevicePassword', el('Settings:Status', 1)));
  return wbxml(el('Settings:Settings', out));
}

const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

async function attachmentBytes(ctx: Ctx, ref: string): Promise<{ bytes: Uint8Array; mime: string; name: string } | null> {
  const [mailId, attId] = ref.split(':');
  if (!mailId || !attId) return null;
  const m = await getMail(ctx.env.DB, mailId, ctx.scope).catch(() => null);
  if (!m) return null;
  const a = (await attachmentsOf(ctx.env.DB, m.id)).find((x) => x.id === attId);
  const obj = a ? await ctx.env.ARCHIVE_BUCKET.get(a.r2_key) : null;
  return a && obj ? { bytes: new Uint8Array(await obj.arrayBuffer()), mime: a.mime_type, name: a.filename } : null;
}

async function itemOperations(ctx: Ctx, req: WNode | null): Promise<Response> {
  const out: WNode[] = [];
  const parts: Uint8Array[] = [];
  for (const op of req?.children ?? []) {
    if (op.tag === 'ItemOperations:Fetch') {
      const ref = textOf(op, 'AirSyncBase:FileReference');
      if (ref) {
        const a = await attachmentBytes(ctx, ref);
        if (!a) { out.push(el('ItemOperations:Fetch', el('ItemOperations:Status', 6), el('AirSyncBase:FileReference', ref))); continue; }
        let data: WNode;
        if (ctx.multipart) { parts.push(a.bytes); data = el('ItemOperations:Part', parts.length); } else data = el('ItemOperations:Data', b64(a.bytes));
        out.push(el('ItemOperations:Fetch', el('ItemOperations:Status', 1), el('AirSyncBase:FileReference', ref),
          el('ItemOperations:Properties', el('AirSyncBase:ContentType', a.mime), data)));
        continue;
      }
      const longId = textOf(op, 'Search:LongId');
      const sid = textOf(op, 'AirSync:ServerId') ?? longId ?? '';
      const coll = textOf(op, 'AirSync:CollectionId');
      if (coll && PIM[coll]) {
        const props = await pimProps(ctx, PIM[coll]!, sid, readOptions(child(op, 'ItemOperations:Options')));
        out.push(props
          ? el('ItemOperations:Fetch', el('ItemOperations:Status', 1), el('AirSync:CollectionId', coll), el('AirSync:ServerId', sid), el('AirSync:Class', CLASS_OF[PIM[coll]!]), el('ItemOperations:Properties', props))
          : el('ItemOperations:Fetch', el('ItemOperations:Status', 6), el('AirSync:CollectionId', coll), el('AirSync:ServerId', sid)));
        continue;
      }
      const m = await getMail(ctx.env.DB, sid, ctx.scope).catch(() => null);
      if (!m) { out.push(el('ItemOperations:Fetch', el('ItemOperations:Status', 6), longId ? el('Search:LongId', longId) : el('AirSync:ServerId', sid))); continue; }
      const opts = readOptions(child(op, 'ItemOperations:Options'));
      out.push(el('ItemOperations:Fetch', el('ItemOperations:Status', 1),
        longId ? el('Search:LongId', longId) : [el('AirSync:CollectionId', coll ?? idOfFolder(m.folder)), el('AirSync:ServerId', sid)],
        el('AirSync:Class', 'Email'), el('ItemOperations:Properties', await emailProps(ctx, m, opts))));
    } else if (op.tag === 'ItemOperations:EmptyFolderContents') {
      const coll = textOf(op, 'AirSync:CollectionId');
      if (coll === 'trash') {
        const p: unknown[] = [];
        const ids = await all<{ id: string }>(ctx.env.DB, `SELECT id FROM mail_messages WHERE folder = 'TRASH' AND ${scopeSql(ctx.scope, p)}`, ...p);
        for (const r of ids) await purgeMail(ctx.env, r.id);
        out.push(el('ItemOperations:EmptyFolderContents', el('ItemOperations:Status', 1), el('AirSync:CollectionId', coll)));
      } else out.push(el('ItemOperations:EmptyFolderContents', el('ItemOperations:Status', 2), el('AirSync:CollectionId', coll ?? '')));
    } else if (op.tag === 'ItemOperations:Move') {
      out.push(el('ItemOperations:Move', el('ItemOperations:Status', 2)));
    }
  }
  const node = el('ItemOperations:ItemOperations', el('ItemOperations:Status', 1), el('ItemOperations:Response', out));
  return ctx.multipart && parts.length ? multipart(node, parts) : wbxml(node);
}

async function search(ctx: Ctx, req: WNode | null): Promise<Response> {
  const store = child(req, 'Search:Store');
  const name = (textOf(store, 'Search:Name') ?? '').toLowerCase();
  const query = child(store, 'Search:Query');
  const and = child(query, 'Search:And') ?? query;
  const q = (textOf(and, 'Search:FreeText') ?? query?.text ?? '').trim();
  const coll = textOf(and, 'AirSync:CollectionId');
  const [from, to] = (textOf(child(store, 'Search:Options'), 'Search:Range') ?? '0-49').split('-').map(Number);
  const opts = readOptions(child(store, 'Search:Options'), { filterType: 0, prefs: [{ type: 1, truncation: 2048 }], mime: 0 });
  const results: WNode[] = [];
  let total = 0;
  if (name === 'gal' && q) {
    // Recipient lookup: own contacts (+ customers for business users).
    const hits = await suggestAddresses(ctx.env.DB, ctx.actor.userId!, q, ctx.actor.role !== 'MAIL_USER');
    total = hits.length;
    for (const h of hits.slice(from ?? 0, (to ?? 49) + 1)) {
      results.push(el('Search:Result', el('Search:Properties', el('GAL:DisplayName', h.name || h.email), el('GAL:EmailAddress', h.email))));
    }
  } else if (name === 'mailbox' && q) {
    const folders = coll && folderById(coll)?.folder ? [folderById(coll)!.folder!] : ['INBOX', 'SENT', 'ARCHIVE'];
    const hits: { id: string; folder: string; created_at: string }[] = [];
    for (const f of folders) {
      const r = await listMail(ctx.env.DB, ctx.scope, { folder: f as 'INBOX', q, limit: 100, offset: 0 });
      hits.push(...(r.rows as unknown as { id: string; folder: string; created_at: string }[]));
    }
    hits.sort((a, b) => b.created_at.localeCompare(a.created_at));
    total = hits.length;
    for (const h of hits.slice(from ?? 0, (to ?? 49) + 1)) {
      const m = await getMail(ctx.env.DB, h.id, ctx.scope).catch(() => null);
      if (!m) continue;
      results.push(el('Search:Result', el('AirSync:Class', 'Email'), el('Search:LongId', m.id), el('AirSync:CollectionId', idOfFolder(m.folder)),
        el('Search:Properties', await emailProps(ctx, m, opts))));
    }
  }
  return wbxml(el('Search:Search', el('Search:Status', 1), el('Search:Response', el('Search:Store', el('Search:Status', 1),
    results.length ? results : el('Search:Result'),
    results.length ? el('Search:Range', `${from ?? 0}-${(from ?? 0) + results.length - 1}`) : null,
    el('Search:Total', total)))));
}

// ----------------------------------------------------------------- sending

async function compose(ctx: Ctx, cmd: 'SendMail' | 'SmartReply' | 'SmartForward', reqNode: WNode | null, rawBody: Uint8Array, contentType: string, params: Record<string, string>): Promise<Response> {
  const tag = `ComposeMail:${cmd}`;
  const fail = (status: number) => wbxml(el(tag, el('ComposeMail:Status', status)));
  let mime: Uint8Array | undefined;
  let sourceId = params.ItemId ?? params.LongId;
  let replace = false;
  if (contentType.includes('message/rfc822')) mime = rawBody;
  else {
    mime = child(reqNode, 'ComposeMail:Mime')?.bytes;
    const src = child(reqNode, 'ComposeMail:Source');
    sourceId = textOf(src, 'ComposeMail:ItemId') ?? textOf(src, 'ComposeMail:LongId') ?? sourceId;
    replace = !!child(reqNode, 'ComposeMail:ReplaceMime');
  }
  if (!mime?.length) return fail(103);

  const parsed = parseEmail(mime);
  const h = parsed.headers;
  const bodies = bodiesOf(parsed);
  const to = h['to'] ?? '';
  const cc = h['cc'] ?? '';
  const bcc = h['bcc'] ?? '';
  if (!(to + cc + bcc).trim()) return fail(119);
  let text = bodies.text ?? '';
  let html = bodies.html ?? undefined;

  let original: MailRow | null = null;
  if (cmd !== 'SendMail' && sourceId) {
    original = await getMail(ctx.env.DB, sourceId, ctx.scope).catch(() => null);
    if (!original) return fail(150); // ItemNotFound
    if (!replace) {
      // Smart reply/forward: the server appends the original message.
      const hdr = `\n\n-----Original Message-----\nFrom: ${fmtAddr(original.from_name, original.from_email)}\nSent: ${original.created_at}\nTo: ${original.to_email ?? ''}\nSubject: ${original.subject ?? ''}\n\n`;
      text += hdr + (original.text_body ?? '');
      if (html) html += `<hr><div>${escapeHtml(hdr).replace(/\n/g, '<br>')}</div>${original.html_body ?? escapeHtml(original.text_body ?? '').replace(/\n/g, '<br>')}`;
    }
  }
  const fromAddr = parseAddress(h['from'] ?? null).email?.toLowerCase();
  const allowed = senderAddresses(await mailSettings(ctx.env.DB), ctx.scope);
  const from = fromAddr && allowed.includes(fromAddr) ? fromAddr : ctx.scope.own ?? allowed[0];
  if (!from) return fail(120);
  try {
    const res = await sendMail(ctx.env, {
      from, to, ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}),
      subject: parsed.subject ?? '', text, ...(html ? { html } : {}),
      attachments: bodies.attachments.map((a) => ({ filename: a.filename ?? 'attachment', mime: a.contentType || 'application/octet-stream', data: b64(a.body) })),
      ...(cmd === 'SmartReply' && original ? { reply_to_id: original.id } : {}),
      ...(cmd === 'SmartForward' && original && !replace ? { forward_id: original.id } : {}),
    }, `${ctx.actor.email} (ActiveSync)`, ctx.scope);
    if (res.status !== 'SENT') return fail(120);
  } catch (err) {
    return fail(err instanceof AppError && err.code === 'PAYLOAD_TOO_LARGE' ? 113 : 120);
  }
  return wbxml(null);
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

// ----------------------------------------------------------------- routes

export const easRoutes = new Hono<HonoEnv>();

const optionsResponse = () => new Response(null, {
  headers: {
    'MS-Server-ActiveSync': '14.1', 'MS-ASProtocolVersions': VERSIONS, 'MS-ASProtocolCommands': COMMANDS,
    Allow: 'OPTIONS,POST', Public: 'OPTIONS,POST', 'Cache-Control': 'private',
  },
});

async function handle(c: Context<HonoEnv>): Promise<Response> {
  const env = c.env;
  let actor: Actor | null;
  try {
    actor = await authenticate(env, c.req.header('Authorization'));
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') return new Response('Locked', { status: 503, headers: { 'Retry-After': '900' } });
    return unauthorized();
  }
  if (!actor) return unauthorized();
  if (c.req.method === 'OPTIONS') return optionsResponse();

  const url = new URL(c.req.url);
  const req = parseQuery(url);
  if (!req || !req.deviceId) return new Response('Bad request', { status: 400 });
  const version = c.req.header('MS-ASProtocolVersion') ?? '14.1';
  const device = await loadDevice(env, actor.userId!, req, c.req.header('User-Agent'), version);
  if (device.blocked) return new Response('Device blocked', { status: 403 });

  const raw = new Uint8Array(await c.req.arrayBuffer());
  const contentType = c.req.header('Content-Type') ?? '';
  const node = raw.length && !contentType.includes('message/rfc822') ? decode(raw) : null;
  const ctx: Ctx = {
    env, actor, scope: await scopeFor(env.DB, actor), device, version,
    multipart: (c.req.header('MS-ASAcceptMultiPart') ?? req.params.AcceptMultiPart ?? '').toUpperCase() === 'T',
    waitUntil: (p) => c.executionCtx.waitUntil(p),
  };

  switch (req.cmd) {
    case 'FolderSync': return folderSync(ctx, node);
    case 'Sync': {
      if (!node && ctx.device.sync_cache) {
        const cached = decodeCache(ctx.device.sync_cache);
        await refreshCachedKeys(ctx, cached);
        ctx.device.sync_cache = cached ? JSON.stringify(cached) : null;
      }
      return sync(ctx, node);
    }
    case 'Ping': return ping(ctx, node);
    case 'GetItemEstimate': return getItemEstimate(ctx, node);
    case 'MoveItems': return moveItems(ctx, node);
    case 'Provision': return provision(ctx, node);
    case 'Settings': return settings(ctx, node);
    case 'ItemOperations': return itemOperations(ctx, node);
    case 'Search': return search(ctx, node);
    case 'SendMail': case 'SmartReply': case 'SmartForward': return compose(ctx, req.cmd, node, raw, contentType, req.params);
    case 'GetAttachment': {
      const a = await attachmentBytes(ctx, req.params.AttachmentName ?? '');
      return a ? new Response(a.bytes.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': a.mime, 'MS-Server-ActiveSync': '14.1' } }) : new Response(null, { status: 500 });
    }
    case 'FolderCreate': case 'FolderDelete': case 'FolderUpdate':
      return wbxml(el(`FolderHierarchy:${req.cmd}`, el('FolderHierarchy:Status', 6)));
    default:
      return new Response('Not implemented', { status: 501 });
  }
}

easRoutes.on(['OPTIONS', 'POST'], EAS_PATH, handle);
easRoutes.on(['OPTIONS', 'POST'], EAS_PATH.toLowerCase(), handle);

/** Autodiscover (mobilesync schema) so apps can find the server from the address alone. */
async function autodiscover(c: Context<HonoEnv>): Promise<Response> {
  let actor: Actor | null = null;
  try { actor = await authenticate(c.env, c.req.header('Authorization')); } catch { /* fall through */ }
  if (!actor) return unauthorized();
  const body = await c.req.text();
  const email = /<EMailAddress>([^<]+)<\/EMailAddress>/i.exec(body)?.[1] ?? actor.mailAddress ?? actor.email;
  const url = `https://${new URL(c.req.url).host}${EAS_PATH}`;
  const x = (s: string) => s.replace(/[<>&"]/g, '');
  return new Response(`<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006">
    <Culture>en:us</Culture>
    <User><DisplayName>${x(actor.email)}</DisplayName><EMailAddress>${x(email)}</EMailAddress></User>
    <Action><Settings><Server><Type>MobileSync</Type><Url>${url}</Url><Name>${url}</Name></Server></Settings></Action>
  </Response>
</Autodiscover>`, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}
for (const p of ['/autodiscover/autodiscover.xml', '/Autodiscover/Autodiscover.xml', '/AutoDiscover/AutoDiscover.xml']) easRoutes.post(p, autodiscover);

