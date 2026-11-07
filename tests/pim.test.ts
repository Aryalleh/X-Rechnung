import { describe, expect, it } from 'vitest';
import { decode, encode, el } from '../src/eas/wbxml';
import { contactFromApp, contactProps, eventFromApp, eventProps, fromCompact, noteFromApp, noteProps, toCompact } from '../src/eas/pim';
import { occurrences, type CalEvent } from '../src/frontend/calendar-utils';

const roundTrip = (nodes: ReturnType<typeof el>[]) => decode(encode(el('AirSync:ApplicationData', nodes)));

describe('PIM ⇄ ActiveSync mapping', () => {
  it('converts compact calendar times', () => {
    expect(toCompact('2026-11-07T10:00:00.000Z')).toBe('20261107T100000Z');
    expect(fromCompact('20261107T100000Z')).toBe('2026-11-07T10:00:00.000Z');
    expect(fromCompact('nonsense')).toBeUndefined();
  });

  it('round-trips an event with recurrence', () => {
    const row = {
      id: 'e1', uid: 'u1', subject: 'Standup', location: 'Office', body: 'notes', start_at: '2026-11-09T08:00:00.000Z', end_at: '2026-11-09T08:15:00.000Z',
      all_day: 0, tz_blob: null, reminder_min: 10, busy_status: 2, sensitivity: 0, recurrence_json: JSON.stringify({ type: 1, interval: 1, dayOfWeek: 62 }),
      attendees_json: null, organizer_name: null, organizer_email: null, categories_json: null, updated_at: '2026-11-07T00:00:00.000Z',
    } as never;
    const app = roundTrip(eventProps(row, [{ type: 1 }]).filter(Boolean) as never);
    const back = eventFromApp(app);
    expect(back).toMatchObject({ subject: 'Standup', location: 'Office', body: 'notes', start_at: '2026-11-09T08:00:00.000Z', reminder_min: 10, all_day: false });
    expect(back.recurrence).toEqual({ type: 1, interval: 1, dayOfWeek: 62 });
  });

  it('round-trips contact fields and notes', () => {
    const c = { data_json: JSON.stringify({ FirstName: 'Ali', LastName: 'Rezaei', Email1Address: 'ali@example.com', MobilePhoneNumber: '+49 151 1' }), body: 'VIP', categories_json: null } as never;
    const back = contactFromApp(roundTrip(contactProps(c, [{ type: 1 }]).filter(Boolean) as never));
    expect(back.data).toEqual({ FirstName: 'Ali', LastName: 'Rezaei', Email1Address: 'ali@example.com', MobilePhoneNumber: '+49 151 1' });
    expect(back.body).toBe('VIP');
    const n = { subject: 'Ideas', body: 'line 1\nline 2', categories_json: null, updated_at: '2026-11-07T10:00:00.000Z' } as never;
    expect(noteFromApp(roundTrip(noteProps(n, [{ type: 1 }]).filter(Boolean) as never))).toMatchObject({ subject: 'Ideas', body: 'line 1\nline 2' });
  });
});

describe('calendar recurrence expansion', () => {
  const ev = (over: Partial<CalEvent>): CalEvent => ({
    id: 'x', subject: 's', location: null, body: null, start_at: new Date(2026, 10, 2, 9).toISOString(), end_at: new Date(2026, 10, 2, 10).toISOString(),
    all_day: 0, tz_blob: null, reminder_min: null, busy_status: 2, recurrence_json: null, attendees_json: null, organizer_name: null, organizer_email: null, ...over,
  });
  const nov = [new Date(2026, 10, 1), new Date(2026, 11, 1)] as const;

  it('expands weekdays (Mon–Fri) within a month', () => {
    const o = occurrences(ev({ recurrence_json: JSON.stringify({ type: 1, dayOfWeek: 62 }) }), ...nov);
    expect(o).toHaveLength(21); // Nov 2 (Mon) .. Nov 30 (Mon): 4 full weeks + Nov 30
    expect(o.every((x) => x.start.getDay() >= 1 && x.start.getDay() <= 5)).toBe(true);
    expect(o[0]!.start.getHours()).toBe(9);
  });
  it('honours occurrences and monthly day', () => {
    expect(occurrences(ev({ recurrence_json: JSON.stringify({ type: 0, occurrences: 3 }) }), ...nov)).toHaveLength(3);
    const m = occurrences(ev({ recurrence_json: JSON.stringify({ type: 2, dayOfMonth: 2 }) }), new Date(2026, 10, 1), new Date(2027, 2, 1));
    expect(m.map((x) => x.start.getMonth())).toEqual([10, 11, 0, 1]);
  });
  it('keeps all-day events on their date', () => {
    const o = occurrences(ev({ all_day: 1, start_at: '2026-11-20T00:00:00.000Z', end_at: '2026-11-21T00:00:00.000Z' }), ...nov);
    expect(o).toHaveLength(1);
    expect(o[0]!.start.getDate()).toBe(20);
    expect(o[0]!.allDay).toBe(true);
  });
});
