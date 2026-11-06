import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { getCur, money } from '../currency';
import { EmptyState, Icon, Loading, PageHeader, StatusBadge } from '../ui';
import type { IconName } from '../ui';
import { BarChart, Donut, LineChart } from '../components/Charts';

interface Invoice { id: string; invoice_number: string | null; status: string; total_cents: number; currency: string; due_date: string | null; invoice_date: string | null; issued_at: string | null; customer_name: string | null; document_type: string }
interface Received { id: string; payment_status: string; gross_amount_cents: number | null; currency: string | null; supplier_name: string | null; invoice_number: string | null }
interface ContractRow { id: string; contract_number: string; title: string; status: string; customer_company: string | null; customer_person: string | null }
interface AuditEvent { id: string; entity_type: string; entity_id: string | null; event_type: string; actor_email: string | null; created_at: string; metadata_json: string | null }

const OPEN = ['ISSUED', 'SENT', 'PARTIALLY_PAID'];
const BILLED = ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
/** Business events worth showing on the dashboard (no logins, settings, cron …). */
const ACTIVITY: Record<string, { icon: IconName; tone: string }> = {
  INVOICE_DRAFT_CREATED: { icon: 'filePlus', tone: 'bg-surface-2 text-muted' },
  INVOICE_ISSUED: { icon: 'file', tone: 'bg-primary-soft text-primary-fg' },
  INVOICE_SENT: { icon: 'send', tone: 'bg-primary-soft text-primary-fg' },
  PAYMENT_RECORDED: { icon: 'banknote', tone: 'bg-success-soft text-success' },
  CANCELLATION_CREATED: { icon: 'ban', tone: 'bg-danger-soft text-danger' },
  CUSTOMER_CREATED: { icon: 'user', tone: 'bg-surface-2 text-muted' },
  CONTRACT_SENT: { icon: 'send', tone: 'bg-primary-soft text-primary-fg' },
  CONTRACT_VIEWED: { icon: 'eye', tone: 'bg-warning-soft text-warning' },
  CONTRACT_CUSTOMER_SIGNED: { icon: 'pen', tone: 'bg-warning-soft text-warning' },
  CONTRACT_SIGNED: { icon: 'fileSign', tone: 'bg-success-soft text-success' },
  EMAIL_RECEIVED: { icon: 'inbox', tone: 'bg-info-soft text-info' },
  EINVOICE_VALIDATED: { icon: 'check', tone: 'bg-info-soft text-info' },
  DUPLICATE_DETECTED: { icon: 'alert', tone: 'bg-warning-soft text-warning' },
  PAYMENT_STATUS_CHANGED: { icon: 'banknote', tone: 'bg-success-soft text-success' },
};

/** Sum minor units per currency and render "€ 1.200,00 · 5.000.000 تومان". */
function sumText(rows: { cents: number; cur: string }[], lang: 'fa' | 'de' | 'en', zero: string): string {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.cur, (m.get(r.cur) ?? 0) + r.cents);
  return m.size ? [...m].map(([c, v]) => money(v, c, lang)).join(' · ') : zero;
}

