import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { MsgKey } from '../i18n';
import { Alert, Field, Icon, Modal, Spinner, useToast } from '../ui';
import {
  addDays, calSystem, eventSpan, monthGrid, monthStart, nextMonth, occurrences, prevMonth, sameDay, startOfDay, ymd,
  type CalEvent, type Occurrence, type Recurrence,
} from '../calendar-utils';

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
interface Form {
  id?: string; subject: string; location: string; body: string; allDay: boolean;
  startDate: string; startTime: string; endDate: string; endTime: string; repeat: Repeat; reminder: string; recurrence: Recurrence | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function repeatOf(r: Recurrence | null): Repeat {
  if (!r) return 'none';
  if ((r.interval ?? 1) !== 1 || r.until || r.occurrences) return 'custom';
  if (r.type === 0) return 'daily';
  if (r.type === 1 && (!r.dayOfWeek || [1, 2, 4, 8, 16, 32, 64].includes(r.dayOfWeek))) return 'weekly';
  if (r.type === 2) return 'monthly';
  if (r.type === 5) return 'yearly';
  return 'custom';
}

function toRecurrence(f: Form, start: Date): Recurrence | null {
  switch (f.repeat) {
    case 'none': return null;
    case 'daily': return { type: 0, interval: 1 };
    case 'weekly': return { type: 1, interval: 1, dayOfWeek: 1 << start.getDay() };
    case 'monthly': return { type: 2, interval: 1, dayOfMonth: start.getDate() };
    case 'yearly': return { type: 5, interval: 1, dayOfMonth: start.getDate(), monthOfYear: start.getMonth() + 1 };
    default: return f.recurrence; // set on a phone: keep as is
  }
}

export function Calendar() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const toast = useToast();
  const cal = useMemo(() => calSystem(locale), [locale]);
  const [start, setStart] = useState(() => monthStart(cal, new Date()));
  useEffect(() => { setStart((s) => monthStart(cal, s)); }, [cal]);
  const grid = useMemo(() => monthGrid(cal, start), [cal, start]);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [selected, setSelected] = useState<Date>(() => startOfDay(new Date()));
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const from = grid[0]!; const to = addDays(grid[41]!, 1);
  const load = useCallback(() => {
    api.get<CalEvent[]>(`/pim/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then(setEvents).catch((e) => setErr(errorText(e, i18n)));
  }, [from.getTime(), to.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const occ = useMemo(() => (events ?? []).flatMap((e) => occurrences(e, from, to))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime()), [events, from.getTime(), to.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const onDay = (d: Date) => occ.filter((o) => o.start < addDays(startOfDay(d), 1) && o.end > startOfDay(d));
  const curMonth = cal.parts(start).m;
  const today = new Date();
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale]);
  const longDay = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }), [locale]);

  const openNew = (d: Date) => {
    const base = sameDay(d, today) ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), today.getHours() + 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9);
    const end = new Date(base.getTime() + 3_600_000);
    setForm({ subject: '', location: '', body: '', allDay: false, startDate: ymd(base), startTime: hm(base), endDate: ymd(end), endTime: hm(end), repeat: 'none', reminder: '15', recurrence: null });
  };
  const openEdit = (o: Occurrence) => {
    const e = o.event; const s = eventSpan(e);
    const r: Recurrence | null = e.recurrence_json ? JSON.parse(e.recurrence_json) : null;
    const endShown = s.allDay ? addDays(s.end, -1) : s.end;
    setForm({
      id: e.id, subject: e.subject, location: e.location ?? '', body: e.body ?? '', allDay: s.allDay,
      startDate: ymd(s.start), startTime: hm(s.start), endDate: ymd(endShown), endTime: hm(s.end),
      repeat: repeatOf(r), reminder: e.reminder_min === null ? '' : String(e.reminder_min), recurrence: r,
    });
  };

  async function save() {
    if (!form) return;
    setErr(null); setBusy(true);
    try {
      let startAt: string; let endAt: string; let local: Date;
      if (form.allDay) {
        startAt = `${form.startDate}T00:00:00.000Z`;
        const endDay = new Date(`${(form.endDate < form.startDate ? form.startDate : form.endDate)}T00:00:00.000Z`);
        endAt = new Date(endDay.getTime() + 86_400_000).toISOString();
        local = new Date(`${form.startDate}T00:00`);
      } else {
        local = new Date(`${form.startDate}T${form.startTime}`);
        let end = new Date(`${form.endDate}T${form.endTime}`);
        if (end <= local) end = new Date(local.getTime() + 3_600_000);
        startAt = local.toISOString(); endAt = end.toISOString();
      }
      const body = {
        subject: form.subject.trim() || t('cal.untitled'), location: form.location || null, body: form.body || null, all_day: form.allDay,
        start_at: startAt, end_at: endAt, reminder_min: form.reminder === '' ? null : Number(form.reminder), recurrence: toRecurrence(form, local),
      };
      if (form.id) await api.put(`/pim/calendar/${form.id}`, body); else await api.post('/pim/calendar', body);
      setForm(null); toast(t('common.saved')); load();
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!form?.id) return;
    setBusy(true);
    try { await api.del(`/pim/calendar/${form.id}`); setForm(null); toast(t('cal.deleted')); load(); }
    catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  const weekdays = grid.slice(0, 7);
  const selectedOcc = onDay(selected);
  const chip = (o: Occurrence) => o.allDay
    ? 'bg-primary text-on-primary'
    : 'bg-primary-soft text-primary-fg';

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="me-auto text-2xl font-bold tracking-tight">{t('nav.calendar')}</h1>
        <div className="flex items-center gap-1">
          <button className="btn-ghost btn-icon h-10 w-10" aria-label={t('cal.prev')} onClick={() => setStart(prevMonth(cal, start))}><Icon name="chevronLeft" flip /></button>
          <div className="min-w-[10rem] text-center text-lg font-semibold">{cal.monthTitle(addDays(start, 10))}</div>
          <button className="btn-ghost btn-icon h-10 w-10" aria-label={t('cal.next')} onClick={() => setStart(nextMonth(cal, start))}><Icon name="chevronRight" flip /></button>
        </div>
        <button className="btn-secondary" onClick={() => { setStart(monthStart(cal, new Date())); setSelected(startOfDay(new Date())); }}>{t('cal.today')}</button>
        <button className="btn-primary" onClick={() => openNew(selected)}><Icon name="plus" />{t('cal.new')}</button>
      </div>
      {err && !form && <div className="mb-4"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <section className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
            {weekdays.map((d) => <div key={d.getDay()} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-muted">{cal.weekday(d)}</div>)}
          </div>
          <div className="grid grid-cols-7 grid-rows-6">
            {grid.map((d) => {
              const inMonth = cal.parts(d).m === curMonth;
              const list = onDay(d);
              const isToday = sameDay(d, today);
              const isSel = sameDay(d, selected);
              return (
                <div key={d.getTime()} role="button" tabIndex={0}
                  onClick={() => setSelected(startOfDay(d))} onDoubleClick={() => openNew(d)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openNew(d); }}
                  className={`min-h-[4.5rem] cursor-pointer border-b border-e border-line p-1.5 text-start transition-colors sm:min-h-[6.5rem] ${inMonth ? '' : 'bg-surface-2/40'} ${isSel ? 'ring-2 ring-inset ring-primary' : 'hover:bg-surface-2/60'}`}>
                  <div className="mb-1 flex justify-end">
                    <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[13px] ${isToday ? 'bg-primary font-semibold text-on-primary' : inMonth ? 'text-fg' : 'text-muted'}`}>{cal.dayNum(d)}</span>
                  </div>
                  <div className="hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map((o) => (
                      <button key={o.event.id + o.start.getTime()} onClick={(e) => { e.stopPropagation(); openEdit(o); }}
                        className={`block w-full truncate rounded px-1.5 py-0.5 text-start text-[11px] font-medium ${chip(o)}`} title={o.event.subject}>
                        {!o.allDay && <span className="tabular me-1 opacity-80">{timeFmt.format(o.start)}</span>}{o.event.subject}
                      </button>
                    ))}
                    {list.length > 3 && <div className="px-1.5 text-[11px] text-muted">+{i18n.num(list.length - 3)}</div>}
                  </div>
                  {list.length > 0 && <div className="flex justify-center gap-0.5 sm:hidden">{list.slice(0, 3).map((o) => <span key={o.event.id + o.start.getTime()} className="h-1.5 w-1.5 rounded-full bg-primary" />)}</div>}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="card self-start p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="font-semibold">{longDay.format(selected)}</h2>
            <button className="btn-ghost btn-icon h-9 w-9" aria-label={t('cal.new')} onClick={() => openNew(selected)}><Icon name="plus" /></button>
          </div>
          {!events ? <div className="flex justify-center py-6"><Spinner /></div> : selectedOcc.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('cal.no_events')}</p>
          ) : (
            <ul className="space-y-2">
              {selectedOcc.map((o) => (
                <li key={o.event.id + o.start.getTime()}>
                  <button onClick={() => openEdit(o)} className="flex w-full gap-3 rounded-lg border border-line p-3 text-start hover:bg-surface-2">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{o.event.subject}</span>
                      <span className="block text-xs text-muted">
                        {o.allDay ? t('cal.all_day') : `${timeFmt.format(o.start)} – ${timeFmt.format(o.end)}`}
                        {o.event.recurrence_json ? ` · ${t('cal.repeats')}` : ''}
                      </span>
                      {o.event.location && <span className="mt-0.5 block truncate text-xs text-muted">{o.event.location}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-5 border-t border-line pt-4 text-xs text-muted">{t('cal.sync_hint')}</p>
        </aside>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('cal.edit') : t('cal.new')}>
        {form && (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
            <Field label={t('cal.title')} htmlFor="ev-s"><input id="ev-s" className="input" dir="auto" autoFocus value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />{t('cal.all_day')}</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('cal.starts')} htmlFor="ev-sd">
                <div className="flex gap-2">
                  <input id="ev-sd" type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} />
                  {!form.allDay && <input type="time" aria-label={t('cal.starts')} className="input w-28" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />}
                </div>
              </Field>
              <Field label={t('cal.ends')} htmlFor="ev-ed">
                <div className="flex gap-2">
                  <input id="ev-ed" type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                  {!form.allDay && <input type="time" aria-label={t('cal.ends')} className="input w-28" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />}
                </div>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('cal.repeat')} htmlFor="ev-r">
                <select id="ev-r" className="input" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as Repeat })}>
                  {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((r) => <option key={r} value={r}>{t(`cal.rep_${r}` as MsgKey)}</option>)}
                  {form.repeat === 'custom' && <option value="custom">{t('cal.rep_custom')}</option>}
                </select>
              </Field>
              <Field label={t('cal.reminder')} htmlFor="ev-rm">
                <select id="ev-rm" className="input" value={form.reminder} onChange={(e) => setForm({ ...form, reminder: e.target.value })}>
                  <option value="">{t('cal.rem_none')}</option>
                  {[0, 5, 15, 30, 60, 1440].map((m) => <option key={m} value={String(m)}>{m === 0 ? t('cal.rem_at') : m === 1440 ? t('cal.rem_day') : t('cal.rem_min', { n: i18n.num(m) })}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t('cal.location')} htmlFor="ev-l"><input id="ev-l" className="input" dir="auto" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label={t('cal.notes')} htmlFor="ev-b"><textarea id="ev-b" className="input h-24 py-2" dir="auto" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
            <div className="flex gap-2">
              {form.id && <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}><Icon name="trash" />{t('cal.delete')}</button>}
              <button className="btn-primary ms-auto" disabled={busy}>{busy ? <Spinner /> : <Icon name="check" />}{t('common.save')}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
