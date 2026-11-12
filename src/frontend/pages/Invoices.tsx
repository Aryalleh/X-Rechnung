import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { money } from '../currency';
import { normalizeText } from '../../lib/search';
import { EmptyState, Icon, Loading, Modal, StatusBadge, useToast } from '../ui';

interface Invoice {
  id: string; invoice_number: string | null; document_type: string; status: string; total_cents: number; currency: string;
  invoice_date: string | null; due_date: string | null; customer_name: string | null; customer_code: string | null;
  project_name: string | null; tax_rate_bp: number; tax_scenario: string; created_at: string;
}

const FILTERS = ['ALL', 'DRAFT', 'OPEN', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'] as const;
/** Tabs shown in the design; the rest live in the filter menu. */
const TABS = ['ALL', 'DRAFT', 'SENT', 'PAID', 'OVERDUE'] as const;
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
  const [filterMenu, setFilterMenu] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!filterMenu && !rowMenu) return;
    const close = () => { setFilterMenu(false); setRowMenu(null); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [filterMenu, rowMenu]);
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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('inv.title')}</h1>
          <nav className="mt-1 flex items-center gap-1.5 text-xs text-muted" aria-label="breadcrumb">
            <span>{t('inv.crumb_all')}</span><Icon name="chevronRight" className="h-3 w-3" flip />
            <span className="font-medium text-fg">{t('inv.crumb_out')}</span>
          </nav>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href="/api/export/outgoing.csv"><Icon name="download" />{t('common.export_csv')}</a>
          <Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('nav.new_invoice')}</Link>
        </div>
      </div>

      <div className="-mx-1 mb-6 flex gap-6 overflow-x-auto border-b border-line px-1" role="tablist" aria-label={t('inv.filter')}>
        {TABS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-[15px] font-medium transition-colors ${filter === f ? 'border-primary text-primary-fg' : 'border-transparent text-muted hover:text-fg'}`}>
            {f === 'ALL' ? t('inv.all_invoices') : tx(`status.${f}`, f)}
            <span className={`tabular rounded-full px-2 py-0.5 text-[11px] font-semibold ${f === 'OVERDUE' && counts[f] ? 'bg-danger-soft text-danger' : filter === f ? 'bg-primary-soft text-primary-fg' : 'bg-surface-2 text-muted'}`}>{num(counts[f])}</span>
          </button>
        ))}
        {!TABS.includes(filter as (typeof TABS)[number]) && (
          <span className="-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 border-primary px-1 pb-3 pt-1 text-[15px] font-medium text-primary-fg">
            {filter === 'OPEN' ? t('dash.open') : tx(`status.${filter}`, filter)}
            <span className="tabular rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold">{num(counts[filter])}</span>
          </span>
        )}
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-96">
          <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input h-11 bg-surface ps-10" placeholder={t('inv.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('inv.search')} />
        </div>
        <div className="flex items-center gap-3 sm:ms-auto">
          <div className="flex rounded-lg border border-line bg-surface p-1 text-[13px] font-medium" role="group" aria-label={t('inv.range')}>
            {(['30d', 'ytd'] as const).map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setRange(range === r ? 'all' : r)}
                className={`h-8 rounded-md px-3 transition-colors ${range === r ? 'bg-surface-2 font-semibold text-fg' : 'text-muted hover:text-fg'}`}>{t(`inv.range_${r}`)}</button>
            ))}
          </div>
          <div className="relative">
            <button className="btn-secondary btn-icon h-11 w-11" aria-label={t('inv.more_filters')} aria-expanded={filterMenu} onClick={(e) => { e.stopPropagation(); setFilterMenu((o) => !o); }}>
              <Icon name="sliders" className="h-[18px] w-[18px]" />
            </button>
            {filterMenu && (
              <div className="absolute end-0 top-12 z-20 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="eyebrow px-2 pb-1 pt-1 text-[11px]">{t('inv.status')}</div>
                {FILTERS.map((f) => (
                  <button key={f} onClick={() => { setFilter(f); setFilterMenu(false); }}
                    className={`flex h-9 w-full items-center justify-between rounded-lg px-2 text-sm ${filter === f ? 'bg-primary-soft text-primary-fg' : 'hover:bg-surface-2'}`}>
                    <span>{f === 'ALL' ? t('common.all') : f === 'OPEN' ? t('dash.open') : tx(`status.${f}`, f)}</span>
                    <span className="tabular text-xs text-muted">{num(counts[f])}</span>
                  </button>
                ))}
                <div className="eyebrow px-2 pb-1 pt-3 text-[11px]">{t('inv.range')}</div>
                {RANGES.map((r) => (
                  <button key={r} onClick={() => { setRange(r); setFilterMenu(false); }}
                    className={`flex h-9 w-full items-center rounded-lg px-2 text-sm ${range === r ? 'bg-primary-soft text-primary-fg' : 'hover:bg-surface-2'}`}>{t(`inv.range_${r}`)}</button>
                ))}
                {views.length > 0 && <>
                  <div className="eyebrow px-2 pb-1 pt-3 text-[11px]">{t('inv.saved_views')}</div>
                  {views.map((v) => (
                    <div key={v.name} className="flex items-center">
                      <button className="flex h-9 flex-1 items-center gap-2 truncate rounded-lg px-2 text-sm hover:bg-surface-2" onClick={() => { applyView(v); setFilterMenu(false); }}><Icon name="star" className="h-3.5 w-3.5 text-primary-fg" />{v.name}</button>
                      <button className="btn-ghost btn-icon h-8 w-8" aria-label={`${t('common.delete')}: ${v.name}`} onClick={() => removeView(v.name)}><Icon name="x" className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {!rows ? <Loading /> : shown.length === 0 ? <EmptyState icon="file" title={t('inv.empty')} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>{t('inv.number')}</th><th>{t('inv.customer_type')}</th><th>{t('inv.issue_date')}</th><th>{t('inv.due')}</th><th>{t('inv.amount')}</th><th>{t('inv.status')}</th><th className="text-end">{t('inv.actions')}</th></tr></thead>
                <tbody>
                  {slice.map((r) => {
                    const late = matches(r, 'OVERDUE', today) && r.status !== 'OVERDUE';
                    return (
                      <tr key={r.id} className="row-link" onClick={() => nav(`/invoices/${r.id}`)}>
                        <td>
                          <Link to={`/invoices/${r.id}`} className={`font-semibold hover:underline ${r.invoice_number ? 'text-primary-fg' : 'italic text-muted'}`} onClick={(e) => e.stopPropagation()}>
                            {r.invoice_number ? <span dir="ltr">{num(r.invoice_number)}</span> : t('inv.draft')}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-muted">{tx(`doc.${r.document_type}`, r.document_type)}</div>
                        </td>
                        <td className="max-w-[16rem]">
                          <div className="truncate"><bdi>{r.customer_name || '—'}</bdi></div>
                          <div className="truncate text-sm text-muted"><bdi>{r.project_name || (r.customer_code ? num(r.customer_code) : '')}</bdi></div>
                        </td>
                        <td className="whitespace-nowrap">{date(r.invoice_date) || '-'}</td>
                        <td className={`whitespace-nowrap ${late ? 'font-medium text-danger' : ''}`}>{date(r.due_date) || '-'}</td>
                        <td className="num whitespace-nowrap">
                          <div className="font-semibold">{money(r.total_cents, r.currency, lang)}</div>
                          {taxNote(r) && <div className="text-[11px] text-muted">{taxNote(r)}</div>}
                        </td>
                        <td><StatusBadge status={late ? 'OVERDUE' : r.status} /></td>
                        <td className="relative text-end" onClick={(e) => e.stopPropagation()}>
                          <button className="btn-ghost btn-icon h-8 w-8" aria-label={`${t('inv.actions')} ${r.invoice_number ?? ''}`} aria-expanded={rowMenu === r.id}
                            onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === r.id ? null : r.id); }}><Icon name="more" className="h-5 w-5" /></button>
                          {rowMenu === r.id && (
                            <div className="absolute end-6 top-12 z-20 w-48 rounded-xl border border-line bg-surface p-1.5 text-start shadow-lg">
                              <Link to={`/invoices/${r.id}`} className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2"><Icon name="file" />{t('inv.open')}</Link>
                              <a href={`/api/invoices/${r.id}/preview`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2"><Icon name="eye" />{t('common.preview')}</a>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4 text-sm text-muted">
              <span>{t('inv.showing', { from: num(page * PAGE + 1), to: num(Math.min(shown.length, page * PAGE + PAGE)), total: num(shown.length) })}</span>
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('inv.prev')}</button>
                <button className="btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>{t('inv.next')}</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary-soft/60 p-4 sm:flex-row sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary-fg shadow-sm"><Icon name="star" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t('inv.save_view_title')}</div>
          <div className="text-[13px] text-primary-fg">{t('inv.save_view_hint')}</div>
        </div>
        <button className="btn-secondary btn-sm text-primary-fg" onClick={() => setSaveOpen(true)}>{t('inv.save_view')}</button>
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