export function Dashboard() {
  const { t, lang, num, tx, locale } = useI18n();
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [received, setReceived] = useState<Received[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState<{ failedJobs: number; invalidEInvoices: number } | null>(null);
  const [range, setRange] = useState<6 | 12>(6);
  const [countYear, setCountYear] = useState<'current' | 'previous'>('current');

  useEffect(() => {
    api.get<Invoice[]>('/invoices?limit=2000').then(setInvoices).catch(() => setInvoices([]));
    api.get<Received[]>('/received').then(setReceived).catch(() => {});
    api.get<ContractRow[]>('/contracts').then(setContracts).catch(() => {});
    api.get<AuditEvent[]>('/system/audit?limit=300').then(setAudit).catch(() => {});
    api.get<{ failedJobs: number; invalidEInvoices: number }>('/system/status').then(setStatus).catch(() => {});
  }, []);

  // Charts use the most-billed currency so amounts are never mixed.
  const chartCur = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of invoices ?? []) if (BILLED.includes(i.status)) c.set(i.currency, (c.get(i.currency) ?? 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EUR';
  }, [invoices]);

  const charts = useMemo(() => {
    const now = new Date();
    const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const keyOf = (iso: string) => iso.slice(0, 7);
    const billed = (invoices ?? []).filter((i) => BILLED.includes(i.status) && (i.invoice_date || i.issued_at));
    // Revenue trend: last N months, billed amount in chartCur.
    const months: { key: string; label: string }[] = [];
    for (let k = range - 1; k >= 0; k--) {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - k, 1));
      months.push({ key: d.toISOString().slice(0, 7), label: monthFmt.format(d) });
    }
    const rev = months.map((m) => billed.filter((i) => i.currency === chartCur && keyOf((i.invoice_date ?? i.issued_at)!) === m.key).reduce((a, i) => a + i.total_cents, 0));
    // Invoices per month: issued vs paid, for the last 6 months of the chosen year.
    const y = now.getFullYear() - (countYear === 'previous' ? 1 : 0);
    const endMonth = countYear === 'previous' ? 11 : now.getMonth();
    const cm = Array.from({ length: 6 }, (_, k) => new Date(Date.UTC(y, endMonth - 5 + k, 1)));
    const inMonth = (i: Invoice, d: Date) => keyOf((i.invoice_date ?? i.issued_at)!) === d.toISOString().slice(0, 7);
    return {
      months: months.map((m) => m.label), rev,
      cmLabels: cm.map((d) => monthFmt.format(d)),
      sent: cm.map((d) => billed.filter((i) => inMonth(i, d)).length),
      paid: cm.map((d) => billed.filter((i) => i.status === 'PAID' && inMonth(i, d)).length),
    };
  }, [invoices, range, countYear, chartCur, locale]);

  if (!invoices) return <Loading />;

  const today = new Date().toISOString().slice(0, 10);
  const monthKey = today.slice(0, 7);
  const open = invoices.filter((i) => OPEN.includes(i.status));
  const overdue = invoices.filter((i) => i.status === 'OVERDUE' || (OPEN.includes(i.status) && i.due_date && i.due_date < today));
  const paidMonth = invoices.filter((i) => i.status === 'PAID' && (i.invoice_date ?? i.issued_at ?? '').startsWith(monthKey));
  const unpaidReceived = received.filter((r) => r.payment_status !== 'PAID');
  const zero = num(0);
  const short = (v: number) => {
    const c = getCur(chartCur);
    const major = v / 10 ** c.decimals;
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(major);
  };

  // Open amount per customer (chart currency only): top 3 + others.
  const openByCust = (() => {
    const m = new Map<string, number>();
    for (const i of [...open, ...overdue.filter((o) => !open.includes(o))]) if (i.currency === chartCur) m.set(i.customer_name || '—', (m.get(i.customer_name || '—') ?? 0) + i.total_cents);
    const sorted = [...m].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 3).map(([label, value]) => ({ label, value }));
    const rest = sorted.slice(3).reduce((a, [, v]) => a + v, 0);
    return rest ? [...top, { label: t('dash.others'), value: rest }] : top;
  })();

  // Activity feed: resolve entity names from the lists we already have.
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const ctrById = new Map(contracts.map((c) => [c.id, c]));
  const recById = new Map(received.map((r) => [r.id, r]));
  const activity = audit.filter((e) => ACTIVITY[e.event_type]).slice(0, 6).map((e) => {
    let entity = '', ref = '', to: string | null = null, amount = '', badge: string | null = null;
    if (e.entity_type === 'invoice' && e.entity_id) {
      const i = invById.get(e.entity_id);
      entity = i?.customer_name ?? ''; ref = i?.invoice_number ?? t('inv.draft'); to = `/invoices/${e.entity_id}`;
      if (i) { amount = money(i.total_cents, i.currency, lang); badge = i.status; }
    } else if (e.entity_type === 'contract' && e.entity_id) {
      const c = ctrById.get(e.entity_id);
      entity = c?.customer_company || c?.customer_person || ''; ref = c?.contract_number ?? ''; to = `/contracts/${e.entity_id}`;
      if (c) badge = c.status;
    } else if (e.entity_type === 'received_invoice' && e.entity_id) {
      const r = recById.get(e.entity_id);
      entity = r?.supplier_name ?? ''; ref = r?.invoice_number ?? ''; to = `/inbox/${e.entity_id}`;
      if (r?.gross_amount_cents != null) amount = money(r.gross_amount_cents, r.currency ?? 'EUR', lang);
    } else if (e.entity_type === 'customer') { to = '/customers'; }
    return { e, entity, ref, to, amount, badge };
  });

  return (
    <div>
      <PageHeader title={t('dash.title')} subtitle={t('dash.subtitle')}
        actions={<Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('nav.new_invoice')}</Link>} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={t('dash.open')} value={sumText(open.map((i) => ({ cents: i.total_cents, cur: i.currency })), lang, zero)}
          sub={t('dash.n_invoices', { n: open.length })} subTone="primary" to="/invoices?status=OPEN" />
        <Stat label={t('dash.overdue')} value={sumText(overdue.map((i) => ({ cents: i.total_cents, cur: i.currency })), lang, zero)}
          sub={t('dash.n_overdue', { n: overdue.length })} tone={overdue.length ? 'danger' : undefined} subTone="danger" accent={overdue.length > 0} to="/invoices?status=OVERDUE" />
        <Stat label={t('dash.paid_month')} value={sumText(paidMonth.map((i) => ({ cents: i.total_cents, cur: i.currency })), lang, zero)}
          sub={t('dash.this_month')} subTone="success" to="/invoices?status=PAID" />
        <Stat label={t('dash.unpaid_received')}
          value={sumText(unpaidReceived.filter((r) => r.gross_amount_cents != null).map((r) => ({ cents: r.gross_amount_cents!, cur: r.currency ?? 'EUR' })), lang, zero)}
          sub={unpaidReceived.length ? t('dash.n_invoices', { n: unpaidReceived.length }) : t('dash.nothing_due')} subTone="warning" to="/inbox" />
        <Stat label={t('dash.invalid_einvoice')} value={num(status?.invalidEInvoices ?? 0)}
          sub={status?.invalidEInvoices ? t('dash.needs_review') : t('dash.all_valid')} tone={status?.invalidEInvoices ? 'warning' : undefined} to="/inbox" />
        <Stat label={t('dash.failed_jobs')} value={num(status?.failedJobs ?? 0)}
          sub={status?.failedJobs ? t('dash.needs_review') : t('dash.healthy')} tone={status?.failedJobs ? 'warning' : undefined} to="/settings/status" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{t('dash.revenue_trend')}</h2>
              <p className="text-xs text-muted">{t('dash.billed_in', { cur: tx(`cur.${chartCur}`, chartCur) })}</p>
            </div>
            <select className="input h-9 w-auto bg-surface text-[13px]" aria-label={t('dash.revenue_trend')} value={range} onChange={(e) => setRange(Number(e.target.value) as 6 | 12)}>
              <option value={6}>{t('dash.last_6m')}</option>
              <option value={12}>{t('dash.last_12m')}</option>
            </select>
          </div>
          <LineChart labels={charts.months} values={charts.rev} caption={t('dash.revenue_trend')} seriesLabel={t('dash.billed')}
            format={(v) => money(v, chartCur, lang)} tick={short} emptyText={t('dash.no_chart_data')} />
        </section>
        <section className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t('dash.monthly_invoices')}</h2>
            <select className="input h-9 w-auto bg-surface text-[13px]" aria-label={t('dash.monthly_invoices')} value={countYear} onChange={(e) => setCountYear(e.target.value as 'current' | 'previous')}>
              <option value="current">{t('dash.current_year')}</option>
              <option value="previous">{t('dash.previous_year')}</option>
            </select>
          </div>
          <BarChart labels={charts.cmLabels} caption={t('dash.monthly_invoices')}
            series={[
              { key: 'sent', label: t('dash.series_sent'), color: 1, values: charts.sent },
              { key: 'paid', label: t('dash.series_paid'), color: 2, values: charts.paid },
            ]}
            format={(v) => num(v)} tick={(v) => num(Math.round(v))} emptyText={t('dash.no_chart_data')} />
        </section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-6 pb-2 pt-6">
            <h2 className="text-lg font-semibold">{t('dash.activity')}</h2>
            <Link to="/invoices" className="text-sm font-medium text-primary-fg hover:underline">{t('dash.view_all')}</Link>
          </div>
          {invoices.length === 0 && activity.length === 0 ? (
            <EmptyState icon="file" title={t('dash.empty')} action={<Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('dash.create_first')}</Link>} />
          ) : activity.length === 0 ? (
            <EmptyState icon="activity" title={t('dash.no_activity')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>{t('dash.col_activity')}</th><th>{t('dash.col_entity')}</th><th>{t('inv.status')}</th><th className="text-end">{t('inv.amount')}</th></tr></thead>
                <tbody>
                  {activity.map(({ e, entity, ref, to, amount, badge }) => {
                    const a = ACTIVITY[e.event_type]!;
                    return (
                      <tr key={e.id} className={to ? 'row-link' : ''} onClick={() => to && nav(to)}>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${a.tone}`}><Icon name={a.icon} className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="font-medium">{tx(`act.${e.event_type}`, e.event_type)}</div>
                              <div className="text-xs text-muted">{relTime(e.created_at, locale)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[16rem]">
                          <div className="truncate"><bdi>{entity || '—'}</bdi></div>
                          {ref && <div className="font-mono text-xs text-muted" dir="ltr">{num(ref)}</div>}
                        </td>
                        <td>{badge ? <StatusBadge status={badge} /> : <span className="text-muted">—</span>}</td>
                        <td className="num whitespace-nowrap text-end font-semibold">{amount || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card p-6">
          <h2 className="mb-6 text-lg font-semibold">{t('dash.open_by_customer')}</h2>
          <Donut slices={openByCust} caption={t('dash.open')} format={(v) => money(v, chartCur, lang)} emptyText={t('dash.no_open')} />
        </section>
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs text-muted"><Icon name="info" className="mt-0.5 h-3.5 w-3.5" />{t('dash.disclaimer')}</p>
    </div>
  );
}

function relTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(d);
}

function Stat({ label, value, sub, tone, subTone, accent, to }: { label: string; value: string; sub?: string; tone?: 'success' | 'warning' | 'danger'; subTone?: 'primary' | 'success' | 'warning' | 'danger'; accent?: boolean; to?: string }) {
  const toneCls = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg';
  const subCls = subTone === 'primary' ? 'text-primary-fg' : subTone === 'success' ? 'text-success' : subTone === 'warning' ? 'text-warning' : subTone === 'danger' ? 'text-danger' : 'text-muted';
  const body = (
    <div className={`card flex h-full flex-col p-5 transition-colors hover:border-line-strong ${accent ? 'border-s-4 border-s-danger' : ''}`}>
      <div className="eyebrow">{label}</div>
      <div className={`tabular mt-2 break-words text-xl font-bold leading-tight 2xl:text-2xl ${toneCls}`}>{value}</div>
      {sub && <div className={`mt-2 text-xs font-medium ${subCls}`}>{sub}</div>}
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl">{body}</Link> : body;
}
