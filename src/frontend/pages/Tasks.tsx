import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import { Alert, EmptyState, Field, Icon, Loading, Modal, Spinner, useToast } from '../ui';
import { ymd } from '../calendar-utils';

interface Task {
  id: string; subject: string; body: string | null; complete: number; completed_at: string | null;
  due_date: string | null; importance: number; reminder_at: string | null; recurrence_json: string | null; updated_at: string;
}
interface Form { id?: string; subject: string; body: string; due: string; importance: number; reminder: string }

/** UTC instant of local midnight for a YYYY-MM-DD date (what phones call UtcDueDate). */
const utcOf = (d: string) => new Date(`${d}T00:00`).toISOString();
const pad = (n: number) => String(n).padStart(2, '0');
const localDT = (iso: string) => { const d = new Date(iso); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function Tasks() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const toast = useToast();
  const [rows, setRows] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quick, setQuick] = useState('');
  const [quickDue, setQuickDue] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get<Task[]>('/pim/tasks').then(setRows).catch((e) => setErr(errorText(e, i18n))), [i18n]);
  useEffect(() => { void load(); }, [load]);

  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }), [locale]);
  const open = (rows ?? []).filter((x) => !x.complete);
  const done = (rows ?? []).filter((x) => x.complete);
  const groups: { key: string; label: string; tone: string; list: Task[] }[] = [
    { key: 'over', label: t('task.overdue'), tone: 'text-danger', list: open.filter((x) => x.due_date && x.due_date < today) },
    { key: 'today', label: t('task.today'), tone: 'text-primary-fg', list: open.filter((x) => x.due_date === today) },
    { key: 'later', label: t('task.upcoming'), tone: 'text-fg', list: open.filter((x) => x.due_date && x.due_date > today) },
    { key: 'none', label: t('task.no_date'), tone: 'text-fg', list: open.filter((x) => !x.due_date) },
  ].filter((g) => g.list.length);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!quick.trim()) return;
    try {
      await api.post('/pim/tasks', { subject: quick.trim(), ...(quickDue ? { due_date: quickDue, due_utc: utcOf(quickDue) } : {}) });
      setQuick(''); setQuickDue(''); void load();
    } catch (er) { setErr(errorText(er, i18n)); }
  }
  async function toggle(x: Task) {
    setRows((r) => r?.map((y) => (y.id === x.id ? { ...y, complete: x.complete ? 0 : 1 } : y)) ?? null);
    try { await api.put(`/pim/tasks/${x.id}`, { complete: !x.complete }); void load(); } catch (er) { setErr(errorText(er, i18n)); void load(); }
  }
  async function save() {
    if (!form) return;
    setBusy(true); setErr(null);
    try {
      const body = {
        subject: form.subject.trim() || t('task.untitled'), body: form.body || null, importance: form.importance,
        due_date: form.due || null, due_utc: form.due ? utcOf(form.due) : null,
        reminder_at: form.reminder ? new Date(form.reminder).toISOString() : null,
      };
      if (form.id) await api.put(`/pim/tasks/${form.id}`, body); else await api.post('/pim/tasks', body);
      setForm(null); toast(t('common.saved')); void load();
    } catch (er) { setErr(errorText(er, i18n)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!form?.id) return;
    setBusy(true);
    try { await api.del(`/pim/tasks/${form.id}`); setForm(null); toast(t('task.deleted')); void load(); }
    catch (er) { setErr(errorText(er, i18n)); } finally { setBusy(false); }
  }
  const edit = (x: Task) => setForm({ id: x.id, subject: x.subject, body: x.body ?? '', due: x.due_date ?? '', importance: x.importance, reminder: x.reminder_at ? localDT(x.reminder_at) : '' });

  const dueLabel = (d: string) => (d === today ? t('task.today') : d === tomorrow ? t('task.tomorrow') : dateFmt.format(new Date(`${d}T00:00`)));
  const row = (x: Task) => (
    <li key={x.id} className="group flex items-start gap-3 border-b border-line px-4 py-3 last:border-0 sm:px-5">
      <button onClick={() => void toggle(x)} aria-label={x.complete ? t('task.reopen') : t('task.mark_done')} title={x.complete ? t('task.reopen') : t('task.mark_done')}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${x.complete ? 'border-success bg-success text-surface' : x.importance === 2 ? 'border-danger hover:bg-danger-soft' : 'border-line-strong hover:border-primary hover:bg-primary-soft'}`}>
        {!!x.complete && <Icon name="check" className="h-3.5 w-3.5" />}
      </button>
      <button onClick={() => edit(x)} className="min-w-0 flex-1 text-start">
        <span className={`block break-words ${x.complete ? 'text-muted line-through' : 'font-medium'}`} dir="auto">{x.subject || t('task.untitled')}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {x.due_date && !x.complete && <span className={`flex items-center gap-1 ${x.due_date < today ? 'font-semibold text-danger' : x.due_date === today ? 'font-semibold text-primary-fg' : ''}`}><Icon name="calendar" className="h-3.5 w-3.5" />{dueLabel(x.due_date)}</span>}
          {x.importance === 2 && !x.complete && <span className="font-semibold text-danger">{t('task.high')}</span>}
          {x.reminder_at && !x.complete && <span>⏰ {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(x.reminder_at))}</span>}
          {x.recurrence_json && <span>↻ {t('cal.repeats')}</span>}
          {x.body && <span className="truncate" dir="auto">{x.body.split('\n')[0]}</span>}
        </span>
      </button>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="me-auto text-2xl font-bold tracking-tight">{t('nav.tasks')}</h1>
        <span className="text-sm text-muted">{t('task.open_count', { n: i18n.num(open.length) })}</span>
      </div>
      {err && <div className="mb-4"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}

      <form onSubmit={(e) => void add(e)} className="card mb-6 flex flex-wrap items-center gap-2 p-3">
        <Icon name="plus" className="ms-1 h-5 w-5 text-muted" />
        <input className="h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" dir="auto" placeholder={t('task.add_placeholder')} aria-label={t('task.add_placeholder')}
          value={quick} onChange={(e) => setQuick(e.target.value)} />
        <input type="date" className="input h-10 w-auto" aria-label={t('task.due')} value={quickDue} onChange={(e) => setQuickDue(e.target.value)} />
        <button className="btn-primary" disabled={!quick.trim()}>{t('task.add')}</button>
      </form>

      {!rows ? <Loading /> : open.length === 0 && done.length === 0 ? (
        <div className="card"><EmptyState icon="checklist" title={t('task.empty')} /></div>
      ) : (
        <div className="space-y-6">
          {open.length === 0 && <div className="card p-8 text-center text-muted">{t('task.all_done')}</div>}
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className={`mb-2 px-1 text-sm font-semibold ${g.tone}`}>{g.label} · {i18n.num(g.list.length)}</h2>
              <ul className="card overflow-hidden">{g.list.map(row)}</ul>
            </section>
          ))}
          {done.length > 0 && (
            <section>
              <button className="mb-2 flex items-center gap-1 px-1 text-sm font-semibold text-muted hover:text-fg" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
                <Icon name="chevronRight" className={`h-4 w-4 transition-transform ${showDone ? 'rotate-90' : 'rtl:rotate-180'}`} />{t('task.done')} · {i18n.num(done.length)}
              </button>
              {showDone && <ul className="card overflow-hidden">{done.map(row)}</ul>}
            </section>
          )}
        </div>
      )}
      <p className="mt-6 text-center text-xs text-muted">{t('cal.sync_hint')}</p>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('task.edit') : t('task.new')}>
        {form && (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {err && <Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert>}
            <Field label={t('cal.title')} htmlFor="tk-s"><input id="tk-s" className="input" dir="auto" autoFocus value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('task.due')} htmlFor="tk-d"><input id="tk-d" type="date" className="input" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
              <Field label={t('task.priority')} htmlFor="tk-p">
                <select id="tk-p" className="input" value={form.importance} onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })}>
                  <option value={0}>{t('task.low')}</option><option value={1}>{t('task.normal')}</option><option value={2}>{t('task.high')}</option>
                </select>
              </Field>
            </div>
            <Field label={t('cal.reminder')} htmlFor="tk-r"><input id="tk-r" type="datetime-local" className="input" value={form.reminder} onChange={(e) => setForm({ ...form, reminder: e.target.value })} /></Field>
            <Field label={t('cal.notes')} htmlFor="tk-b"><textarea id="tk-b" className="input h-24 py-2" dir="auto" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
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
