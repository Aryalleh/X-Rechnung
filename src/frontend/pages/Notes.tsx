import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import { Alert, EmptyState, Icon, Loading, Spinner, useToast } from '../ui';

interface Note { id: string; subject: string; body: string; updated_at: string }

export function Notes() {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const nav = useNavigate();
  const { id } = useParams();
  const [rows, setRows] = useState<Note[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.get<Note[]>(`/pim/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch((e) => setErr(errorText(e, i18n))), [q, i18n]);
  useEffect(() => { const h = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return new Intl.DateTimeFormat(locale, today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(d);
  };

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-4rem)] sm:-mx-8 sm:-my-8">
      <section className={`flex min-w-0 flex-col border-e border-line bg-surface md:w-[22rem] md:shrink-0 ${id ? 'max-md:hidden' : 'flex-1 md:flex-none'}`}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input h-10 ps-9" placeholder={t('note.search')} aria-label={t('note.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn-primary btn-icon h-10 w-10" aria-label={t('note.new')} title={t('note.new')} onClick={() => nav('/notes/new')}><Icon name="plus" /></button>
        </div>
        {err && <div className="p-3"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <div className="flex-1 overflow-y-auto">
          {!rows ? <Loading /> : rows.length === 0 ? <EmptyState icon="note" title={q ? t('note.no_results') : t('note.empty')} /> : (
            <ul>
              {rows.map((n) => (
                <li key={n.id}>
                  <button onClick={() => nav(`/notes/${n.id}`)}
                    className={`block w-full border-b border-line px-4 py-3 text-start transition-colors ${id === n.id ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium" dir="auto">{n.subject || t('note.untitled')}</span>
                      <span className="tabular shrink-0 text-xs text-muted">{fmt(n.updated_at)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted" dir="auto">{n.body.replace(/\s+/g, ' ').slice(0, 160) || '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className={`min-w-0 flex-1 overflow-y-auto bg-bg ${id ? '' : 'max-md:hidden'}`}>
        {id ? <NoteEditor key={id} id={id} onChanged={(n, created) => { void load(); if (created && n) nav(`/notes/${n.id}`, { replace: true }); }}
          onDeleted={() => { void load(); nav('/notes'); }} onBack={() => nav('/notes')} />
          : <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface"><Icon name="note" className="h-7 w-7" /></span>
            <p>{t('note.select')}</p>
          </div>}
      </section>
    </div>
  );
}

/** Editor with autosave (1.5 s after typing stops, and on leaving). */
function NoteEditor({ id, onChanged, onDeleted, onBack }: { id: string; onChanged: (n: Note | null, created: boolean) => void; onDeleted: () => void; onBack: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const isNew = id === 'new';
  const [note, setNote] = useState<{ subject: string; body: string } | null>(isNew ? { subject: '', body: '' } : null);
  const [state, setState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef(note);
  const savedId = useRef<string | null>(isNew ? null : id);
  latest.current = note;

  useEffect(() => {
    if (isNew) return;
    api.get<Note>(`/pim/notes/${id}`).then((n) => setNote({ subject: n.subject, body: n.body })).catch((e) => setErr(errorText(e, i18n)));
  }, [id, isNew, i18n]);

  const save = useCallback(async () => {
    const n = latest.current;
    if (!n || (!n.subject.trim() && !n.body.trim())) return;
    setState('saving');
    try {
      if (savedId.current) { const r = await api.put<Note>(`/pim/notes/${savedId.current}`, n); onChanged(r, false); }
      else { const r = await api.post<Note>('/pim/notes', n); savedId.current = r.id; onChanged(r, true); }
      setState('saved');
    } catch (e) { setErr(errorText(e, i18n)); setState('dirty'); }
  }, [i18n, onChanged]);

  useEffect(() => {
    if (state !== 'dirty') return;
    const h = setTimeout(() => void save(), 1500);
    return () => clearTimeout(h);
  }, [note, state, save]);
  // Save pending edits when leaving the note.
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => () => { if (latest.current && stateRef.current === 'dirty') void save(); }, [save]);

  if (!note) return err ? <div className="p-6"><Alert tone="danger">{err}</Alert></div> : <Loading />;
  const edit = (patch: Partial<typeof note>) => { setNote({ ...note, ...patch }); setState('dirty'); };

  async function remove() {
    if (!savedId.current) { onBack(); return; }
    try { await api.del(`/pim/notes/${savedId.current}`); toast(t('note.deleted')); setState('idle'); onDeleted(); } catch (e) { setErr(errorText(e, i18n)); }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-4 sm:p-8">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" className="btn-ghost btn-sm md:hidden" onClick={onBack}><Icon name="arrowLeft" flip />{t('mail.back')}</button>
        <span className="me-auto flex items-center gap-1.5 text-xs text-muted">
          {state === 'saving' ? <><Spinner className="h-3 w-3" />{t('note.saving')}</> : state === 'dirty' ? t('note.unsaved') : state === 'saved' ? <><Icon name="check" className="h-3.5 w-3.5 text-success" />{t('note.saved')}</> : ''}
        </span>
        <button type="button" className="btn-secondary btn-sm" disabled={state !== 'dirty'} onClick={() => void save()}><Icon name="save" />{t('common.save')}</button>
        <button type="button" className="btn-ghost btn-icon h-9 w-9" aria-label={t('note.delete')} title={t('note.delete')} onClick={() => void remove()}><Icon name="trash" /></button>
      </div>
      {err && <div className="mb-3"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
      <div className="card flex min-h-[60vh] flex-1 flex-col overflow-hidden">
        <input className="border-b border-line bg-transparent px-6 py-4 text-xl font-semibold outline-none placeholder:text-muted" dir="auto" placeholder={t('note.title')}
          aria-label={t('note.title')} value={note.subject} autoFocus={isNew} onChange={(e) => edit({ subject: e.target.value })}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } }} />
        <textarea className="flex-1 resize-none bg-transparent px-6 py-4 text-[15px] leading-relaxed outline-none placeholder:text-muted" dir="auto" placeholder={t('note.body')}
          aria-label={t('note.body')} value={note.body} onChange={(e) => edit({ body: e.target.value })}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } }} />
      </div>
    </div>
  );
}
