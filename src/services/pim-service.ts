/**
 * Personal information: calendar events, contacts and notes. Every row belongs to
 * one user (owner_id); the web app and ActiveSync phones read and write the same rows.
 * `version` increases on every change so phones can detect edits.
 */
import { all, one, run } from '../db/client';
import { newId } from '../lib/ids';
import { AppError } from '../lib/errors';

export type PimKind = 'calendar' | 'contacts' | 'notes';
const TABLE: Record<PimKind, string> = { calendar: 'pim_events', contacts: 'pim_contacts', notes: 'pim_notes' };
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** ActiveSync recurrence (MS-ASDTYPE): 0 daily, 1 weekly, 2 monthly, 3 monthly nth weekday, 5 yearly, 6 yearly nth weekday. */
export interface Recurrence {
  type: number; interval?: number; until?: string; occurrences?: number;
  dayOfWeek?: number; dayOfMonth?: number; weekOfMonth?: number; monthOfYear?: number;
}
export interface Attendee { email: string; name?: string; status?: number; type?: number }

export interface EventRow {
  id: string; owner_id: string; uid: string | null; subject: string; location: string | null; body: string | null;
  start_at: string; end_at: string; all_day: number; tz_blob: string | null; reminder_min: number | null;
  busy_status: number; sensitivity: number; recurrence_json: string | null; attendees_json: string | null;
  organizer_name: string | null; organizer_email: string | null; categories_json: string | null; version: number; created_at: string; updated_at: string;
}
export interface EventInput {
  subject: string; location?: string | null; body?: string | null; start_at: string; end_at: string; all_day?: boolean;
  tz_blob?: string | null; reminder_min?: number | null; busy_status?: number; sensitivity?: number; recurrence?: Recurrence | null;
  attendees?: Attendee[] | null; organizer_name?: string | null; organizer_email?: string | null; categories?: string[] | null; uid?: string | null;
}

export interface ContactRow {
  id: string; owner_id: string; display_name: string; email: string | null; phone: string | null; company: string | null;
  data_json: string; body: string | null; categories_json: string | null; version: number; created_at: string; updated_at: string;
}
/** Contact fields use the ActiveSync names (FirstName, Email1Address, MobilePhoneNumber, …). */
export type ContactData = Record<string, string>;
export interface ContactInput { data: ContactData; body?: string | null; categories?: string[] | null }

export interface NoteRow { id: string; owner_id: string; subject: string; body: string; categories_json: string | null; version: number; created_at: string; updated_at: string }
export interface NoteInput { subject: string; body: string; categories?: string[] | null }

const json = (v: unknown) => (v === null || v === undefined || (Array.isArray(v) && !v.length) ? null : JSON.stringify(v));
const iso = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new AppError('VALIDATION_ERROR', 'invalid date', { date: 'invalid' });
  return d.toISOString();
};

// ------------------------------------------------------------------ shared

/** id → version for every item of a kind (what a phone compares against). */
export async function pimVersions(db: D1Database, kind: PimKind, owner: string): Promise<Record<string, string>> {
  const rows = await all<{ id: string; version: number }>(db, `SELECT id, version FROM ${TABLE[kind]} WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 5000`, owner);
  return Object.fromEntries(rows.map((r) => [r.id, String(r.version)]));
}

