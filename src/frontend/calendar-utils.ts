/**
 * Calendar helpers for the web app: month grids in the user's calendar system
 * (Gregorian or Persian/Jalali via Intl) and expansion of ActiveSync recurrences.
 */

export interface Recurrence {
  type: number; interval?: number; until?: string; occurrences?: number;
  dayOfWeek?: number; dayOfMonth?: number; weekOfMonth?: number; monthOfYear?: number;
}
export interface CalEvent {
  id: string; subject: string; location: string | null; body: string | null; start_at: string; end_at: string; all_day: number;
  tz_blob: string | null; reminder_min: number | null; busy_status: number; recurrence_json: string | null; attendees_json: string | null;
  organizer_name: string | null; organizer_email: string | null;
}
export interface Occurrence { event: CalEvent; start: Date; end: Date; allDay: boolean }

const DAY = 86_400_000;

/** Local midnight of a date. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** YYYY-MM-DD of a local date. */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Bias (minutes, UTC = local + bias) from an ActiveSync TIME_ZONE_INFORMATION blob. */
export function tzBias(blob: string | null): number {
  if (!blob) return 0;
  try {
    const b = atob(blob);
    if (b.length < 4) return 0;
    const v = b.charCodeAt(0) | (b.charCodeAt(1) << 8) | (b.charCodeAt(2) << 16) | (b.charCodeAt(3) << 24);
    return v;
  } catch { return 0; }
}

/** Start/end of an event in local display terms. All-day events become local date ranges [start, end). */
export function eventSpan(e: CalEvent): { start: Date; end: Date; allDay: boolean } {
  if (e.all_day) {
    const bias = tzBias(e.tz_blob) * 60_000;
    const s = new Date(Date.parse(e.start_at) - bias);
    const en = new Date(Date.parse(e.end_at) - bias);
    const start = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    const days = Math.max(1, Math.round((en.getTime() - s.getTime()) / DAY));
    return { start, end: addDays(start, days), allDay: true };
  }
  return { start: new Date(e.start_at), end: new Date(e.end_at), allDay: false };
}

const nthWeekday = (year: number, month: number, dowMask: number, week: number): Date | null => {
  // week 1-4, 5 = last
  const days: Date[] = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dowMask & (1 << dt.getDay())) days.push(dt);
  }
  if (!days.length) return null;
  return week >= 5 ? days[days.length - 1]! : days[week - 1] ?? null;
};

/** Every occurrence of an event that overlaps [from, to). */
export function occurrences(e: CalEvent, from: Date, to: Date): Occurrence[] {
  const span = eventSpan(e);
  const dur = span.end.getTime() - span.start.getTime();
  const r: Recurrence | null = e.recurrence_json ? JSON.parse(e.recurrence_json) : null;
  const make = (day: Date): Occurrence => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), span.start.getHours(), span.start.getMinutes());
    return { event: e, start, end: new Date(start.getTime() + dur), allDay: span.allDay };
  };
  const overlaps = (o: Occurrence) => o.start < to && o.end > from;
  if (!r) { const o = { event: e, ...span }; return overlaps(o) ? [o] : []; }

  const interval = Math.max(1, r.interval ?? 1);
  const until = r.until ? new Date(r.until) : null;
  const max = r.occurrences ?? Infinity;
  const first = startOfDay(span.start);
  const out: Occurrence[] = [];
  let count = 0;
  const push = (day: Date): boolean => {
    if (day < first) return true;
    if (until && day > until) return false;
    if (count >= max) return false;
    count++;
    const o = make(day);
    if (o.start >= to) return false;
    if (overlaps(o)) out.push(o);
    return true;
  };

  const LIMIT = 4000;
  if (r.type === 0) {
    for (let i = 0; i < LIMIT; i++) if (!push(addDays(first, i * interval))) break;
  } else if (r.type === 1) {
    const mask = r.dayOfWeek || 1 << first.getDay();
    const weekStart = addDays(first, -first.getDay());
    outer: for (let w = 0; w < LIMIT; w++) {
      for (let d = 0; d < 7; d++) {
        if (!(mask & (1 << d))) continue;
        if (!push(addDays(weekStart, w * 7 * interval + d))) break outer;
      }
    }
  } else if (r.type === 2 || r.type === 3) {
    for (let m = 0; m < LIMIT; m++) {
      const y = first.getFullYear(); const mo = first.getMonth() + m * interval;
      const day = r.type === 2
        ? (() => { const want = r.dayOfMonth ?? first.getDate(); const d = new Date(y, mo, want); return d.getDate() === want ? d : null; })()
        : nthWeekday(new Date(y, mo, 1).getFullYear(), new Date(y, mo, 1).getMonth(), r.dayOfWeek || 1 << first.getDay(), r.weekOfMonth ?? 1);
      if (day && !push(day)) break;
      if (new Date(y, mo, 1) >= to) break;
    }
  } else if (r.type === 5 || r.type === 6) {
    const month = (r.monthOfYear ?? first.getMonth() + 1) - 1;
    for (let k = 0; k < 400; k++) {
      const y = first.getFullYear() + k * interval;
      const day = r.type === 5
        ? (() => { const want = r.dayOfMonth ?? first.getDate(); const d = new Date(y, month, want); return d.getDate() === want ? d : null; })()
        : nthWeekday(y, month, r.dayOfWeek || 1 << first.getDay(), r.weekOfMonth ?? 1);
      if (day && !push(day)) break;
      if (new Date(y, month, 1) >= to) break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ month grid in any calendar system

export interface CalSystem {
  /** Year/month/day of a date in the user's calendar (numbers). */
  parts: (d: Date) => { y: number; m: number; d: number };
  monthTitle: (d: Date) => string;
  dayNum: (d: Date) => string;
  weekday: (d: Date) => string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number;
}

export function calSystem(locale: string): CalSystem {
  const calendar = new Intl.DateTimeFormat(locale).resolvedOptions().calendar;
  const num = new Intl.DateTimeFormat(locale, { calendar, numberingSystem: 'latn', year: 'numeric', month: 'numeric', day: 'numeric' });
  const title = new Intl.DateTimeFormat(locale, { calendar, year: 'numeric', month: 'long' });
  const day = new Intl.DateTimeFormat(locale, { calendar, day: 'numeric' });
  const wd = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return {
    parts: (d) => {
      const p = Object.fromEntries(num.formatToParts(d).map((x) => [x.type, x.value]));
      return { y: Number(p.year ?? p.relatedYear), m: Number(p.month), d: Number(p.day) };
    },
    monthTitle: (d) => title.format(d),
    dayNum: (d) => day.format(d),
    weekday: (d) => wd.format(d),
    weekStart: locale.startsWith('fa') ? 6 : 1,
  };
}

/** First day (local midnight) of the month containing `d`, in the given calendar. */
export function monthStart(cal: CalSystem, d: Date): Date {
  let cur = startOfDay(d);
  const m = cal.parts(cur).m;
  for (let i = 0; i < 32; i++) {
    const prev = addDays(cur, -1);
    if (cal.parts(prev).m !== m) break;
    cur = prev;
  }
  return cur;
}
export const nextMonth = (cal: CalSystem, start: Date) => monthStart(cal, addDays(start, 32));
export const prevMonth = (cal: CalSystem, start: Date) => monthStart(cal, addDays(start, -1));

/** 6×7 grid of days covering the month that starts at `start`. */
export function monthGrid(cal: CalSystem, start: Date): Date[] {
  const offset = (start.getDay() - cal.weekStart + 7) % 7;
  const first = addDays(start, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}
