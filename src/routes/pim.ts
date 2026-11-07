/** Calendar, contacts and notes of the signed-in user (same data phones sync over ActiveSync). */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../http-types';
import { ok } from '../lib/response';
import { AppError } from '../lib/errors';
import { parseBody } from '../lib/validate-request';
import {
  getContact, getEvent, getNote, listContacts, listEvents, listNotes, pimDelete, saveContact, saveEvent, saveNote, suggestAddresses, type EventInput, type PimKind,
} from '../services/pim-service';

export const pimRoutes = new Hono<HonoEnv>();
const owner = (c: Context<HonoEnv>) => c.get('actor')!.userId ?? `dev:${c.get('actor')!.email}`;

const recurrence = z.object({
  type: z.number().int().min(0).max(6), interval: z.number().int().min(1).max(999).optional(), until: z.string().max(40).optional(),
  occurrences: z.number().int().min(1).max(999).optional(), dayOfWeek: z.number().int().min(0).max(127).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(), weekOfMonth: z.number().int().min(1).max(5).optional(), monthOfYear: z.number().int().min(1).max(12).optional(),
}).nullable().optional();
const eventSchema = z.object({
  subject: z.string().max(500), location: z.string().max(500).nullable().optional(), body: z.string().max(50_000).nullable().optional(),
  start_at: z.string().max(40), end_at: z.string().max(40), all_day: z.boolean().optional(), reminder_min: z.number().int().min(0).max(40320).nullable().optional(),
  busy_status: z.number().int().min(0).max(4).optional(), recurrence,
  attendees: z.array(z.object({ email: z.string().max(254), name: z.string().max(200).optional() })).max(100).nullable().optional(),
  categories: z.array(z.string().max(100)).max(20).nullable().optional(),
});
const contactSchema = z.object({ data: z.record(z.string().max(40), z.string().max(100_000)), body: z.string().max(50_000).nullable().optional(), categories: z.array(z.string().max(100)).max(20).nullable().optional() });
const noteSchema = z.object({ subject: z.string().max(300), body: z.string().max(200_000), categories: z.array(z.string().max(100)).max(20).nullable().optional() });

// Calendar
pimRoutes.get('/calendar', async (c) => ok(c, await listEvents(c.env.DB, owner(c), c.req.query('from'), c.req.query('to'))));
pimRoutes.get('/calendar/:id', async (c) => ok(c, await getEvent(c.env.DB, owner(c), c.req.param('id'))));
pimRoutes.post('/calendar', async (c) => ok(c, await saveEvent(c.env.DB, owner(c), await parseBody(c, eventSchema)), 201));
pimRoutes.put('/calendar/:id', async (c) => {
  const prev = await getEvent(c.env.DB, owner(c), c.req.param('id'));
  const body = await parseBody(c, eventSchema.partial());
  // Fields the request leaves out keep their stored value (incl. what only phones set).
  const merged: EventInput = {
    subject: prev.subject, location: prev.location, body: prev.body, start_at: prev.start_at, end_at: prev.end_at, all_day: !!prev.all_day,
    tz_blob: prev.tz_blob, reminder_min: prev.reminder_min, busy_status: prev.busy_status, sensitivity: prev.sensitivity,
    recurrence: prev.recurrence_json ? JSON.parse(prev.recurrence_json) : null, attendees: prev.attendees_json ? JSON.parse(prev.attendees_json) : null,
    organizer_name: prev.organizer_name, organizer_email: prev.organizer_email, categories: prev.categories_json ? JSON.parse(prev.categories_json) : null,
    ...body,
  };
  // The web edits all-day dates as UTC midnights: drop a phone's time zone so phones read them the same way.
  if (body.all_day !== undefined || body.start_at !== undefined) if (merged.all_day) merged.tz_blob = null;
  return ok(c, await saveEvent(c.env.DB, owner(c), merged, prev.id));
});

// Contacts
pimRoutes.get('/contacts', async (c) => ok(c, await listContacts(c.env.DB, owner(c), c.req.query('q') || undefined)));
pimRoutes.get('/contacts/suggest', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const role = c.get('actor')!.role;
  return ok(c, q ? await suggestAddresses(c.env.DB, owner(c), q, role !== 'MAIL_USER') : []);
});
pimRoutes.get('/contacts/:id', async (c) => ok(c, await getContact(c.env.DB, owner(c), c.req.param('id'))));
pimRoutes.post('/contacts', async (c) => ok(c, await saveContact(c.env.DB, owner(c), await parseBody(c, contactSchema)), 201));
pimRoutes.put('/contacts/:id', async (c) => ok(c, await saveContact(c.env.DB, owner(c), await parseBody(c, contactSchema), c.req.param('id'))));

// Notes
pimRoutes.get('/notes', async (c) => ok(c, await listNotes(c.env.DB, owner(c), c.req.query('q') || undefined)));
pimRoutes.get('/notes/:id', async (c) => ok(c, await getNote(c.env.DB, owner(c), c.req.param('id'))));
pimRoutes.post('/notes', async (c) => ok(c, await saveNote(c.env.DB, owner(c), await parseBody(c, noteSchema)), 201));
pimRoutes.put('/notes/:id', async (c) => ok(c, await saveNote(c.env.DB, owner(c), await parseBody(c, noteSchema), c.req.param('id'))));

pimRoutes.delete('/:kind{calendar|contacts|notes}/:id', async (c) => {
  if (!(await pimDelete(c.env.DB, c.req.param('kind') as PimKind, owner(c), c.req.param('id')))) throw new AppError('NOT_FOUND');
  return ok(c, { deleted: true });
});