export async function pimDelete(db: D1Database, kind: PimKind, owner: string, id: string): Promise<boolean> {
  const r = await db.prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ?1 AND owner_id = ?2`).bind(id, owner).run();
  return (r.meta.changes ?? 0) > 0;
}

// ------------------------------------------------------------------ calendar

export function listEvents(db: D1Database, owner: string, from?: string, to?: string): Promise<EventRow[]> {
  if (!from || !to) return all<EventRow>(db, `SELECT * FROM pim_events WHERE owner_id = ?1 ORDER BY start_at`, owner);
  // Recurring events are always returned; the client expands them for the visible range.
  return all<EventRow>(db, `SELECT * FROM pim_events WHERE owner_id = ?1 AND (recurrence_json IS NOT NULL OR (start_at < ?3 AND end_at > ?2)) ORDER BY start_at`,
    owner, iso(from), iso(to));
}

export async function getEvent(db: D1Database, owner: string, id: string): Promise<EventRow> {
  const e = await one<EventRow>(db, `SELECT * FROM pim_events WHERE id = ?1 AND owner_id = ?2`, id, owner);
  if (!e) throw new AppError('NOT_FOUND');
  return e;
}

export async function saveEvent(db: D1Database, owner: string, input: EventInput, id?: string): Promise<EventRow> {
  const start = iso(input.start_at);
  let end = iso(input.end_at);
  if (end < start) end = start;
  const vals = [
    input.subject.slice(0, 500), input.location ?? null, input.body ?? null, start, end, input.all_day ? 1 : 0, input.tz_blob ?? null,
    input.reminder_min ?? null, input.busy_status ?? 2, input.sensitivity ?? 0, json(input.recurrence), json(input.attendees),
    input.organizer_name ?? null, input.organizer_email ?? null, json(input.categories),
  ];
  if (id) {
    const r = await db.prepare(`UPDATE pim_events SET subject=?3, location=?4, body=?5, start_at=?6, end_at=?7, all_day=?8, tz_blob=?9, reminder_min=?10,
      busy_status=?11, sensitivity=?12, recurrence_json=?13, attendees_json=?14, organizer_name=?15, organizer_email=?16, categories_json=?17,
      uid=coalesce(?18, uid), version=version+1, updated_at=${NOW} WHERE id=?1 AND owner_id=?2`).bind(id, owner, ...vals, input.uid ?? null).run();
    if (!r.meta.changes) throw new AppError('NOT_FOUND');
    return getEvent(db, owner, id);
  }
  const nid = newId('evt');
  await run(db, `INSERT INTO pim_events (id, owner_id, subject, location, body, start_at, end_at, all_day, tz_blob, reminder_min, busy_status, sensitivity,
    recurrence_json, attendees_json, organizer_name, organizer_email, categories_json, uid) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`,
  nid, owner, ...vals, input.uid || crypto.randomUUID().replace(/-/g, '').toUpperCase());
  return getEvent(db, owner, nid);
}

// ------------------------------------------------------------------ contacts

/** Strip `"Name" <a@b>` to the bare address. */
export const bareEmail = (v: string | undefined) => (v ? (/<([^>]+)>/.exec(v)?.[1] ?? v).trim().toLowerCase() : null);

function contactSummary(d: ContactData) {
  const name = (d.FileAs || [d.FirstName, d.MiddleName, d.LastName].filter(Boolean).join(' ') || d.CompanyName || bareEmail(d.Email1Address) || '').trim();
  return {
    display_name: name.slice(0, 300),
    email: bareEmail(d.Email1Address || d.Email2Address || d.Email3Address),
    phone: d.MobilePhoneNumber || d.BusinessPhoneNumber || d.HomePhoneNumber || null,
    company: d.CompanyName || null,
  };
}

export function listContacts(db: D1Database, owner: string, q?: string): Promise<ContactRow[]> {
  if (!q) return all<ContactRow>(db, `SELECT * FROM pim_contacts WHERE owner_id = ?1 ORDER BY lower(display_name) LIMIT 5000`, owner);
  const like = `%${q.toLowerCase()}%`;
  return all<ContactRow>(db, `SELECT * FROM pim_contacts WHERE owner_id = ?1 AND (lower(display_name) LIKE ?2 OR lower(coalesce(email,'')) LIKE ?2
    OR lower(coalesce(company,'')) LIKE ?2 OR coalesce(phone,'') LIKE ?2 OR lower(data_json) LIKE ?2) ORDER BY lower(display_name) LIMIT 500`, owner, like);
}

export async function getContact(db: D1Database, owner: string, id: string): Promise<ContactRow> {
  const c = await one<ContactRow>(db, `SELECT * FROM pim_contacts WHERE id = ?1 AND owner_id = ?2`, id, owner);
  if (!c) throw new AppError('NOT_FOUND');
  return c;
}

export async function saveContact(db: D1Database, owner: string, input: ContactInput, id?: string): Promise<ContactRow> {
  const data: ContactData = {};
  for (const [k, v] of Object.entries(input.data)) {
    if (/^[A-Za-z0-9]{1,40}$/.test(k) && typeof v === 'string' && v.trim()) data[k] = v.slice(0, k === 'Picture' ? 100_000 : 2000);
  }
  const s = contactSummary(data);
  if (!s.display_name && !s.phone) throw new AppError('VALIDATION_ERROR', 'empty contact', { FirstName: 'required' });
  const vals = [s.display_name, s.email, s.phone, s.company, JSON.stringify(data), input.body ?? null, json(input.categories)];
  if (id) {
    const r = await db.prepare(`UPDATE pim_contacts SET display_name=?3, email=?4, phone=?5, company=?6, data_json=?7, body=?8, categories_json=?9,
      version=version+1, updated_at=${NOW} WHERE id=?1 AND owner_id=?2`).bind(id, owner, ...vals).run();
    if (!r.meta.changes) throw new AppError('NOT_FOUND');
    return getContact(db, owner, id);
  }
  const nid = newId('con');
  await run(db, `INSERT INTO pim_contacts (id, owner_id, display_name, email, phone, company, data_json, body, categories_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`, nid, owner, ...vals);
  return getContact(db, owner, nid);
}

// ------------------------------------------------------------------ notes

export function listNotes(db: D1Database, owner: string, q?: string): Promise<NoteRow[]> {
  if (!q) return all<NoteRow>(db, `SELECT * FROM pim_notes WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 2000`, owner);
  const like = `%${q.toLowerCase()}%`;
  return all<NoteRow>(db, `SELECT * FROM pim_notes WHERE owner_id = ?1 AND (lower(subject) LIKE ?2 OR lower(body) LIKE ?2) ORDER BY updated_at DESC LIMIT 500`, owner, like);
}

export async function getNote(db: D1Database, owner: string, id: string): Promise<NoteRow> {
  const n = await one<NoteRow>(db, `SELECT * FROM pim_notes WHERE id = ?1 AND owner_id = ?2`, id, owner);
  if (!n) throw new AppError('NOT_FOUND');
  return n;
}

export async function saveNote(db: D1Database, owner: string, input: NoteInput, id?: string): Promise<NoteRow> {
  const subject = (input.subject.trim() || input.body.trim().split('\n')[0] || '').slice(0, 300);
  const vals = [subject, input.body.slice(0, 200_000), json(input.categories)];
  if (id) {
    const r = await db.prepare(`UPDATE pim_notes SET subject=?3, body=?4, categories_json=?5, version=version+1, updated_at=${NOW} WHERE id=?1 AND owner_id=?2`)
      .bind(id, owner, ...vals).run();
    if (!r.meta.changes) throw new AppError('NOT_FOUND');
    return getNote(db, owner, id);
  }
  const nid = newId('note');
  await run(db, `INSERT INTO pim_notes (id, owner_id, subject, body, categories_json) VALUES (?1,?2,?3,?4,?5)`, nid, owner, ...vals);
  return getNote(db, owner, nid);
}

/** Address suggestions for composing mail: own contacts, plus customers for business users. */
export async function suggestAddresses(db: D1Database, owner: string, q: string, withCustomers: boolean): Promise<{ name: string; email: string }[]> {
  const like = `%${q.toLowerCase()}%`;
  const own = await all<{ name: string; email: string }>(db, `SELECT display_name name, email FROM pim_contacts WHERE owner_id = ?1 AND email IS NOT NULL
    AND (lower(display_name) LIKE ?2 OR lower(email) LIKE ?2) ORDER BY lower(display_name) LIMIT 20`, owner, like);
  const cust = withCustomers ? await all<{ name: string; email: string }>(db, `SELECT coalesce(nullif(company_name,''), trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) name, email FROM customers
    WHERE email IS NOT NULL AND email != '' AND (lower(coalesce(company_name,'') || ' ' || coalesce(first_name,'') || ' ' || coalesce(last_name,'')) LIKE ?1
    OR lower(email) LIKE ?1) ORDER BY 1 LIMIT 20`, like).catch(() => []) : [];
  const seen = new Set<string>();
  return [...own, ...cust].filter((r) => r.email && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase())).slice(0, 25);
}
