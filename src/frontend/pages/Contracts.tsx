import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { errorText, useI18n } from '../i18n';
import type { Lang, MsgKey } from '../i18n';
import { normalizeText } from '../../lib/search';
import {
  customVariables, parseFields, standardVariables, STANDARD_VARS, substitute,
} from '../../lib/contract-doc';
import { formatDateFor } from '../../lib/format';
import { Alert, Badge, EmptyState, Field, Icon, Loading, Modal, PageHeader, Section, Spinner, StatusBadge, TopBar, useToast } from '../ui';
import type { IconName } from '../ui';
import { CustomerCombobox, customerName } from '../components/CustomerSearch';
import { ContractDoc } from '../components/ContractDoc';
import { SignaturePad } from '../components/SignaturePad';

type CLang = 'de' | 'en' | 'fa';
interface Row { id: string; contract_number: string; title: string; language: CLang; status: string; signer_name: string | null; sent_at: string | null; sent_to_email: string | null; signed_at: string | null; seller_signed_at: string | null; sign_token_expires_at: string | null; updated_at: string; customer_company: string | null; customer_person: string | null }
interface Tpl { id: string; name: string; language: CLang; body: string; is_active: number; sort_order: number }
interface Contract {
  id: string; contract_number: string; title: string; language: CLang; template_id: string | null; customer_id: string | null;
  body: string; resolved_body: string | null; content_hash: string | null; status: string; variables: Record<string, string>;
  field_values: Record<string, string | boolean>; customer: Record<string, unknown>; seller: Record<string, unknown>;
  seller_signer_name: string | null; seller_signature: string | null; seller_signed_at: string | null;
  signer_name: string | null; signer_email: string | null; signature: string | null; signed_at: string | null; signer_ip: string | null;
  viewed_at: string | null; sent_at: string | null; sent_to_email: string | null; created_at: string; link_active: boolean;
}
interface Cust { id: string; company_name: string | null; first_name: string | null; last_name: string | null; customer_code: string; email?: string | null }

const LINK_DAYS = 30;

