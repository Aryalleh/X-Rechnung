import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { getCur, money } from '../currency';
import { EmptyState, Icon, Loading, PageHeader, StatusBadge } from '../ui';
import type { IconName } from '../ui';
import { BarChart } from '../components/Charts';

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
    // Invoice count per month: this year vs last year.
    const y = now.getFullYear();
    const all12 = Array.from({ length: 12 }, (_, m) => monthFmt.format(new Date(Date.UTC(y, m, 1))));
    const count = (year: number) => Array.from({ length: 12 }, (_, m) => {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`;
      return billed.filter((i) => keyOf((i.invoice_date ?? i.issued_at)!) === key).length;
    });
    return { months: months.map((m) => m.label), rev, all12, cur: count(y), prev: count(y - 1), year: y };
  }, [invoices, range, chartCur, locale]);

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

  // Activity feed: resolve entity names from the lists we already have.
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const ctrById = new Map(contracts.map((c) => [c.id, c]));
  const recById = new Map(received.map((r) => [r.id, r]));
  const activity = audit.filter((e) => ACTIVITY[e.event_type]).slice(0, 8).map((e) => {
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Stat icon="file" label={t('dash.open')} value={sumText(open.map((i) => ({ cents: i.total_cents, cur: i.currency })), lang, zero)}
          sub={t('dash.n_invoices', { n: open.length })} to="/invoices?status=OPEN" />
        <Stat icon="clock" label={t('dash.overdue')} value={sumText(overdue.map((i) => ({ cents: i.total_cents, cur: i.currency })), lang, zero)}
          sub={t('dash.n_overdue', { n: overdue.length })} tone={overdue.length ? 'danger' : undefined} to="/invoices?status=OVERDUE" />
        <Stat icon="banknote" label={t('dash.paid_month')} value={sumText(paidMonth.map((i) => ({ cents: i.total_cents, cur: i.currency })), lang, zero)}
          sub={t('dash.this_month')} tone="success" to="/invoices?status=PAID" />
        <Stat icon="inbox" label={t('dash.unpaid_received')}
          value={sumText(unpaidReceived.filter((r) => r.gross_amount_cents != null).map((r) => ({ cents: r.gross_amount_cents!, cur: r.currency ?? 'EUR' })), lang, zero)}
          sub={t('dash.n_invoices', { n: unpaidReceived.length })} to="/inbox" />
        <Stat icon="alert" label={t('dash.invalid_einvoice')} value={num(status?.invalidEInvoices ?? 0)}
          sub={status?.invalidEInvoices ? t('dash.needs_review') : t('dash.all_valid')} tone={status?.invalidEInvoices ? 'warning' : undefined} to="/inbox" />
        <Stat icon="activity" label={t('dash.failed_jobs')} value={num(status?.failedJobs ?? 0)}
          sub={status?.failedJobs ? t('dash.needs_review') : t('dash.healthy')} tone={status?.failedJobs ? 'warning' : undefined} to="/settings/status" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="section-title">{t('dash.revenue_trend')}</h2>
              <p className="text-xs text-muted">{t('dash.billed_in', { cur: tx(`cur.${chartCur}`, chartCur) })}</p>
            </div>
            <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-medium" role="group" aria-label={t('dash.revenue_trend')}>
              {([6, 12] as const).map((r) => (
                <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}
                  className={`h-8 rounded-md px-3 transition-colors ${range === r ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
                  {r === 6 ? t('dash.last_6m') : t('dash.last_12m')}
                </button>
              ))}
            </div>
          </div>
          <BarChart labels={charts.months} caption={t('dash.revenue_trend')}
            series={[{ key: 'rev', label: t('dash.billed'), color: 1, values: charts.rev }]}
            format={(v) => money(v, chartCur, lang)} tick={short} emptyText={t('dash.no_chart_data')} />
        </section>
        <section className="card card-pad">
          <div className="mb-3">
            <h2 className="section-title">{t('dash.monthly_invoices')}</h2>
            <p className="text-xs text-muted">{t('dash.monthly_sub')}</p>
          </div>
          <BarChart labels={charts.all12} caption={t('dash.monthly_invoices')}
            series={[
              { key: 'cur', label: t('dash.year_current', { y: charts.year }), color: 1, values: charts.cur },
              { key: 'prev', label: t('dash.year_previous', { y: charts.year - 1 }), color: 2, values: charts.prev },
            ]}
            format={(v) => num(v)} tick={(v) => num(Math.round(v))} emptyText={t('dash.no_chart_data')} />
        </section>
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="section-title">{t('dash.activity')}</h2>
          <Link to="/invoices" className="flex items-center gap-1 text-sm font-medium text-primary-fg hover:underline">
            {t('dash.view_all')}<Icon name="chevronRight" className="h-4 w-4" flip />
          </Link>
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
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.tone}`}><Icon name={a.icon} className="h-4 w-4" /></span>
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
                      <td className="num whitespace-nowrap text-end font-medium">{amount || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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

function Stat({ icon, label, value, sub, tone, to }: { icon: IconName; label: string; value: string; sub?: string; tone?: 'success' | 'warning' | 'danger'; to?: string }) {
  const toneCls = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg';
  const iconBg = tone === 'success' ? 'bg-success-soft text-success' : tone === 'warning' ? 'bg-warning-soft text-warning' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary-fg';
  const body = (
    <div className="card card-pad flex h-full flex-col gap-3 transition-colors hover:border-line-strong">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <div>
        <div className="text-[13px] text-muted">{label}</div>
        <div className={`tabular mt-0.5 break-words text-xl font-bold sm:text-2xl ${toneCls}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl">{body}</Link> : body;
}

