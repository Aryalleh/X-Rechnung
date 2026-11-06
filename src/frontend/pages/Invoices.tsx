import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { money } from '../currency';
import { normalizeText } from '../../lib/search';
import { EmptyState, Icon, Loading, Modal, PageHeader, StatusBadge, useToast } from '../ui';

interface Invoice {
  id: string; invoice_number: string | null; document_type: string; status: string; total_cents: number; currency: string;
  invoice_date: string | null; due_date: string | null; customer_name: string | null; customer_code: string | null;
  project_name: string | null; tax_rate_bp: number; tax_scenario: string; created_at: string;
}

const FILTERS = ['ALL', 'DRAFT', 'OPEN', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'] as const;
type Filter = (typeof FILTERS)[number];
const RANGES = ['all', '30d', 'ytd', 'last_year'] as const;
type Range = (typeof RANGES)[number];
interface SavedView { name: string; filter: Filter; range: Range; q: string }
const VIEWS_KEY = 'xr.invoiceViews';
const PAGE = 25;

function readViews(): SavedView[] {
  try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeViews(v: SavedView[]) { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* storage blocked */ } }

function matches(r: Invoice, f: Filter, today: string): boolean {
  switch (f) {
    case 'ALL': return true;
    case 'DRAFT': return ['DRAFT', 'READY_TO_ISSUE'].includes(r.status);
    case 'OPEN': return ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(r.status);
    case 'OVERDUE': return r.status === 'OVERDUE' || (['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(r.status) && !!r.due_date && r.due_date < today);
    default: return r.status === f;
  }
}

export function Invoices() {
  const { t, tx, lang, num, date } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const initial = params.get('status') as Filter | null;
  const [filter, setFilterState] = useState<Filter>(initial && FILTERS.includes(initial) ? initial : 'ALL');
  const [range, setRange] = useState<Range>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [views, setViews] = useState<SavedView[]>(readViews);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  useEffect(() => { api.get<Invoice[]>('/invoices?limit=2000').then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => { setPage(0); }, [filter, range, q]);

  const setFilter = (f: Filter) => {
    setFilterState(f);
    const next = new URLSearchParams(params);
    if (f === 'ALL') next.delete('status'); else next.set('status', f);
    setParams(next, { replace: true });
  };

  const today = new Date().toISOString().slice(0, 10);
  const inRange = useMemo(() => {
    const y = new Date().getFullYear();
    const from30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    return (rows ?? []).filter((r) => {
      const d = r.invoice_date ?? r.created_at.slice(0, 10);
      if (range === '30d') return d >= from30;
      if (range === 'ytd') return d >= `${y}-01-01`;
      if (range === 'last_year') return d >= `${y - 1}-01-01` && d < `${y}-01-01`;
      return true;
    });
  }, [rows, range]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, inRange.filter((r) => matches(r, f, today)).length])) as Record<Filter, number>, [inRange, today]);

  const shown = useMemo(() => {
    const nq = normalizeText(q);
    return inRange.filter((r) => matches(r, filter, today)
      && (!nq || normalizeText(`${r.invoice_number ?? ''} ${r.customer_name ?? ''} ${r.customer_code ?? ''} ${r.project_name ?? ''}`).includes(nq)));
  }, [inRange, filter, q, today]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);

  const taxNote = (r: Invoice) => {
    if (r.tax_rate_bp > 0) return t('inv.incl_vat', { rate: num(r.tax_rate_bp / 100) });
    if (r.tax_scenario === 'KLEINUNTERNEHMER_DE') return t('inv.tax_klein');
    if (r.tax_scenario === 'REVERSE_CHARGE_EU_B2B') return t('inv.tax_rc');
    if (r.tax_scenario === 'NON_EU_SERVICE') return t('inv.tax_non_eu');
    return '';
  };

  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, filter, range, q }];
    setViews(next); writeViews(next); setSaveOpen(false); setViewName('');
    toast(t('inv.view_saved'));
  }
  function removeView(name: string) { const next = views.filter((v) => v.name !== name); setViews(next); writeViews(next); }
  function applyView(v: SavedView) { setFilter(v.filter); setRange(v.range); setQ(v.q); }

  return (
    <div>
      <PageHeader title={t('inv.title')} subtitle={t('inv.subtitle')}
        actions={<>
          <a className="btn-secondary" href="/api/export/outgoing.csv"><Icon name="download" />{t('common.export_csv')}</a>
          <Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('nav.new_invoice')}</Link>
        </>} />

      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('inv.filter')}>
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors ${filter === f ? 'bg-primary text-on-primary' : 'bg-surface text-muted ring-1 ring-line hover:text-fg'}`}>
            {f === 'ALL' ? t('common.all') : f === 'OPEN' ? t('dash.open') : tx(`status.${f}`, f)}
            <span className={`tabular rounded-full px-1.5 text-[11px] ${filter === f ? 'bg-white/20' : 'bg-surface-2'}`}>{num(counts[f])}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input ps-9" placeholder={t('inv.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('inv.search')} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <Icon name="clock" className="h-4 w-4" />
          <span className="sr-only">{t('inv.range')}</span>
          <select className="input h-10 w-auto" value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map((r) => <option key={r} value={r}>{t(`inv.range_${r}`)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5 sm:ms-auto">
          {views.map((v) => (
            <span key={v.name} className="flex h-8 items-center rounded-full bg-primary-soft text-xs font-medium text-primary-fg">
              <button className="h-full ps-3 pe-1.5 hover:underline" onClick={() => applyView(v)}><Icon name="bookmark" className="me-1 inline h-3 w-3" />{v.name}</button>
              <button className="flex h-full w-7 items-center justify-center rounded-e-full hover:bg-primary/10" aria-label={`${t('common.delete')}: ${v.name}`} onClick={() => removeView(v.name)}><Icon name="x" className="h-3 w-3" /></button>
            </span>
          ))}
          <button className="btn-ghost btn-sm" onClick={() => setSaveOpen(true)}><Icon name="bookmark" />{t('inv.save_view')}</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {!rows ? <Loading /> : shown.length === 0 ? <EmptyState icon="file" title={t('inv.empty')} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>{t('inv.number')}</th><th>{t('inv.customer')}</th><th>{t('inv.date')}</th><th>{t('inv.due')}</th><th className="text-end">{t('inv.amount')}</th><th>{t('inv.status')}</th><th className="w-12"><span className="sr-only">{t('inv.actions')}</span></th></tr></thead>
                <tbody>
                  {slice.map((r) => {
                    const late = matches(r, 'OVERDUE', today) && r.status !== 'OVERDUE';
                    return (
                      <tr key={r.id} className="row-link" onClick={() => nav(`/invoices/${r.id}`)}>
                        <td>
                          <Link to={`/invoices/${r.id}`} className="font-medium text-primary-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                            {r.invoice_number ? <span className="font-mono text-[13px]" dir="ltr">{num(r.invoice_number)}</span> : t('inv.draft')}
                          </Link>
                          <div className="text-xs text-muted">{tx(`doc.${r.document_type}`, r.document_type)}</div>
                        </td>
                        <td className="max-w-[16rem]">
                          <div className="truncate"><bdi>{r.customer_name || '—'}</bdi></div>
                          {r.project_name && <div className="truncate text-xs text-muted" dir="auto">{r.project_name}</div>}
                        </td>
                        <td className="whitespace-nowrap text-muted">{date(r.invoice_date) || '—'}</td>
                        <td className={`whitespace-nowrap ${late ? 'font-medium text-danger' : 'text-muted'}`}>{date(r.due_date) || '—'}</td>
                        <td className="num whitespace-nowrap text-end">
                          <div className="font-medium">{money(r.total_cents, r.currency, lang)}</div>
                          {taxNote(r) && <div className="text-xs text-muted">{taxNote(r)}</div>}
                        </td>
                        <td><StatusBadge status={late ? 'OVERDUE' : r.status} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <a className="btn-ghost btn-sm btn-icon w-8" href={`/api/invoices/${r.id}/preview`} target="_blank" rel="noreferrer"
                            title={t('common.preview')} aria-label={`${t('common.preview')} ${r.invoice_number ?? ''}`}><Icon name="eye" /></a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-muted">
              <span>{t('inv.showing', { from: num(page * PAGE + 1), to: num(Math.min(shown.length, page * PAGE + PAGE)), total: num(shown.length) })}</span>
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><Icon name="chevronRight" className="h-4 w-4 rotate-180 rtl:rotate-0" />{t('inv.prev')}</button>
                <button className="btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>{t('inv.next')}<Icon name="chevronRight" className="h-4 w-4" flip /></button>
              </div>
            </div>
          </>
        )}
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={t('inv.save_view')}
        footer={<>
          <button className="btn-secondary" onClick={() => setSaveOpen(false)}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={saveView} disabled={!viewName.trim()}><Icon name="bookmark" />{t('common.save')}</button>
        </>}>
        <p className="mb-3 text-sm text-muted">{t('inv.save_view_hint')}</p>
        <label className="label" htmlFor="view-name">{t('inv.view_name')}</label>
        <input id="view-name" className="input" value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={40}
          onKeyDown={(e) => { if (e.key === 'Enter') saveView(); }} />
      </Modal>
    </div>
  );
}
