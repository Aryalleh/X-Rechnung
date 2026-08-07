import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { money } from '../currency';

interface Invoice { id: string; invoice_number: string | null; document_type: string; status: string; total_cents: number; currency: string; invoice_date: string | null; due_date: string | null; }

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'پیش‌نویس', READY_TO_ISSUE: 'آماده صدور', ISSUED: 'صادرشده', SENT: 'ارسال‌شده',
  PARTIALLY_PAID: 'پرداخت جزئی', PAID: 'پرداخت‌شده', OVERDUE: 'سررسیدگذشته', CANCELLED: 'لغوشده',
};

export function Invoices() {
  const [rows, setRows] = useState<Invoice[]>([]);
  useEffect(() => { api.get<Invoice[]>('/invoices').then(setRows).catch(() => {}); }, []);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">فاکتورها</h1>
        <div className="flex gap-2">
          <a className="btn-ghost" href="/api/export/outgoing.csv">خروجی CSV</a>
          <Link className="btn-primary" to="/invoices/new">فاکتور جدید</Link>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data">
          <thead><tr><th>شماره</th><th>نوع</th><th>تاریخ</th><th>سررسید</th><th>مبلغ</th><th>وضعیت</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono"><Link className="text-brand-600" to={`/invoices/${r.id}`}>{r.invoice_number ?? '—'}</Link></td>
                <td>{r.document_type}</td>
                <td dir="ltr">{r.invoice_date ?? ''}</td>
                <td dir="ltr">{r.due_date ?? ''}</td>
                <td className="font-mono">{money(r.total_cents, r.currency)}</td>
                <td>{STATUS_LABEL[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
