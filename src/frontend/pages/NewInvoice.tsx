import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, euro } from '../api';

interface Customer { id: string; customer_code: string; company_name: string | null; last_name: string | null; city: string | null; }
interface Template { id: string; name: string; default_description: string; unit: string; default_price_cents: number; }
interface Item { description: string; quantity_decimal: string; unit: string; unit_price_cents: number; discount_cents: number; rights_text?: string; }

/** Fast invoice flow: enter customer code → Enter → customer + seller auto-load
 * → pick services → issue. §19 Kleinunternehmer: no VAT anywhere. */
export function NewInvoice() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [projectName, setProjectName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const servicesRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<Template[]>('/templates?active=1').then(setTemplates).catch(() => {}); }, []);

  async function lookup() {
    setErr(null);
    try {
      const c = await api.get<Customer>(`/customers/by-code/${encodeURIComponent(code.trim())}`);
      setCustomer(c);
      setTimeout(() => servicesRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { setErr((e as Error).message); setCustomer(null); }
  }

  function addTemplate(t: Template) {
    setItems((prev) => [...prev, { description: t.default_description, quantity_decimal: '1', unit: t.unit, unit_price_cents: t.default_price_cents, discount_cents: 0 }]);
  }
  function updateItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function lineTotal(it: Item): number {
    const q = Number(it.quantity_decimal.replace(',', '.')) || 0;
    return Math.round(q * it.unit_price_cents) - it.discount_cents;
  }
  const total = items.reduce((a, it) => a + lineTotal(it), 0);

  async function saveDraft(): Promise<string> {
    const body = {
      customer_id: customer!.id,
      project_name: projectName || undefined,
      invoice_date: invoiceDate || undefined,
      tax_scenario: 'KLEINUNTERNEHMER_DE',
      items: items.map((it) => ({ ...it })),
    };
    const draft = await api.post<{ id: string }>('/invoices', body);
    setInvoiceId(draft.id);
    return draft.id;
  }

  async function issue() {
    setErr(null);
    try {
      const id = invoiceId ?? (await saveDraft());
      const res = await api.post<{ invoiceNumber: string }>(`/invoices/${id}/issue`);
      nav(`/invoices/${id}`);
      void res;
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-4 text-2xl font-bold">فاکتور جدید</h1>
      {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="card mb-4">
        <label className="label">Kundencode</label>
        <div className="flex gap-2">
          <input className="input font-mono" dir="ltr" placeholder="KD-0001" value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} autoFocus />
          <button className="btn-primary" onClick={lookup}>بارگذاری</button>
        </div>
        {customer && (
          <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200">
            {customer.company_name || customer.last_name} — {customer.city} ({customer.customer_code}) بارگذاری شد. اطلاعات فریلنسر خودکار اعمال می‌شود.
          </div>
        )}
      </div>

      {customer && (
        <>
          <div className="card mb-4 grid grid-cols-2 gap-3">
            <div><label className="label">نام پروژه</label><input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div>
            <div><label className="label">تاریخ صدور (اختیاری)</label><input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          </div>

          <div ref={servicesRef} className="card mb-4">
            <div className="mb-2 font-semibold">Leistungsvorlagen</div>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button key={t.id} className="btn-ghost text-xs" onClick={() => addTemplate(t)}>+ {t.name}</button>
              ))}
            </div>
          </div>

          <div className="card mb-4 overflow-x-auto">
            <table className="data">
              <thead><tr><th>شرح</th><th>تعداد</th><th>واحد</th><th>قیمت واحد (Cent)</th><th>تخفیف</th><th>مبلغ</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td><input className="input" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                    <td><input className="input w-20" dir="ltr" value={it.quantity_decimal} onChange={(e) => updateItem(i, { quantity_decimal: e.target.value })} /></td>
                    <td>{it.unit}</td>
                    <td><input className="input w-28" dir="ltr" type="number" value={it.unit_price_cents} onChange={(e) => updateItem(i, { unit_price_cents: Number(e.target.value) })} /></td>
                    <td><input className="input w-24" dir="ltr" type="number" value={it.discount_cents} onChange={(e) => updateItem(i, { discount_cents: Number(e.target.value) })} /></td>
                    <td className="whitespace-nowrap font-mono">{euro(lineTotal(it))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-left text-lg font-bold">Rechnungsbetrag: {euro(total)}</div>
            <p className="mt-1 text-left text-xs text-gray-500">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
          </div>

          <div className="flex gap-2">
            <button className="btn-ghost" onClick={saveDraft}>ذخیره پیش‌نویس</button>
            {invoiceId && <a className="btn-ghost" href={`/api/invoices/${invoiceId}/preview`} target="_blank" rel="noreferrer">پیش‌نمایش</a>}
            <button className="btn-primary" onClick={issue} disabled={items.length === 0}>صدور نهایی</button>
          </div>
        </>
      )}
    </div>
  );
}
