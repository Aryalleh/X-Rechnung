import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, euro } from '../api';

interface Detail {
  invoice: { id: string; invoice_number: string | null; status: string; total_cents: number; document_type: string; due_date: string | null; };
  items: { id: string; description: string; quantity_decimal: string; unit: string; line_total_cents: number }[];
  payments: { paidCents: number; remainingCents: number; payments: { payment_date: string; amount_cents: number; payment_method: string }[] };
  relations: { related_invoice_id: string; relation_type: string }[];
}

export function InvoiceDetail() {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pay, setPay] = useState({ payment_date: new Date().toISOString().slice(0, 10), amount_cents: 0, payment_method: 'BANK_TRANSFER' });
  const [pdfDoc, setPdfDoc] = useState<string | null>(null);

  const load = () => api.get<Detail>(`/invoices/${id}`).then((data) => {
    setD(data);
    setPay((p) => ({ ...p, amount_cents: data.payments.remainingCents }));
  }).catch((e) => setMsg((e as Error).message));

  useEffect(() => {
    load();
    api.get<{ id: string; document_role: string }[]>(`/documents/for/invoice/${id}`)
      .then((docs) => setPdfDoc(docs.find((x) => x.document_role === 'pdf')?.id ?? null)).catch(() => {});
    // eslint-disable-next-line
  }, [id]);

  async function issue() { setMsg(null); try { await api.post(`/invoices/${id}/issue`); load(); } catch (e) { setMsg((e as Error).message); } }
  async function storno() { setMsg(null); try { await api.post(`/invoices/${id}/storno`); load(); } catch (e) { setMsg((e as Error).message); } }
  async function send() { setMsg(null); try { await api.post(`/invoices/${id}/send`, {}); setMsg('ایمیل ارسال شد.'); load(); } catch (e) { setMsg((e as Error).message); } }
  async function addPayment() { setMsg(null); try { await api.post(`/payments/${id}`, pay); load(); } catch (e) { setMsg((e as Error).message); } }

  if (!d) return <div className="text-gray-500">{msg ?? 'در حال بارگذاری…'}</div>;
  const inv = d.invoice;
  const isDraft = inv.status === 'DRAFT' || inv.status === 'READY_TO_ISSUE';

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{inv.document_type} {inv.invoice_number ?? '(پیش‌نویس)'}</h1>
        <div className="flex gap-2">
          <a className="btn-ghost" href={`/api/invoices/${id}/preview`} target="_blank" rel="noreferrer">پیش‌نمایش</a>
          {pdfDoc && <a className="btn-ghost" href={`/api/documents/${pdfDoc}/download`}>دانلود PDF</a>}
          {isDraft && <button className="btn-primary" onClick={issue}>صدور نهایی</button>}
          {!isDraft && inv.status !== 'CANCELLED' && <button className="btn-ghost" onClick={send}>ارسال ایمیل</button>}
          {!isDraft && inv.status !== 'CANCELLED' && <button className="btn-ghost" onClick={storno}>Stornorechnung</button>}
        </div>
      </div>
      {msg && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}

      <div className="card mb-4 overflow-x-auto">
        <table className="data">
          <thead><tr><th>شرح</th><th>تعداد</th><th>واحد</th><th>مبلغ</th></tr></thead>
          <tbody>
            {d.items.map((it) => (
              <tr key={it.id}><td>{it.description}</td><td dir="ltr">{it.quantity_decimal}</td><td>{it.unit}</td><td className="font-mono">{euro(it.line_total_cents)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-left text-lg font-bold">Rechnungsbetrag: {euro(inv.total_cents)}</div>
        <p className="text-left text-xs text-gray-500">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
      </div>

      <div className="card mb-4">
        <div className="mb-2 font-semibold">پرداخت‌ها</div>
        <div className="mb-2 text-sm">پرداخت‌شده: {euro(d.payments.paidCents)} — مانده: {euro(d.payments.remainingCents)}</div>
        {!isDraft && (
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label">تاریخ</label><input className="input" type="date" value={pay.payment_date} onChange={(e) => setPay({ ...pay, payment_date: e.target.value })} /></div>
            <div><label className="label">مبلغ (Cent)</label><input className="input w-32" dir="ltr" type="number" value={pay.amount_cents} onChange={(e) => setPay({ ...pay, amount_cents: Number(e.target.value) })} /></div>
            <div><label className="label">روش</label>
              <select className="input" value={pay.payment_method} onChange={(e) => setPay({ ...pay, payment_method: e.target.value })}>
                {['BANK_TRANSFER', 'CASH', 'PAYPAL', 'CARD', 'OTHER'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <button className="btn-primary" onClick={addPayment}>ثبت پرداخت</button>
          </div>
        )}
      </div>

      {d.relations.length > 0 && (
        <div className="card text-sm">
          <div className="mb-2 font-semibold">اسناد مرتبط</div>
          {d.relations.map((r, i) => <div key={i}>{r.relation_type}: {r.related_invoice_id}</div>)}
        </div>
      )}
    </div>
  );
}
