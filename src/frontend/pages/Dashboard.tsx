import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { money } from '../currency';
import { EmptyState, Icon, Loading, PageHeader, StatusBadge } from '../ui';
import type { IconName } from '../ui';

interface Invoice { id: string; invoice_number: string | null; status: string; total_cents: number; currency: string; due_date: string | null; invoice_date: string | null; customer_name: string | null; document_type: string }
interface Received { id: string; payment_status: string }

export function Dashboard() {
  const { t, lang, num, date, tx } = useI18n();
  const nav = useNavigate();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [received, setReceived] = useState<Received[]>([]);
  const [status, setStatus] = useState<{ failedJobs: number; invalidEInvoices: number } | null>(null);

  useEffect(() => {
    api.get<Invoice[]>('/invoices').then(setInvoices).catch(() => setInvoices([]));
    api.get<Received[]>('/received').then(setReceived).catch(() => {});
    api.get<{ failedJobs: number; invalidEInvoices: number }>('/system/status').then(setStatus).catch(() => {});
  }, []);

  if (!invoices) return <Loading />;

  const open = invoices.filter((i) => ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(i.status));
  const overdue = invoices.filter((i) => i.status === 'OVERDUE');
  const paidByCur = new Map<string, number>();
  for (const i of invoices) if (i.status === 'PAID') paidByCur.set(i.currency, (paidByCur.get(i.currency) ?? 0) + i.total_cents);
  const paidText = paidByCur.size ? [...paidByCur].map(([c, v]) => money(v, c, lang)).join(' · ') : num(0);
  const unpaidReceived = received.filter((r) => r.payment_status !== 'PAID').length;

  return (
    <div>
      <PageHeader title={t('dash.title')} subtitle={t('dash.subtitle')}
        actions={<Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('nav.new_invoice')}</Link>} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Stat icon="file" label={t('dash.open')} value={num(open.length)} to="/invoices" />
        <Stat icon="clock" label={t('dash.overdue')} value={num(overdue.length)} tone={overdue.length ? 'danger' : undefined} to="/invoices" />
        <Stat icon="banknote" label={t('dash.paid')} value={paidText} tone="success" />
        <Stat icon="inbox" label={t('dash.unpaid_received')} value={num(unpaidReceived)} to="/inbox" />
        <Stat icon="alert" label={t('dash.invalid_einvoice')} value={num(status?.invalidEInvoices ?? 0)} tone={status?.invalidEInvoices ? 'warning' : undefined} to="/inbox" />
        <Stat icon="activity" label={t('dash.failed_jobs')} value={num(status?.failedJobs ?? 0)} tone={status?.failedJobs ? 'warning' : undefined} to="/settings/status" />
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="section-title">{t('dash.recent')}</h2>
          <Link to="/invoices" className="flex items-center gap-1 text-sm font-medium text-primary-fg hover:underline">
            {t('dash.view_all')}<Icon name="chevronRight" className="h-4 w-4" flip />
          </Link>
        </div>
        {invoices.length === 0 ? (
          <EmptyState icon="file" title={t('dash.empty')} action={<Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('dash.create_first')}</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('inv.number')}</th><th>{t('inv.customer')}</th><th>{t('inv.date')}</th><th className="text-end">{t('inv.amount')}</th><th>{t('inv.status')}</th></tr></thead>
              <tbody>
                {invoices.slice(0, 6).map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => nav(`/invoices/${r.id}`)}>
                    <td>{r.invoice_number ? <span className="font-mono text-[13px]" dir="ltr">{num(r.invoice_number)}</span> : <span className="text-muted">{t('inv.draft')}</span>}</td>
                    <td className="max-w-[14rem] truncate">{r.customer_name || '—'}<div className="text-xs text-muted">{tx(`doc.${r.document_type}`, r.document_type)}</div></td>
                    <td className="whitespace-nowrap text-muted">{date(r.invoice_date)}</td>
                    <td className="num whitespace-nowrap text-end font-medium">{money(r.total_cents, r.currency, lang)}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 flex items-start gap-2 text-xs text-muted"><Icon name="info" className="mt-0.5 h-3.5 w-3.5" />{t('dash.disclaimer')}</p>
    </div>
  );
}

function Stat({ icon, label, value, tone, to }: { icon: IconName; label: string; value: string; tone?: 'success' | 'warning' | 'danger'; to?: string }) {
  const toneCls = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg';
  const iconBg = tone === 'success' ? 'bg-success-soft text-success' : tone === 'warning' ? 'bg-warning-soft text-warning' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary-fg';
  const body = (
    <div className="card card-pad flex h-full flex-col gap-3 transition-colors hover:border-line-strong">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <div>
        <div className="text-[13px] text-muted">{label}</div>
        <div className={`tabular mt-0.5 break-words text-xl font-bold sm:text-2xl ${toneCls}`}>{value}</div>
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl">{body}</Link> : body;
}
