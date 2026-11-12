import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { MsgKey } from '../i18n';
import { Alert, EmptyState, Field, Icon, Loading, Spinner, useToast } from '../ui';

interface Contact {
  id: string; display_name: string; email: string | null; phone: string | null; company: string | null;
  data_json: string; body: string | null; updated_at: string;
}
type Data = Record<string, string>;

/** Editable fields (ActiveSync names), grouped. Other fields a phone sets are kept untouched. */
const GROUPS: { key: MsgKey; fields: { k: string; type?: string; ltr?: boolean; wide?: boolean }[] }[] = [
  { key: 'con.g_name', fields: [{ k: 'FirstName' }, { k: 'LastName' }, { k: 'CompanyName' }, { k: 'JobTitle' }] },
  { key: 'con.g_contact', fields: [
    { k: 'Email1Address', type: 'email', ltr: true }, { k: 'Email2Address', type: 'email', ltr: true },
    { k: 'MobilePhoneNumber', type: 'tel', ltr: true }, { k: 'BusinessPhoneNumber', type: 'tel', ltr: true }, { k: 'HomePhoneNumber', type: 'tel', ltr: true },
    { k: 'WebPage', type: 'url', ltr: true },
  ] },
  { key: 'con.g_address', fields: [{ k: 'BusinessAddressStreet', wide: true }, { k: 'BusinessAddressPostalCode' }, { k: 'BusinessAddressCity' }, { k: 'BusinessAddressCountry' }] },
  { key: 'con.g_more', fields: [{ k: 'Birthday', type: 'date' }, { k: 'Department' }] },
];

const initials = (s: string) => s.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const bare = (v?: string) => (v ? (/<([^>]+)>/.exec(v)?.[1] ?? v).trim() : '');

export function Contacts() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const nav = useNavigate();
  const { id } = useParams();
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api.get<Contact[]>(`/pim/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch((e) => setErr(errorText(e, i18n))), [q, i18n]);
  useEffect(() => { const h = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);

  // Group by first letter for the list.
  const groups = (rows ?? []).reduce<Record<string, Contact[]>>((acc, c) => {
    const k = (c.display_name || '#').trim()[0]?.toUpperCase() ?? '#';
    (acc[k] ??= []).push(c); return acc;
  }, {});

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-4rem)] sm:-mx-8 sm:-my-8">
      <section className={`flex min-w-0 flex-col border-e border-line bg-surface md:w-[22rem] md:shrink-0 ${id ? 'max-md:hidden' : 'flex-1 md:flex-none'}`}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input h-10 ps-9" placeholder={t('con.search')} aria-label={t('con.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="btn-primary btn-icon h-10 w-10" aria-label={t('con.new')} title={t('con.new')} onClick={() => nav('/contacts/new')}><Icon name="plus" /></button>
        </div>
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('nav.contacts')} · {i18n.num(rows?.length ?? 0)}</div>
        {err && <div className="px-3"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <div className="flex-1 overflow-y-auto">
          {!rows ? <Loading /> : rows.length === 0 ? <EmptyState icon="contact" title={q ? t('con.no_results') : t('con.empty')} /> : (
            Object.entries(groups).map(([letter, list]) => (
              <div key={letter}>
                <div className="sticky top-0 bg-surface-2 px-4 py-1 text-xs font-semibold text-muted">{letter}</div>
                <ul>
                  {list.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => nav(`/contacts/${c.id}`)}
                        className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-start transition-colors ${id === c.id ? 'bg-primary-soft' : 'hover:bg-surface-2'}`}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-fg">{initials(c.display_name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" dir="auto">{c.display_name || c.email || c.phone}</span>
                          <span className="block truncate text-xs text-muted" dir="auto">{c.company || c.email || c.phone || ''}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>
      <section className={`min-w-0 flex-1 overflow-y-auto bg-bg ${id ? '' : 'max-md:hidden'}`}>
        {id ? <ContactEditor key={id} id={id} onSaved={(c) => { void load(); if (id === 'new') nav(`/contacts/${c.id}`, { replace: true }); toast(t('common.saved')); }}
          onDeleted={() => { void load(); nav('/contacts'); toast(t('con.deleted')); }} onBack={() => nav('/contacts')} />
          : <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface"><Icon name="contact" className="h-7 w-7" /></span>
            <p>{t('con.select')}</p>
            <p className="max-w-sm text-xs">{t('cal.sync_hint')}</p>
          </div>}
      </section>
    </div>
  );
}

