import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { MsgKey } from '../i18n';
import { Alert, Badge, EmptyState, Field, Icon, Loading, Modal, PageHeader, Spinner, useToast } from '../ui';
import { customerName, useCustomerSearch } from '../components/CustomerSearch';
import type { CustomerHit } from '../components/CustomerSearch';

type Form = Record<string, string | number | boolean>;
const EMPTY: Form = {
  customer_code: '', customer_type: 'BUSINESS', company_name: '', first_name: '', last_name: '', contact_person: '',
  street: '', postal_code: '', city: '', country: 'DE', email: '', phone: '',
  ust_idnr: '', steuernummer: '', leitweg_id: '', payment_days: '', internal_note: '', is_active: true,
};
const LTR = new Set(['customer_code', 'email', 'phone', 'ust_idnr', 'steuernummer', 'leitweg_id', 'postal_code', 'country', 'payment_days']);
const SECTIONS: { key: MsgKey; fields: string[] }[] = [
  { key: 'cust.sec_identity', fields: ['customer_code', 'customer_type', 'company_name', 'first_name', 'last_name', 'contact_person'] },
  { key: 'cust.sec_address', fields: ['street', 'postal_code', 'city', 'country'] },
  { key: 'cust.sec_contact', fields: ['email', 'phone'] },
  { key: 'cust.sec_tax', fields: ['ust_idnr', 'steuernummer', 'leitweg_id', 'payment_days', 'internal_note'] },
];