export function Contracts() {
  return (
    <Routes>
      <Route index element={<ContractList />} />
      <Route path="new" element={<ContractEditor />} />
      <Route path="templates" element={<TemplateManager />} />
      <Route path=":id" element={<ContractRouter />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

function useLangs(): CLang[] {
  const { allowed } = useI18n();
  return (allowed as Lang[]).filter((l): l is CLang => ['de', 'en', 'fa'].includes(l));
}

// ───────────────────────────── list ─────────────────────────────
const FILTERS = ['ALL', 'DRAFT', 'PENDING', 'CUSTOMER_SIGNED', 'SIGNED', 'CANCELLED'] as const;

function ContractList() {
  const { t, tx, date, num } = useI18n();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [q, setQ] = useState('');
  useEffect(() => { api.get<Row[]>('/contracts').then(setRows).catch(() => setRows([])); }, []);
  const shown = useMemo(() => {
    const nq = normalizeText(q);
    return (rows ?? []).filter((r) => {
      if (filter === 'PENDING' ? !['SENT', 'VIEWED'].includes(r.status) : filter !== 'ALL' && r.status !== filter) return false;
      return !nq || normalizeText(`${r.contract_number} ${r.title} ${r.customer_company ?? ''} ${r.customer_person ?? ''}`).includes(nq);
    });
  }, [rows, filter, q]);
  const pending = (rows ?? []).filter((r) => r.status === 'SENT' || r.status === 'VIEWED').length;
  const yourTurn = (rows ?? []).filter((r) => r.status === 'CUSTOMER_SIGNED').length;
  const completed = (rows ?? []).filter((r) => r.status === 'SIGNED').length;
  const soon = Date.now() + 48 * 3600_000;
  const expiring = (rows ?? []).filter((r) => (r.status === 'SENT' || r.status === 'VIEWED') && r.sign_token_expires_at && new Date(r.sign_token_expires_at).getTime() < soon).length;
  const nextSigner = (r: Row) => r.status === 'SENT' || r.status === 'VIEWED' ? 'customer' : r.status === 'CUSTOMER_SIGNED' ? 'you' : r.status === 'DRAFT' ? 'draft' : null;

  const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('ctr.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('ctr.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" to="/contracts/templates"><Icon name="bookmark" />{t('ctr.templates')}</Link>
          <Link className="btn-primary" to="/contracts/new"><Icon name="plus" />{t('ctr.new')}</Link>
        </div>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t('ctr.kpi_awaiting')} value={num(pending)} sub={t('ctr.kpi_awaiting_sub')} subTone="primary" onClick={() => setFilter('PENDING')} />
        <Kpi label={t('ctr.kpi_your_turn')} value={num(yourTurn)} sub={t('ctr.kpi_your_turn_sub')} subTone="warning" accent={yourTurn > 0} onClick={() => setFilter('CUSTOMER_SIGNED')} />
        <Kpi label={t('ctr.kpi_completed')} value={num(completed)} sub={t('ctr.kpi_completed_sub')} subTone="success" onClick={() => setFilter('SIGNED')} />
        <Kpi label={t('ctr.kpi_expiring')} value={num(expiring)} sub={t('ctr.kpi_expiring_sub')} subTone="danger" onClick={() => setFilter('PENDING')} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-6 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="-mb-px flex gap-5 overflow-x-auto" role="tablist">
            {FILTERS.map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors ${filter === f ? 'border-primary text-primary-fg' : 'border-transparent text-muted hover:text-fg'}`}>
                {f === 'ALL' ? t('common.all') : f === 'PENDING' ? `${t('ctr.awaiting')}${pending ? ` · ${num(pending)}` : ''}`
                  : f === 'CUSTOMER_SIGNED' ? `${t('ctr.your_turn')}${yourTurn ? ` · ${num(yourTurn)}` : ''}` : tx(`status.${f}`, f)}
              </button>
            ))}
          </div>
          <div className="relative mb-3 sm:w-64">
            <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input h-9 ps-9" placeholder={t('ctr.search')} aria-label={t('ctr.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {!rows ? <Loading /> : shown.length === 0 ? (
          <EmptyState icon="fileSign" title={t('ctr.empty')} action={<Link className="btn-primary" to="/contracts/new"><Icon name="plus" />{t('ctr.new')}</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('ctr.name_ref')}</th><th>{t('ctr.customer')}</th><th>{t('ctr.status')}</th><th className="max-md:hidden">{t('ctr.next_signer')}</th><th className="text-end">{t('inv.actions')}</th></tr></thead>
              <tbody>{shown.map((r) => {
                const cust = r.customer_company || r.customer_person || '';
                return (
                  <tr key={r.id} className="row-link" onClick={() => nav(`/contracts/${r.id}`)}>
                    <td className="max-w-[20rem]">
                      <Link to={`/contracts/${r.id}`} className="block truncate font-semibold hover:text-primary-fg" onClick={(e) => e.stopPropagation()}><bdi>{r.title}</bdi></Link>
                      <div className="font-mono text-xs text-muted" dir="ltr">{r.contract_number} · {date(r.signed_at ?? r.sent_at ?? r.updated_at)}</div>
                    </td>
                    <td className="max-w-[16rem]"><div className="truncate font-medium"><bdi>{cust || '—'}</bdi></div>{r.sent_to_email && <div className="truncate text-xs text-muted" dir="ltr">{r.sent_to_email}</div>}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="max-md:hidden">
                      {nextSigner(r) === 'customer' && <span className="flex items-center gap-2 text-sm"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-info-soft text-[11px] font-bold text-info">{initials(cust)}</span><bdi className="max-w-[8rem] truncate">{cust || t('ctr.signer_customer')}</bdi></span>}
                      {nextSigner(r) === 'you' && <span className="flex items-center gap-2 text-sm font-medium"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning-soft text-warning"><Icon name="pen" className="h-4 w-4" /></span>{t('ctr.signer_you')}</span>}
                      {nextSigner(r) === null && <span className="flex items-center gap-2 text-sm text-success"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft"><Icon name="check" className="h-4 w-4" /></span>{t('ctr.signer_done')}</span>}
                      {nextSigner(r) === 'draft' && <span className="text-xs text-muted">{t('ctr.signer_draft')}</span>}
                    </td>
                    <td className="whitespace-nowrap text-end" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {r.status === 'CUSTOMER_SIGNED' ? <Link to={`/contracts/${r.id}`} className="btn-primary btn-sm">{t('ctr.sign_now')}</Link>
                          : <Link to={`/contracts/${r.id}`} className="btn-secondary btn-sm">{r.status === 'DRAFT' ? t('ctr.edit') : r.status === 'SENT' || r.status === 'VIEWED' ? t('ctr.manage_link') : t('ctr.open')}</Link>}
                        {r.status === 'SIGNED' && <a className="btn-ghost btn-icon h-8 w-8" href={`/api/contracts/${r.id}/pdf`} title={t('ctr.pdf')} aria-label={`${t('ctr.pdf')} ${r.contract_number}`}><Icon name="download" /></a>}
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      <section className="card mt-8 p-6">
        <h2 className="mb-6 text-lg font-semibold">{t('ctr.flow_title')}</h2>
        <ol className="grid gap-6 sm:grid-cols-3">
          {([['send', 'flow1'], ['pen', 'flow2'], ['fileSign', 'flow3']] as const).map(([icon, k], i) => (
            <li key={k} className="relative flex flex-col items-center text-center">
              {i < 2 && <span className="absolute start-[calc(50%+2rem)] top-6 hidden h-0.5 w-[calc(100%-4rem)] bg-line sm:block" aria-hidden="true" />}
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary-fg ring-4 ring-surface"><Icon name={icon} className="h-5 w-5" /></span>
              <div className="mt-3 text-sm font-semibold">{num(i + 1)}. {t(`ctr.${k}_title` as MsgKey)}</div>
              <p className="mt-1 max-w-xs text-[13px] text-muted">{t(`ctr.${k}_text` as MsgKey)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Stepper({ steps, done }: { steps: string[]; done: boolean[] }) {
  const { num } = useI18n();
  const current = Math.max(0, done.findIndex((d) => !d));
  return (
    <ol className="mb-5 flex items-center gap-2 overflow-x-auto rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      {steps.map((s, i) => {
        const state = done[i] ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s} className="flex shrink-0 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && <span className={`h-px w-6 sm:w-10 ${done[i - 1] ? 'bg-primary' : 'bg-line-strong'}`} aria-hidden="true" />}
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${state === 'done' ? 'bg-primary text-on-primary' : state === 'current' ? 'border-2 border-primary text-primary-fg' : 'border border-line-strong text-muted'}`}>
              {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : num(i + 1)}
            </span>
            <span className={state === 'todo' ? 'text-muted' : 'font-medium'}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Kpi({ label, value, sub, subTone, accent, onClick }: { label: string; value: string; sub: string; subTone: 'primary' | 'success' | 'warning' | 'danger'; accent?: boolean; onClick: () => void }) {
  const subCls = subTone === 'primary' ? 'text-primary-fg' : subTone === 'success' ? 'text-success' : subTone === 'warning' ? 'text-warning' : 'text-danger';
  return (
    <button onClick={onClick} className={`card flex flex-col p-5 text-start transition-colors hover:border-line-strong ${accent ? 'border-s-4 border-s-warning' : ''}`}>
      <span className="eyebrow">{label}</span>
      <span className="tabular mt-2 text-3xl font-bold">{value}</span>
      <span className={`mt-2 text-xs font-medium ${subCls}`}>{sub}</span>
    </button>
  );
}

function ContractRouter() {
  const { id } = useParams();
  const [c, setC] = useState<Contract | null | undefined>(undefined);
  const load = () => api.get<Contract>(`/contracts/${id}`).then(setC).catch(() => setC(null));
  useEffect(() => { void load(); }, [id]);
  if (c === undefined) return <Loading />;
  if (c === null) return <Navigate to="/contracts" replace />;
  return c.status === 'DRAFT' ? <ContractEditor existing={c} /> : <ContractDetail c={c} reload={load} />;
}

// ───────────────────────────── editor / generator ─────────────────────────────
function ContractEditor({ existing }: { existing?: Contract }) {
  const i18n = useI18n();
  const { t, lang: uiLang } = i18n;
  const toast = useToast();
  const nav = useNavigate();
  const langs = useLangs();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [language, setLanguage] = useState<CLang>(existing?.language ?? (langs.includes(uiLang as CLang) ? uiLang as CLang : langs[0] ?? 'de'));
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(existing?.template_id ?? null);
  const [customer, setCustomer] = useState<Record<string, unknown> | null>(existing?.customer_id ? { id: existing.customer_id, ...existing.customer } : null);
  const [seller, setSeller] = useState<Record<string, unknown>>(existing?.seller ?? {});
  const [body, setBody] = useState(existing?.body ?? '');
  const [vars, setVars] = useState<Record<string, string>>(existing?.variables ?? {});
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [contractId, setContractId] = useState<string | null>(existing?.id ?? null);
  const [number, setNumber] = useState(existing?.contract_number ?? '');
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { api.get<Tpl[]>('/contract-templates').then(setTemplates).catch(() => {}); }, []);
  useEffect(() => { api.get<Record<string, unknown> | null>('/settings/seller').then((s) => s && setSeller(s)).catch(() => {}); }, []);

  const langTemplates = templates.filter((x) => x.language === language && x.is_active);
  const pickTemplate = (id: string) => {
    const tpl = templates.find((x) => x.id === id);
    setTemplateId(id || null);
    if (tpl) { setBody(tpl.body); if (!title) setTitle(tpl.name); }
  };
  // New contract: preselect the first template of the language.
  useEffect(() => {
    if (!existing && !body && langTemplates[0]) pickTemplate(langTemplates[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, language]);

  const custom = useMemo(() => customVariables(body), [body]);
  const std = useMemo(() => standardVariables({
    seller, customer: customer ? { ...customer, name: customer.name ?? [customer.first_name, customer.last_name].filter(Boolean).join(' ') } : {},
    lang: language, number: number || '—', title,
  }), [seller, customer, language, number, title]);
  const allVars = { ...std, ...vars };
  const fieldCount = useMemo(() => parseFields(body).length, [body]);

  const insert = (snippet: string) => {
    const el = area.current;
    if (!el) { setBody((b) => b + snippet); return; }
    const [a, z] = [el.selectionStart, el.selectionEnd];
    const next = body.slice(0, a) + snippet + body.slice(z);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + snippet.length, a + snippet.length); });
  };

  const payload = () => ({
    title: title.trim() || t('ctr.new'), language, template_id: templateId, customer_id: (customer?.id as string) ?? null, body,
    variables: Object.fromEntries(custom.map((k) => [k, vars[k] ?? ''])),
  });

  async function save(): Promise<string | null> {
    setErr(null); setBusy('save');
    try {
      const c = contractId ? await api.put<Contract>(`/contracts/${contractId}`, payload()) : await api.post<Contract>('/contracts', payload());
      setContractId(c.id); setNumber(c.contract_number);
      if (!contractId) nav(`/contracts/${c.id}`, { replace: true });
      toast(t('ctr.saved'));
      return c.id;
    } catch (e) { setErr(errorText(e, i18n)); return null; } finally { setBusy(null); }
  }
  async function remove() {
    if (!contractId) { nav('/contracts'); return; }
    setBusy('delete');
    try { await api.del(`/contracts/${contractId}`); toast(t('ctr.deleted')); nav('/contracts'); }
    catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(null); }
  }
  async function openSend() {
    if (!customer) { setErr(t('ctr.need_customer')); return; }
    const id = await save();
    if (id) setSendOpen(true);
  }

  const rtl = language === 'fa';
  const steps = [t('ctr.step_setup'), t('ctr.step_content'), t('ctr.step_send')];
  const preview = (
    <div className="flex-1 overflow-y-auto bg-surface-2 p-4 sm:p-8">
      <article className="mx-auto max-w-2xl rounded bg-surface p-8 shadow-sm ring-1 ring-line sm:p-12" dir={rtl ? 'rtl' : 'ltr'} lang={language}>
        <ContractDoc body={substitute(body, allVars)} mode="preview" vars={allVars} formatDate={(iso) => formatDateFor(iso, language)} />
      </article>
    </div>
  );

  const editorPane = (
    <section className="card flex min-h-[32rem] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
          {(['edit', 'preview'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={tab === m} onClick={() => setTab(m)}
              className={`h-8 rounded-md px-3 text-[13px] font-semibold ${tab === m ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
              {t(m === 'edit' ? 'ctr.edit' : 'ctr.preview')}
            </button>
          ))}
        </div>
        {tab === 'edit' && <InsertMenu onInsert={insert} rtl={rtl} />}
      </div>
      {tab === 'edit' ? (
        <div className="flex flex-1 flex-col p-4">
          <label htmlFor="c-body" className="sr-only">{t('ctr.body')}</label>
          <textarea id="c-body" ref={area} className="input min-h-[28rem] flex-1 resize-y bg-surface font-mono text-[13px] leading-6" dir={rtl ? 'rtl' : 'ltr'}
            value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
          <p className="mt-2 text-xs text-muted" dir="auto">{t('ctr.body_help')}</p>
        </div>
      ) : preview}
    </section>
  );
  return (
    <div className="-mx-4 -my-6 sm:-mx-8 sm:-my-8">
      <TopBar back="/contracts" title={existing ? `${t('ctr.workflow_title')} · ${existing.contract_number}` : t('ctr.workflow_title')}
        actions={<>
          <button className="btn-secondary" onClick={() => void save()} disabled={!!busy}>{busy === 'save' ? <Spinner /> : <Icon name="save" className="sm:hidden" />}<span className="max-sm:hidden">{t('ctr.save')}</span></button>
          <button className="btn-primary" onClick={() => void openSend()} disabled={!!busy || !body.trim()}><span className="max-sm:hidden">{t('ctr.send')}</span><Icon name="send" flip /></button>
        </>} />
      <div className="sticky top-16 z-20 border-b border-line bg-surface px-4 sm:px-8">
        <div className="-mb-px flex gap-8 overflow-x-auto" role="tablist">
          {steps.map((s2, i) => (
            <button key={s2} role="tab" aria-selected={step === i} onClick={() => setStep(i)}
              className={`whitespace-nowrap border-b-2 py-3.5 text-sm font-medium transition-colors ${step === i ? 'border-primary font-semibold text-primary-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              {i18n.num(i + 1)}. {s2}
            </button>
          ))}
        </div>
      </div>

      <div className={`mx-auto space-y-8 px-4 py-8 sm:px-8 ${step === 1 ? 'max-w-6xl' : 'max-w-4xl'}`}>
        {err && <div role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}

        {step === 0 && <>
          <StepCard n={1} title={t('ctr.basic_details')}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t('ctr.f_title')} htmlFor="c-title" className="sm:col-span-2">
                <input id="c-title" className="input h-11" dir="auto" placeholder={t('ctr.title_ph')} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label={t('ctr.internal_ref')} htmlFor="c-ref">
                <input id="c-ref" className="input h-11 font-mono text-muted" dir="ltr" readOnly value={number || 'CTR-XXXX'} />
              </Field>
              {langs.length > 1 ? (
                <Field label={t('ctr.f_language')} htmlFor="c-lang">
                  <select id="c-lang" className="input h-11" value={language} onChange={(e) => { setLanguage(e.target.value as CLang); setTemplateId(null); }}>
                    {langs.map((l) => <option key={l} value={l}>{t(`lang.${l}` as MsgKey)}</option>)}
                  </select>
                </Field>
              ) : <div />}
              <Field label={t('ctr.f_template')} htmlFor="c-tpl" className="sm:col-span-2">
                <select id="c-tpl" className="input h-11" value={templateId ?? ''} onChange={(e) => pickTemplate(e.target.value)}>
                  <option value="">{t('ctr.no_template')}</option>
                  {langTemplates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            </div>
          </StepCard>

          <StepCard n={2} title={t('ctr.recipient')}>
            <div className="label">{t('ni.select_customer')}</div>
            {!customer && <CustomerCombobox onSelect={(h) => {
              api.get<{ customer: Record<string, unknown> }>(`/customers/${h.id}`).then((d) => setCustomer(d.customer)).catch(() => setCustomer(h as unknown as Record<string, unknown>));
            }} />}
            <div className={`flex items-center gap-4 rounded-lg border border-line bg-surface-2 p-4 ${customer ? '' : 'mt-4'}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-muted shadow-sm"><Icon name="user" className="h-5 w-5" /></span>
              {customer ? (
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold"><bdi>{customerName(customer as unknown as Cust)}</bdi></div>
                  <div className="truncate text-xs text-muted" dir="ltr">{String(customer.email ?? '')}</div>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t('ctr.no_customer')}</div>
                  <div className="text-xs text-muted">{t('ctr.no_customer_hint')}</div>
                </div>
              )}
              {customer ? <button className="btn-ghost btn-sm text-primary-fg" onClick={() => setCustomer(null)}>{t('ctr.change')}</button>
                : <Link to="/customers" className="text-xs font-semibold text-primary-fg hover:underline">+ {t('ctr.new_customer')}</Link>}
            </div>
          </StepCard>

          <StepCard n={3} title={t('ctr.workflow')} badge={<span className="badge-status bg-success-soft text-success">{t('ctr.ecosystem_mode')}</span>}>
            <div className="space-y-3">
              <div className="flex items-center gap-4 rounded-xl border-2 border-primary/30 bg-primary-soft/50 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary-fg">{i18n.num(1)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-primary-fg">{t('ctr.customer_first')}</div>
                  <p className="mt-0.5 text-xs text-primary-fg/80">{t('ctr.customer_first_text')}</p>
                </div>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"><Icon name="check" className="h-3.5 w-3.5" /></span>
              </div>
              <div className="flex items-center gap-4 rounded-xl border border-line p-4 opacity-50" aria-disabled="true">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg font-semibold text-muted">{i18n.num(2)}</span>
                <div>
                  <div className="font-semibold text-muted">{t('ctr.owner_first')}</div>
                  <p className="mt-0.5 text-xs text-muted">{t('ctr.owner_first_text')}</p>
                </div>
              </div>
            </div>
          </StepCard>
        </>}

        {step === 1 && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <section className="card p-6">
              <h2 className="mb-1 text-base font-bold">{t('ctr.vars')}</h2>
              <p className="mb-5 text-xs text-muted">{t('ctr.vars_hint')}</p>
              {custom.length === 0 ? <p className="text-sm text-muted">{t('ctr.vars_none')}</p> : (
                <div className="space-y-4">
                  {custom.map((k) => (
                    <Field key={k} label={k.replace(/_/g, ' ')} htmlFor={`v-${k}`}>
                      <input id={`v-${k}`} className={`input ${!vars[k]?.trim() ? 'border-warning' : ''}`} dir="auto" value={vars[k] ?? ''} onChange={(e) => setVars({ ...vars, [k]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              )}
              {fieldCount > 0 && <p className="mt-4 text-xs text-muted"><Icon name="pen" className="me-1 inline h-3.5 w-3.5" />{t('ctr.fields_count', { n: i18n.num(fieldCount) })}</p>}
            </section>
            {editorPane}
          </div>
        )}

        {step === 2 && <>
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold" dir="auto">{title || t('ctr.new')}</h2>
                <p className="text-xs text-muted">{customer ? <bdi>{customerName(customer as unknown as Cust)}</bdi> : t('ctr.no_customer')} · {t(`lang.${language}` as MsgKey)}</p>
              </div>
              <StatusBadge status="DRAFT" />
            </div>
            {preview}
          </section>
          <p className="text-center text-xs text-muted">{t('ctr.legal')}</p>
        </>}

        <div className="flex items-center justify-end gap-3">
          {contractId && <button className="btn-ghost me-auto text-danger" onClick={() => void remove()} disabled={!!busy}>{busy === 'delete' ? <Spinner /> : <Icon name="trash" />}{t('ctr.delete')}</button>}
          <button className="btn-secondary h-11 px-8 text-base" disabled={step === 0} onClick={() => setStep((x) => x - 1)}>{t('ctr.prev_step')}</button>
          {step < 2
            ? <button className="btn-primary h-11 px-8 text-base" onClick={() => setStep((x) => x + 1)}>{t('ctr.next_step')}</button>
            : <button className="btn-primary h-11 px-8 text-base" onClick={() => void openSend()} disabled={!!busy || !body.trim()}><Icon name="send" flip />{t('ctr.send')}</button>}
        </div>
      </div>

      {sendOpen && contractId && (
        <SendModal contractId={contractId}
          defaultEmail={String(customer?.email ?? '')} onClose={() => setSendOpen(false)}
          onSent={() => nav(`/contracts/${contractId}`, { replace: true, state: { t: Date.now() } })} />
      )}
    </div>
  );
}

function StepCard({ n, title, badge, children }: { n: number; title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  const { num } = useI18n();
  return (
    <section className="card p-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{num(n)}. {title}</h2>{badge}
      </div>
      {children}
    </section>
  );
}

function InsertMenu({ onInsert, rtl }: { onInsert: (s: string) => void; rtl: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn); return () => document.removeEventListener('mousedown', fn);
  }, []);
  const label = rtl ? 'برچسب' : 'Label';
  const fields: [MsgKey, string][] = [['ctr.field_text', `[[${label}]]`], ['ctr.field_date', `[[${label}:date]]`], ['ctr.field_number', `[[${label}:number]]`], ['ctr.field_checkbox', `[[${label}:checkbox]]`]];
  const pick = (s: string) => { onInsert(s); setOpen(false); };
  return (
    <div ref={ref} className="relative">
      <button className="btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="plus" />{t('ctr.insert')}<Icon name="chevronDown" className="h-3.5 w-3.5" /></button>
      {open && (
        <div className="absolute end-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
          <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('ctr.insert_field')}</div>
          {fields.map(([k, s]) => (
            <button key={k} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2" onClick={() => pick(s)}>
              <span>{t(k)}</span><code className="text-xs text-muted" dir="ltr">{s}</code>
            </button>
          ))}
          <div className="mt-1 border-t border-line px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('ctr.insert_var')}</div>
          {STANDARD_VARS.map((v) => (
            <button key={v} className="block w-full px-3 py-1.5 text-start font-mono text-xs hover:bg-surface-2" dir="ltr" onClick={() => pick(`{{${v}}}`)}>{`{{${v}}}`}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function SendModal({ contractId, defaultEmail, onClose, onSent }: {
  contractId: string; defaultEmail: string; onClose: () => void; onSent: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState('');
  const [days, setDays] = useState(LINK_DAYS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; emailed: boolean; emailError: string | null } | null>(null);

  async function send() {
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ link: string; emailed: boolean; emailError: string | null }>(`/contracts/${contractId}/send`,
        { email_to: email.trim(), link_days: days, ...(message.trim() ? { message } : {}) });
      setResult(r);
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  if (result) {
    return (
      <Modal open onClose={onSent} title={t('ctr.link_title')} footer={<button className="btn-primary" onClick={onSent}>{t('ctr.done')}</button>}>
        <LinkBox link={result.link} days={days} />
        {result.emailed && <div className="mt-3"><Alert tone="success">{t('ctr.emailed', { email })}</Alert></div>}
        {result.emailError && <div className="mt-3"><Alert tone="warning">{t('ctr.email_failed', { err: result.emailError })}</Alert></div>}
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t('ctr.send_title')}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn-primary" onClick={() => void send()} disabled={busy}>{busy ? <Spinner /> : <Icon name="send" />}{t('ctr.send_btn')}</button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('ctr.send_sub')}</p>
        {err && <div role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ctr.email_to')} hint={t('ctr.email_hint')} htmlFor="s-mail"><input id="s-mail" type="email" className="input" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={t('ctr.message')} htmlFor="s-msg"><textarea id="s-msg" className="input" rows={2} dir="auto" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          <Field label={t('ctr.link_validity')} hint={t('ctr.expires_on', { date: i18n.date(new Date(Date.now() + days * 86400_000).toISOString()) })} htmlFor="s-days">
            <select id="s-days" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{t('ctr.n_days', { n: d })}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted">{t('ctr.legal')}</p>
      </div>
    </Modal>
  );
}

function LinkBox({ link, days = LINK_DAYS }: { link: string; days?: number }) {
  const { t, num } = useI18n();
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast(t('ctr.copied')); } catch { /* select manually */ } };
  return (
    <div>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" dir="ltr" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t('ctr.link_title')} />
        <button className="btn-primary shrink-0" onClick={() => void copy()}><Icon name="copy" />{t('ctr.copy')}</button>
      </div>
      <p className="mt-2 text-xs text-muted">{t('ctr.link_hint', { days: num(days) })}</p>
    </div>
  );
}

// ───────────────────────────── detail ─────────────────────────────
function ContractDetail({ c, reload }: { c: Contract; reload: () => void }) {
  const i18n = useI18n();
  const { t, date } = i18n;
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pending = c.status === 'SENT' || c.status === 'VIEWED';
  const rtl = c.language === 'fa';

  const act = async (key: string, fn: () => Promise<void>) => {
    setErr(null); setBusy(key);
    try { await fn(); } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(null); }
  };
  const download = () => act('pdf', async () => {
    const res = await api.raw(`/contracts/${c.id}/pdf`);
    if (!res.ok) throw Object.assign(new Error(t('common.error')), { code: 'PDF' });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${c.contract_number}${c.status === 'SIGNED' ? '_signed' : '_preview'}.pdf`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  const steps: { key: MsgKey; at: string | null; done: boolean }[] = [
    { key: 'ctr.ev_created', at: c.created_at, done: true },
    { key: 'ctr.ev_sent', at: c.sent_at, done: !!c.sent_at },
    { key: 'ctr.ev_viewed', at: c.viewed_at, done: !!c.viewed_at },
    { key: 'ctr.ev_signed', at: c.signed_at, done: !!c.signed_at },
    { key: 'ctr.ev_countersigned', at: c.seller_signed_at, done: !!c.seller_signed_at },
  ];

  return (
    <div>
      <TopBar back="/contracts" title={<bdi>{c.title}</bdi>} subtitle={c.contract_number}
        actions={<>
          <StatusBadge status={c.status} />
          <button className={c.status === 'SIGNED' ? 'btn-primary' : 'btn-secondary'} onClick={() => void download()} disabled={!!busy}>
            {busy === 'pdf' ? <Spinner /> : <Icon name="download" />}{t(c.status === 'SIGNED' ? 'ctr.pdf' : 'ctr.pdf_preview')}
          </button>
        </>} />
      {err && <div className="mb-4" role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <article className="card p-8 sm:p-12" dir={rtl ? 'rtl' : 'ltr'} lang={c.language}>
          <ContractDoc body={c.resolved_body ?? c.body} mode="static" values={c.field_values} formatDate={(iso) => formatDateFor(iso, c.language)} />
          <div className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-2">
            <SigView label={String(c.seller.full_name ?? '')} name={c.seller_signer_name} img={c.seller_signature} at={c.seller_signed_at} />
            <SigView label={String(c.customer.company_name || c.customer.name || '')} name={c.signer_name} img={c.signature} at={c.signed_at} />
          </div>
        </article>

        <div className="space-y-5">
          <Section title={t('ctr.status')} actions={<StatusBadge status={c.status} />}>
            <ol className="space-y-3">
              {steps.map((s) => (
                <li key={s.key} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.done ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'}`}>
                    {s.done ? <Icon name="check" className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-sm ${s.done ? 'font-medium' : 'text-muted'}`}>{t(s.key)}</div>
                    {s.at && <div className="text-xs text-muted">{date(s.at)} · <span dir="ltr">{s.at.slice(11, 16)} UTC</span></div>}
                  </div>
                </li>
              ))}
            </ol>
            {c.signed_at && (
              <dl className="mt-4 space-y-1 border-t border-line pt-3 text-xs">
                <div className="flex justify-between gap-2"><dt className="text-muted">{t('ctr.signer')}</dt><dd className="font-medium" dir="auto">{c.signer_name}</dd></div>
                {c.signer_email && <div className="flex justify-between gap-2"><dt className="text-muted">E-Mail</dt><dd dir="ltr">{c.signer_email}</dd></div>}
                {c.signer_ip && <div className="flex justify-between gap-2"><dt className="text-muted">IP</dt><dd dir="ltr">{c.signer_ip}</dd></div>}
              </dl>
            )}
            {c.content_hash && (
              <div className="mt-3 border-t border-line pt-3 text-xs">
                <div className="text-muted">{t('ctr.hash')}</div>
                <code className="block break-all text-[11px]" dir="ltr">{c.content_hash}</code>
              </div>
            )}
          </Section>

          {c.status === 'CUSTOMER_SIGNED' && (
            <Countersign c={c} onDone={(r) => { toast(t('ctr.countersigned_ok')); if (r.emailError) setErr(t('ctr.email_failed', { err: r.emailError })); reload(); }} />
          )}

          {pending && (
            <Section title={t('ctr.link_title')} icon="link">
              {link ? <LinkBox link={link} /> : (
                <button className="btn-secondary w-full justify-center" disabled={!!busy}
                  onClick={() => void act('link', async () => { const r = await api.post<{ link: string }>(`/contracts/${c.id}/relink`); setLink(r.link); })}>
                  {busy === 'link' ? <Spinner /> : <Icon name="link" />}{t('ctr.new_link')}
                </button>
              )}
            </Section>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={!!busy}
              onClick={() => void act('dup', async () => { const d = await api.post<Contract>(`/contracts/${c.id}/duplicate`); nav(`/contracts/${d.id}`); })}>
              {busy === 'dup' ? <Spinner /> : <Icon name="copy" />}{t('ctr.duplicate')}
            </button>
            {c.status !== 'SIGNED' && c.status !== 'CANCELLED' && (
              <button className="btn-ghost text-danger" onClick={() => setConfirmCancel(true)} disabled={!!busy}><Icon name="ban" />{t('ctr.cancel')}</button>
            )}
          </div>
          <p className="text-xs text-muted">{t('ctr.legal')}</p>
        </div>
      </div>

      {confirmCancel && (
        <Modal open onClose={() => setConfirmCancel(false)} title={t('ctr.cancel')}
          footer={<>
            <button className="btn-secondary" onClick={() => setConfirmCancel(false)}>{t('common.cancel')}</button>
            <button className="btn-danger" onClick={() => void act('cancel', async () => { await api.post(`/contracts/${c.id}/cancel`); setConfirmCancel(false); toast(t('ctr.cancelled_ok')); reload(); })}>
              {busy === 'cancel' ? <Spinner /> : <Icon name="ban" />}{t('ctr.cancel')}
            </button>
          </>}>
          <p className="text-sm">{t('ctr.cancel_confirm')}</p>
        </Modal>
      )}
    </div>
  );
}

function Countersign({ c, onDone }: { c: Contract; onDone: (r: { emailed: boolean; emailError: string | null }) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [name, setName] = useState(String(c.seller.full_name ?? ''));
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null); setBusy(true);
    try { onDone(await api.post<{ emailed: boolean; emailError: string | null }>(`/contracts/${c.id}/countersign`, { seller_signer_name: name, seller_signature: sig })); }
    catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  return (
    <section className="card overflow-hidden ring-2 ring-primary/40" aria-labelledby="cs-h">
      <div className="border-b border-line bg-primary-soft px-5 py-3">
        <h2 id="cs-h" className="flex items-center gap-2 font-semibold"><Icon name="pen" />{t('ctr.countersign_title')}</h2>
        <p className="mt-0.5 text-xs text-muted">{t('ctr.countersign_sub', { name: c.signer_name ?? '' })}</p>
      </div>
      <div className="space-y-3 p-5">
        {err && <div role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
        <Field label={t('ctr.your_name')} htmlFor="cs-name"><input id="cs-name" className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
        <div>
          <div className="label">{t('ctr.your_signature')}</div>
          <SignaturePad onChange={setSig} defaultName={name} rtl={c.language === 'fa'}
            labels={{ draw: t('sig.draw'), type: t('sig.type'), clear: t('sig.clear'), hint: t('sig.hint'), typePlaceholder: t('sig.type_ph'), canvasLabel: t('sig.canvas') }} />
        </div>
        <button className="btn-primary w-full justify-center" onClick={() => void go()} disabled={busy || !sig || !name.trim()}>
          {busy ? <Spinner /> : <Icon name="pen" />}{t('ctr.countersign_btn')}
        </button>
      </div>
    </section>
  );
}

function SigView({ label, name, img, at }: { label: string; name: string | null; img: string | null; at: string | null }) {
  const { date } = useI18n();
  return (
    <div>
      <div className="flex h-20 items-end">{img ? <img src={img} alt="" className="max-h-20 max-w-[16rem]" /> : <span className="text-sm italic text-muted">—</span>}</div>
      <div className="mt-1 border-t border-fg pt-1 text-sm font-medium" dir="auto">{name || label}</div>
      <div className="text-xs text-muted">{at ? date(at) : ''}</div>
    </div>
  );
}

// ───────────────────────────── templates ─────────────────────────────
function TemplateManager() {
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const langs = useLangs();
  const [rows, setRows] = useState<Tpl[] | null>(null);
  const [language, setLanguage] = useState<CLang>(langs[0] ?? 'de');
  const [edit, setEdit] = useState<Partial<Tpl> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.get<Tpl[]>('/contract-templates').then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);
  const shown = (rows ?? []).filter((r) => r.language === language);

  async function save() {
    if (!edit) return;
    setErr(null); setBusy(true);
    const body = { name: edit.name ?? '', language: edit.language ?? language, body: edit.body ?? '', is_active: edit.is_active !== 0, sort_order: edit.sort_order ?? 0 };
    try {
      if (edit.id) await api.put(`/contract-templates/${edit.id}`, body); else await api.post('/contract-templates', body);
      toast(t('ctr.tpl_saved')); setEdit(null); await load();
    } catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }
  async function del() {
    if (!edit?.id) return;
    setBusy(true);
    try { await api.del(`/contract-templates/${edit.id}`); setEdit(null); await load(); }
    catch (e) { setErr(errorText(e, i18n)); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title={t('ctr.templates')} subtitle={t('ctr.body_help')}
        actions={<>
          <Link to="/contracts" className="btn-ghost"><Icon name="chevronRight" flip />{t('ctr.back')}</Link>
          <button className="btn-primary" onClick={() => setEdit({ language, body: '', name: '', is_active: 1 })}><Icon name="plus" />{t('ctr.tpl_new')}</button>
        </>} />
      {langs.length > 1 && (
        <div className="mb-4 flex gap-1" role="tablist">
          {langs.map((l) => (
            <button key={l} role="tab" aria-selected={language === l} onClick={() => setLanguage(l)}
              className={`h-9 rounded-full px-3.5 text-sm font-medium ${language === l ? 'bg-primary text-on-primary' : 'bg-surface text-muted ring-1 ring-line hover:text-fg'}`}>{t(`lang.${l}` as MsgKey)}</button>
          ))}
        </div>
      )}
      <div className="card overflow-hidden">
        {!rows ? <Loading /> : shown.length === 0 ? <EmptyState icon="bookmark" title={t('ctr.tpl_empty')} /> : (
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id}>
                <button className="flex min-h-[56px] w-full items-center justify-between gap-3 px-5 py-3 text-start hover:bg-surface-2" onClick={() => setEdit(r)}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium" dir="auto">{r.name}</span>
                    <span className="block text-xs text-muted">{customVariables(r.body).length} {'{{…}}'} · {parseFields(r.body).length} {'[[…]]'}</span>
                  </span>
                  {r.is_active ? <Badge tone="success">{t('ctr.tpl_active')}</Badge> : <Badge>—</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {edit && (
        <Modal open wide onClose={() => setEdit(null)} title={edit.id ? edit.name ?? '' : t('ctr.tpl_new')}
          footer={<>
            {edit.id && <button className="btn-ghost me-auto text-danger" onClick={() => void del()} disabled={busy}><Icon name="trash" />{t('ctr.tpl_delete')}</button>}
            <button className="btn-secondary" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={() => void save()} disabled={busy || !edit.name?.trim() || !edit.body?.trim()}>{busy ? <Spinner /> : <Icon name="save" />}{t('common.save')}</button>
          </>}>
          <div className="space-y-3">
            {err && <div role="alert"><Alert tone="danger" onClose={() => setErr(null)}>{err}</Alert></div>}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label={t('ctr.tpl_name')} htmlFor="t-name"><input id="t-name" className="input" dir="auto" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <label className="flex min-h-[44px] items-center gap-2 self-end text-sm">
                <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={edit.is_active !== 0} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked ? 1 : 0 })} />
                {t('ctr.tpl_active')}
              </label>
            </div>
            <Field label={t('ctr.body')} hint={t('ctr.body_help')} htmlFor="t-body">
              <textarea id="t-body" className="input min-h-[22rem] font-mono text-[13px] leading-6" dir={(edit.language ?? language) === 'fa' ? 'rtl' : 'ltr'}
                value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} spellCheck={false} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
