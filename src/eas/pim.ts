/** ActiveSync ⇄ database mapping for calendar, contacts and notes. */
import { child, el, hasTag, kids, textOf, type WNode } from './wbxml';
import type { Attendee, ContactRow, EventInput, EventRow, NoteRow, Recurrence, TaskInput, TaskRow } from '../services/pim-service';

/** TIME_ZONE_INFORMATION for UTC (172 zero bytes): times are sent in UTC and phones convert. */
export const UTC_TZ = btoa('\0'.repeat(172));

/** 2026-11-07T10:00:00.000Z → 20261107T100000Z (calendar wire format). */
export const toCompact = (isoStr: string) => isoStr.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');
/** Accepts the compact form and plain ISO. */
export function fromCompact(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(v.trim());
  const d = new Date(m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

interface BodyPref { type: number; truncation?: number }

function bodyNode(text: string | null, prefs: BodyPref[]): WNode {
  const pref = prefs.find((p) => p.type === 1) ?? { type: 1 };
  const data = new TextEncoder().encode(text ?? '');
  const cut = pref.truncation !== undefined && data.length > pref.truncation;
  return el('AirSyncBase:Body', el('AirSyncBase:Type', 1), el('AirSyncBase:EstimatedDataSize', data.length),
    cut ? el('AirSyncBase:Truncated', 1) : null,
    pref.truncation === 0 ? null : el('AirSyncBase:Data', new TextDecoder().decode(cut ? data.slice(0, pref.truncation) : data)));
}
/** Body text sent by a phone; `undefined` when the element is absent (keep the stored body). */
function bodyIn(app: WNode | undefined, legacyTag: string): string | undefined {
  const b = child(app, 'AirSyncBase:Body');
  if (b) return textOf(b, 'AirSyncBase:Data') ?? '';
  return textOf(app, legacyTag);
}
const categoriesIn = (n: WNode | undefined, page: string) => {
  const c = child(n, `${page}:Categories`);
  return c ? kids(c, `${page}:Category`).map((x) => x.text ?? '').filter(Boolean) : undefined;
};
const categoriesOut = (json: string | null, page: string) => {
  const list = json ? (JSON.parse(json) as string[]) : [];
  return list.length ? el(`${page}:Categories`, list.map((x) => el(`${page}:Category`, x))) : null;
};

// ------------------------------------------------------------------ calendar

export function eventProps(e: EventRow, prefs: BodyPref[]): (WNode | null)[] {
  const r = e.recurrence_json ? (JSON.parse(e.recurrence_json) as Recurrence) : null;
  const att = e.attendees_json ? (JSON.parse(e.attendees_json) as Attendee[]) : [];
  return [
    el('Calendar:TimeZone', e.tz_blob || UTC_TZ),
    el('Calendar:DtStamp', toCompact(e.updated_at)),
    el('Calendar:StartTime', toCompact(e.start_at)),
    el('Calendar:Subject', e.subject),
    el('Calendar:UID', e.uid ?? e.id),
    e.organizer_name ? el('Calendar:OrganizerName', e.organizer_name) : null,
    e.organizer_email ? el('Calendar:OrganizerEmail', e.organizer_email) : null,
    att.length ? el('Calendar:Attendees', att.map((a) => el('Calendar:Attendee', el('Calendar:Email', a.email), el('Calendar:Name', a.name || a.email),
      a.status !== undefined ? el('Calendar:AttendeeStatus', a.status) : null, el('Calendar:AttendeeType', a.type ?? 1)))) : null,
    e.location ? el('Calendar:Location', e.location) : null,
    el('Calendar:EndTime', toCompact(e.end_at)),
    r ? el('Calendar:Recurrence',
      el('Calendar:Type', r.type),
      el('Calendar:Interval', r.interval ?? 1),
      r.until ? el('Calendar:Until', toCompact(r.until)) : null,
      r.occurrences ? el('Calendar:Occurrences', r.occurrences) : null,
      r.dayOfWeek ? el('Calendar:DayOfWeek', r.dayOfWeek) : null,
      r.dayOfMonth ? el('Calendar:DayOfMonth', r.dayOfMonth) : null,
      r.weekOfMonth ? el('Calendar:WeekOfMonth', r.weekOfMonth) : null,
      r.monthOfYear ? el('Calendar:MonthOfYear', r.monthOfYear) : null) : null,
    bodyNode(e.body, prefs),
    el('Calendar:Sensitivity', e.sensitivity),
    el('Calendar:BusyStatus', e.busy_status),
    el('Calendar:AllDayEvent', e.all_day),
    e.reminder_min !== null ? el('Calendar:Reminder', e.reminder_min) : null,
    el('Calendar:MeetingStatus', att.length ? 1 : 0),
    categoriesOut(e.categories_json, 'Calendar'),
  ];
}

export function eventFromApp(app: WNode | undefined, prev?: EventRow): EventInput {
  const n = (tag: string) => { const v = textOf(app, `Calendar:${tag}`); return v === undefined || v === '' ? undefined : Number(v); };
  const rec = child(app, 'Calendar:Recurrence');
  const recurrence: Recurrence | null = rec ? {
    type: Number(textOf(rec, 'Calendar:Type') ?? 0),
    ...(textOf(rec, 'Calendar:Interval') ? { interval: Number(textOf(rec, 'Calendar:Interval')) } : {}),
    ...(fromCompact(textOf(rec, 'Calendar:Until')) ? { until: fromCompact(textOf(rec, 'Calendar:Until'))! } : {}),
    ...(textOf(rec, 'Calendar:Occurrences') ? { occurrences: Number(textOf(rec, 'Calendar:Occurrences')) } : {}),
    ...(textOf(rec, 'Calendar:DayOfWeek') ? { dayOfWeek: Number(textOf(rec, 'Calendar:DayOfWeek')) } : {}),
    ...(textOf(rec, 'Calendar:DayOfMonth') ? { dayOfMonth: Number(textOf(rec, 'Calendar:DayOfMonth')) } : {}),
    ...(textOf(rec, 'Calendar:WeekOfMonth') ? { weekOfMonth: Number(textOf(rec, 'Calendar:WeekOfMonth')) } : {}),
    ...(textOf(rec, 'Calendar:MonthOfYear') ? { monthOfYear: Number(textOf(rec, 'Calendar:MonthOfYear')) } : {}),
  } : null;
  const attendees = child(app, 'Calendar:Attendees')
    ? kids(child(app, 'Calendar:Attendees'), 'Calendar:Attendee').map((a) => ({
      email: textOf(a, 'Calendar:Email') ?? '', name: textOf(a, 'Calendar:Name') ?? '',
      ...(textOf(a, 'Calendar:AttendeeStatus') ? { status: Number(textOf(a, 'Calendar:AttendeeStatus')) } : {}),
      ...(textOf(a, 'Calendar:AttendeeType') ? { type: Number(textOf(a, 'Calendar:AttendeeType')) } : {}),
    })).filter((a) => a.email)
    : null;
  const start = fromCompact(textOf(app, 'Calendar:StartTime')) ?? prev?.start_at ?? new Date().toISOString();
  const body = bodyIn(app, 'Calendar:Body');
  return {
    subject: textOf(app, 'Calendar:Subject') ?? '',
    location: textOf(app, 'Calendar:Location') ?? null,
    body: body ?? prev?.body ?? null,
    start_at: start,
    end_at: fromCompact(textOf(app, 'Calendar:EndTime')) ?? start,
    all_day: n('AllDayEvent') === 1,
    tz_blob: textOf(app, 'Calendar:TimeZone') ?? prev?.tz_blob ?? null,
    reminder_min: n('Reminder') ?? null,
    busy_status: n('BusyStatus') ?? 2,
    sensitivity: n('Sensitivity') ?? 0,
    recurrence,
    attendees,
    organizer_name: textOf(app, 'Calendar:OrganizerName') ?? prev?.organizer_name ?? null,
    organizer_email: textOf(app, 'Calendar:OrganizerEmail') ?? prev?.organizer_email ?? null,
    categories: categoriesIn(app, 'Calendar') ?? null,
    uid: textOf(app, 'Calendar:UID') ?? null,
  };
}

// ------------------------------------------------------------------ contacts

/** Scalar contact fields that round-trip (everything except nested/structured ones). */
const CONTACT_SKIP = new Set(['Body', 'BodySize', 'BodyTruncated', 'Categories', 'Category', 'Children', 'Child', 'CompressedRTF']);

export function contactProps(c: ContactRow, prefs: BodyPref[]): (WNode | null)[] {
  const data = JSON.parse(c.data_json) as Record<string, string>;
  return [
    // Only real ActiveSync contact fields: one unknown key would make the whole Sync response fail to encode.
    ...Object.entries(data).filter(([k, v]) => !CONTACT_SKIP.has(k) && hasTag(`Contacts:${k}`) && typeof v === 'string' && v !== '')
      .map(([k, v]) => el(`Contacts:${k}`, v)),
    c.body ? bodyNode(c.body, prefs) : null,
    categoriesOut(c.categories_json, 'Contacts'),
  ];
}

export function contactFromApp(app: WNode | undefined, prev?: ContactRow): { data: Record<string, string>; body: string | null; categories: string[] | null } {
  const data: Record<string, string> = {};
  for (const n of app?.children ?? []) {
    if (!n.tag.startsWith('Contacts:')) continue;
    const k = n.tag.slice(9);
    if (CONTACT_SKIP.has(k) || n.children.length) continue;
    if (n.text) data[k] = n.text;
  }
  const body = bodyIn(app, 'Contacts:Body');
  return { data, body: body ?? prev?.body ?? null, categories: categoriesIn(app, 'Contacts') ?? null };
}

// ------------------------------------------------------------------ notes

export function noteProps(n: NoteRow, prefs: BodyPref[]): (WNode | null)[] {
  return [
    el('Notes:Subject', n.subject),
    bodyNode(n.body, prefs),
    el('Notes:MessageClass', 'IPM.StickyNote'),
    el('Notes:LastModifiedDate', n.updated_at.replace(/(\.\d{3})\d*Z$/, '$1Z')),
    categoriesOut(n.categories_json, 'Notes'),
  ];
}

export function noteFromApp(app: WNode | undefined, prev?: NoteRow): { subject: string; body: string; categories: string[] | null } {
  return {
    subject: textOf(app, 'Notes:Subject') ?? prev?.subject ?? '',
    body: bodyIn(app, 'Notes:Body') ?? prev?.body ?? '',
    categories: categoriesIn(app, 'Notes') ?? null,
  };
}

// ------------------------------------------------------------------ tasks

/** Task dates use the long ISO form. DueDate/StartDate are the user's local date written as if UTC. */
const longIso = (v: string) => new Date(v).toISOString();
const localMidnight = (ymd: string) => `${ymd}T00:00:00.000Z`;
const TASK_REC = ['Type', 'Start', 'Until', 'Occurrences', 'Interval', 'DayOfMonth', 'DayOfWeek', 'WeekOfMonth', 'MonthOfYear', 'Regenerate', 'DeadOccur'] as const;

export function taskProps(t: TaskRow, prefs: BodyPref[]): (WNode | null)[] {
  const rec = t.recurrence_json ? (JSON.parse(t.recurrence_json) as Record<string, string>) : null;
  return [
    bodyNode(t.body, prefs),
    el('Tasks:Complete', t.complete ? 1 : 0),
    t.complete && t.completed_at ? el('Tasks:DateCompleted', longIso(t.completed_at)) : null,
    t.due_date ? el('Tasks:DueDate', localMidnight(t.due_date)) : null,
    t.due_date ? el('Tasks:UtcDueDate', longIso(t.due_utc ?? localMidnight(t.due_date))) : null,
    el('Tasks:Importance', t.importance),
    rec ? el('Tasks:Recurrence', TASK_REC.filter((k) => rec[k] !== undefined).map((k) => el(`Tasks:${k}`, rec[k]!))) : null,
    el('Tasks:ReminderSet', t.reminder_at ? 1 : 0),
    t.reminder_at ? el('Tasks:ReminderTime', longIso(t.reminder_at)) : null,
    el('Tasks:Sensitivity', t.sensitivity),
    t.start_date ? el('Tasks:StartDate', localMidnight(t.start_date)) : null,
    t.start_date ? el('Tasks:UtcStartDate', longIso(t.start_utc ?? localMidnight(t.start_date))) : null,
    el('Tasks:Subject', t.subject),
    categoriesOut(t.categories_json, 'Tasks'),
  ];
}

export function taskFromApp(app: WNode | undefined, prev?: TaskRow): TaskInput {
  const v = (tag: string) => { const x = textOf(app, `Tasks:${tag}`); return x === undefined || x === '' ? undefined : x; };
  const date = (local?: string, utc?: string) => {
    const l = fromCompact(local); const u = fromCompact(utc);
    return { d: l ? l.slice(0, 10) : u ? u.slice(0, 10) : null, u: u ?? l ?? null };
  };
  const due = date(v('DueDate'), v('UtcDueDate'));
  const start = date(v('StartDate'), v('UtcStartDate'));
  const recNode = child(app, 'Tasks:Recurrence');
  const recurrence = recNode ? Object.fromEntries(recNode.children.filter((n) => n.text).map((n) => [n.tag.slice(6), n.text!])) : null;
  const body = bodyIn(app, 'Tasks:Body');
  return {
    subject: v('Subject') ?? '',
    body: body ?? prev?.body ?? null,
    complete: v('Complete') === '1',
    completed_at: fromCompact(v('DateCompleted')) ?? null,
    due_date: due.d, due_utc: due.u, start_date: start.d, start_utc: start.u,
    importance: v('Importance') !== undefined ? Number(v('Importance')) : 1,
    reminder_at: v('ReminderSet') === '1' ? fromCompact(v('ReminderTime')) ?? null : null,
    sensitivity: v('Sensitivity') !== undefined ? Number(v('Sensitivity')) : 0,
    recurrence,
    categories: categoriesIn(app, 'Tasks') ?? null,
  };
}
