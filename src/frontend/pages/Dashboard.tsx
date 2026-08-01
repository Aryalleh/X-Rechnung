import { useEffect, useState } from 'react';
import { api, euro } from '../api';

interface Invoice { id: string; invoice_number: string | null; status: string; total_cents: number; due_date: string | null; }
interface Received { id: string; validation_status: string; payment_status: string; }

export function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [received, setReceived] = useState<Received[]>([]);
  const [status, setStatus] = useState<{ failedJobs: number; invalidEInvoices: number } | null>(null);

  useEffect(() => {
    api.get<Invoice[]>('/invoices').then(setInvoices).catch(() => {});
    api.get<Received[]>('/received').then(setReceived).catch(() => {});
    api.get<{ failedJobs: number; invalidEInvoices: number }>('/system/status').then(setStatus).catch(() => {});
  }, []);

  const open = invoices.filter((i) => ['ISSUED', 'SENT', 'PARTIALLY_PAID'].includes(i.status));
  const overdue = invoices.filter((i) => i.status === 'OVERDUE');
  const paidThisYear = invoices.filter((i) => i.status === 'PAID').reduce((a, i) => a + i.total_cents, 0);
  const unpaidReceived = received.filter((r) => r.payment_status !== 'PAID').length;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">داشبورد</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title="فاکتورهای باز" value={String(open.length)} />
        <Card title="سررسیدگذشته" value={String(overdue.length)} tone="warn" />
        <Card title="درآمد پرداخت‌شده (Paid)" value={euro(paidThisYear)} />
        <Card title="دریافتی پرداخت‌نشده" value={String(unpaidReceived)} />
        <Card title="E-Rechnung نامعتبر" value={String(status?.invalidEInvoices ?? 0)} tone="warn" />
        <Card title="پردازش‌های ناموفق" value={String(status?.failedJobs ?? 0)} tone={status?.failedJobs ? 'warn' : undefined} />
      </div>

      <div className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        این گزارش‌ها اطلاعاتی هستند و به‌عنوان اظهارنامه مالیاتی رسمی محسوب نمی‌شوند. این نرم‌افزار جایگزین مشاوره مالیاتی نیست.
      </div>
    </div>
  );
}

function Card({ title, value, tone }: { title: string; value: string; tone?: 'warn' }) {
  return (
    <div className="card">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  );
}