/** Create/edit customer dialog; reused by the invoice form. */
export function CustomerFormModal({ open, onClose, onSaved, editId, prefill }: { open: boolean; onClose: () => void; onSaved: (c: CustomerHit) => void; editId?: string | null; prefill?: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErr(null); setFieldErr({});
    if (editId) {
      api.get<{ customer: Form }>(`/customers/${editId}`).then((d) => {
        const c = d.customer;
        const next: Form = { ...EMPTY };
        for (const k of Object.keys(EMPTY)) next[k] = k === 'is_active' ? Boolean(c[k]) : (c[k] ?? '') as string;
        setForm(next);
      }).catch((e) => setErr(errorText(e, i18n)));
    } else {
      const looksLikeEmail = prefill?.includes('@');
      setForm({ ...EMPTY, ...(prefill ? (looksLikeEmail ? { email: prefill } : { company_name: prefill }) : {}) });
      api.get<{ code: string }>('/customers/next-code').then(({ code }) => setForm((f) => ({ ...f, customer_code: f.customer_code || code }))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId]);

  async function save() {
    setErr(null); setFieldErr({}); setBusy(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (k === 'payment_days') { if (v !== '' && v !== null) body[k] = Number(v); continue; }
      if (typeof v === 'string' && v.trim() === '' && k !== 'email') continue;
      body[k] = typeof v === 'string' ? v.trim() : v;
    }
    body.country = String(form.country || 'DE').toUpperCase();
    try {
      const saved = editId ? await api.put<CustomerHit>(`/customers/${editId}`, body) : await api.post<CustomerHit>('/customers', body);
      onSaved(saved);
    } catch (e) {
      const fe = (e as { fields?: Record<string, string> }).fields ?? {};
      setFieldErr(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, i18n.tx(`verr.${v}`, v)])));
      setErr(errorText(e, i18n));
    } finally { setBusy(false); }
  }

  const input = (k: string) => {
    const id = `cf-${k}`;
    const label = i18n.tx(`f.${k}`, k);
    if (k === 'customer_type') {
      return (
        <Field key={k} label={label} htmlFor={id}>
          <select id={id} className="input" value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
            <option value="BUSINESS">{t('cust.type.BUSINESS')}</option>
            <option value="PRIVATE">{t('cust.type.PRIVATE')}</option>
          </select>
        </Field>
      );
    }
    if (k === 'internal_note') {
      return (
        <Field key={k} label={label} htmlFor={id} className="sm:col-span-2">
          <textarea id={id} className="input" rows={2} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </Field>
      );
    }
    return (
      <Field key={k} label={label} htmlFor={id} error={fieldErr[k]} className={k === 'street' || k === 'company_name' ? 'sm:col-span-2' : ''}>
        <input id={id} className="input" dir={LTR.has(k) ? 'ltr' : 'auto'} type={k === 'email' ? 'email' : k === 'payment_days' ? 'number' : 'text'}
          maxLength={k === 'country' ? 2 : undefined} value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      </Field>
    );
  };

  return (
    <Modal open={open} onClose={onClose} wide title={editId ? t('cust.edit') : t('cust.new')}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Icon name="check" />}{t('common.save')}</button>
      </>}>
      {err && <Alert tone="danger">{err}</Alert>}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-6">
        {SECTIONS.map((s) => (
          <fieldset key={s.key}>
            <legend className="mb-3 text-sm font-semibold text-fg">{t(s.key)}</legend>
            <div className="grid gap-3 sm:grid-cols-2">{s.fields.map(input)}</div>
          </fieldset>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={Boolean(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          {t('f.is_active')}
        </label>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export function Customers() {
  const { t, num } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<{ open: boolean; id: string | null }>({ open: params.get('new') === '1', id: null });
  const { hits, loading } = useCustomerSearch(q, true, 200, reload);
  const [initial, setInitial] = useState(true);

  useEffect(() => { if (!loading) setInitial(false); }, [loading]);

  return (
    <div>
      <PageHeader title={t('cust.title')} subtitle={t('cust.subtitle')}
        actions={<>
          <a className="btn-secondary" href="/api/customers/export/csv"><Icon name="download" />{t('common.export_csv')}</a>
          <button className="btn-primary" onClick={() => setModal({ open: true, id: null })}><Icon name="plus" />{t('cust.new')}</button>
        </>} />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 sm:max-w-md">
          <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input ps-9" placeholder={t('cust.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('cust.search')} autoFocus />
          {loading && <span className="absolute end-3 top-1/2 -translate-y-1/2 text-muted"><Spinner /></span>}
        </div>
        {q && !loading && <span className="text-sm text-muted">{t('cust.results', { n: hits.length })}</span>}
      </div>

      <div className="card overflow-hidden">
        {initial && loading ? <Loading /> : hits.length === 0 ? (
          <EmptyState icon="users" title={q ? t('cust.empty') : t('cust.empty_all')}
            action={<button className="btn-primary" onClick={() => setModal({ open: true, id: null })}><Icon name="plus" />{t('cust.new')}</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('f.customer_code')}</th><th>{t('cust.name')}</th><th className="max-md:hidden">{t('f.email')}</th><th className="max-sm:hidden">{t('f.city')}</th><th>{t('inv.status')}</th><th><span className="sr-only">{t('common.edit')}</span></th></tr></thead>
              <tbody>
                {hits.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => setModal({ open: true, id: r.id })}>
                    <td className="font-mono text-[13px] text-muted" dir="ltr">{num(r.customer_code)}</td>
                    <td>
                      <div className="flex items-center gap-2 font-medium">
                        <Icon name={r.customer_type === 'PRIVATE' ? 'user' : 'building'} className="h-4 w-4 text-muted" />
                        <span className="truncate">{customerName(r)}</span>
                      </div>
                    </td>
                    <td className="max-md:hidden text-muted" dir="ltr">{r.email}</td>
                    <td className="max-sm:hidden text-muted">{r.city}</td>
                    <td>{r.is_active ? <Badge tone="success">{t('cust.active')}</Badge> : <Badge>{t('cust.inactive')}</Badge>}</td>
                    <td className="text-end" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/invoices/new?customer=${r.id}`} className="btn-ghost btn-sm text-primary-fg"><Icon name="filePlus" />{t('cust.new_invoice')}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CustomerFormModal open={modal.open} editId={modal.id}
        onClose={() => { setModal({ open: false, id: null }); if (params.get('new')) setParams({}, { replace: true }); }}
        onSaved={() => {
          toast(t('cust.saved'));
          setModal({ open: false, id: null });
          if (params.get('new')) setParams({}, { replace: true });
          setReload((n) => n + 1);
        }} />
    </div>
  );
}
