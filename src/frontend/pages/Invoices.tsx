import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { money } from '../currency';
import { normalizeText } from '../../lib/search';
import { EmptyState, Icon, Loading, PageHeader, StatusBadge } from '../ui';

interface Invoice { id: string; invoice_number: string | null; document_type: string; status: string; total_cents: number; currency: string; invoice_date: string | null; due_date: string | null; customer_name: string | null; customer_code: string | null }

const FILTERS = ['ALL', 'DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'] as const;

export function Invoices() {
  const { t, tx, lang, num, date } = useI18n();
  const nav = useNavigate();
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [q, setQ] = useState('');
  useEffect(() => { api.get<Invoice[]>('/invoices').then(setRows).catch(() => setRows([])); }, []);

  const shown = useMemo(() => {
    const nq = normalizeText(q);
    return (rows ?? []).filter((r) => {
      if (filter !== 'ALL' && !(filter === 'DRAFT' ? ['DRAFT', 'READY_TO_ISSUE'].includes(r.status) : r.status === filter)) return false;
      if (!nq) return true;
      return normalizeText(`${r.invoice_number ?? ''} ${r.customer_name ?? ''} ${r.customer_code ?? ''}`).includes(nq);
    });
  }, [rows, filter, q]);

  return (
    <div>
      <PageHeader title={t('inv.title')} subtitle={t('inv.subtitle')}
        actions={<>
          <a className="btn-secondary" href="/api/export/outgoing.csv"><Icon name="download" />{t('common.export_csv')}</a>
          <Link className="btn-primary" to="/invoices/new"><Icon name="plus" />{t('nav.new_invoice')}</Link>
        </>} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input ps-9" placeholder={t('inv.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('inv.search')} />
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('inv.filter')}>
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors ${filter === f ? 'bg-primary text-on-primary' : 'bg-surface text-muted ring-1 ring-line hover:text-fg'}`}>
              {f === 'ALL' ? t('common.all') : tx(`status.${f}`, f)}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {!rows ? <Loading /> : shown.length === 0 ? <EmptyState icon="file" title={t('inv.empty')} /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>{t('inv.number')}</th><th>{t('inv.customer')}</th><th>{t('inv.date')}</th><th>{t('inv.due')}</th><th className="text-end">{t('inv.amount')}</th><th>{t('inv.status')}</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => nav(`/invoices/${r.id}`)}>
                    <td>
                      <Link to={`/invoices/${r.id}`} className="font-medium text-primary-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                        {r.invoice_number ? <span className="font-mono text-[13px]" dir="ltr">{num(r.invoice_number)}</span> : t('inv.draft')}
                      </Link>
                    </td>
                    <td className="max-w-[16rem]">
                      <div className="truncate">{r.customer_name || '—'}</div>
                      <div className="text-xs text-muted">{tx(`doc.${r.document_type}`, r.document_type)}</div>
                    </td>
                    <td className="whitespace-nowrap text-muted">{date(r.invoice_date)}</td>
                    <td className="whitespace-nowrap text-muted">{date(r.due_date)}</td>
                    <td className="num whitespace-nowrap text-end font-medium">{money(r.total_cents, r.currency, lang)}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