function ContactEditor({ id, onSaved, onDeleted, onBack }: { id: string; onSaved: (c: Contact) => void; onDeleted: () => void; onBack: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const nav = useNavigate();
  const isNew = id === 'new';
  const [data, setData] = useState<Data | null>(isNew ? {} : null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    api.get<Contact>(`/pim/contacts/${id}`).then((c) => { setData(JSON.parse(c.data_json) as Data); setBody(c.body ?? ''); }).catch((e) => setErr(errorText(e, i18n)));
  }, [id, isNew, i18n]);

  if (!data) return err ? <div className="p-6"><Alert tone="danger">{err}</Alert></div> : <Loading />;
  const set = (k: string, v: string) => setData({ ...data, [k]: v });
  const name = [data.FirstName, data.LastName].filter(Boolean).join(' ') || data.CompanyName || bare(data.Email1Address) || t('con.new');
  const email = bare(data.Email1Address || data.Email2Address);
  const phone = data.MobilePhoneNumber || data.BusinessPhoneNumber || data.HomePhoneNumber;

  async function save() {
    setErr(null); setBusy(true);
    try {
      const clean: Data = {};
      for (const [k, v] of Object.entries(data!)) if (v?.trim()) clean[k] = k === 'Birthday' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v.trim();
      const res = isNew ? await api.post<Contact>('/pim/contacts', { data: clean, body: body || null }) : await api.put<Contact>(`/pim/contacts/${id}`, { data: clean, body: body || null });
      onSaved(res);
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.del(`/pim/contacts/${id}`); onDeleted(); } catch (e) { setErr(errorText(e, i18n)); setBusy(false); }
  }

  return (
    <form className="mx-auto max-w-3xl p-4 sm:p-8" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <button type="button" className="btn-ghost btn-sm mb-4 md:hidden" onClick={onBack}><Icon name="arrowLeft" flip />{t('mail.back')}</button>
      <div className="card mb-6 flex flex-wrap items-center gap-4 p-6">
        {data.Picture
          ? <img src={`data:image/jpeg;base64,${data.Picture}`} alt="" className="h-16 w-16 rounded-full object-cover" />
          : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-xl font-semibold text-primary-fg">{initials(name)}</span>}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold" dir="auto">{name}</h1>
          {(data.JobTitle || data.CompanyName) && <p className="truncate text-sm text-muted" dir="auto">{[data.JobTitle, data.CompanyName].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="flex gap-2">
          {email && <button type="button" className="btn-secondary btn-sm" onClick={() => nav(`/mail?to=${encodeURIComponent(email)}`)}><Icon name="mail" />{t('con.write')}</button>}
          {phone && <a className="btn-secondary btn-sm" href={`tel:${phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" />{t('con.call')}</a>}
        </div>
      </div>
      {err && <div className="mb-4"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
      <div className="grid gap-6">
        {GROUPS.map((g) => (
          <section key={g.key} className="card p-6">
            <h2 className="mb-4 font-semibold">{t(g.key)}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {g.fields.map((f) => (
                <Field key={f.k} label={t(`con.f_${f.k}` as MsgKey)} htmlFor={`cf-${f.k}`} className={f.wide ? 'sm:col-span-2' : ''}>
                  <input id={`cf-${f.k}`} className="input" type={f.type ?? 'text'} dir={f.ltr ? 'ltr' : 'auto'}
                    value={f.k === 'Birthday' ? (data[f.k] ?? '').slice(0, 10) : data[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} />
                </Field>
              ))}
            </div>
          </section>
        ))}
        <section className="card p-6">
          <Field label={t('con.notes')} htmlFor="cf-body"><textarea id="cf-body" className="input h-28 py-2" dir="auto" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        </section>
      </div>
      <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-line bg-bg/90 py-4 backdrop-blur">
        {!isNew && <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()}><Icon name="trash" />{t('con.delete')}</button>}
        <button className="btn-primary ms-auto" disabled={busy}>{busy ? <Spinner /> : <Icon name="check" />}{t('common.save')}</button>
      </div>
    </form>
  );
}
