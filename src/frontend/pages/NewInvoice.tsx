import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { money, unitLabel } from '../currency';

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
  const [currency, setCurrency] = useState('EUR');
  const [language, setLanguage] = useState<'de' | 'fa' | 'en'>('de');
  const [mode, setMode] = useState<'fa' | 'de' | 'both'>('both');
  const [err, setErr] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  // Financial extras: discount, VAT, advance payment, installments.
  const [discountMode, setDiscountMode] = useState<'NONE' | 'PERCENT' | 'FIXED'>('NONE');
  const [discountValue, setDiscountValue] = useState(0); // PERCENT: %, FIXED: minor units
  const [taxRatePct, setTaxRatePct] = useState(0);
  const [advanceCents, setAdvanceCents] = useState(0);
  const [installments, setInstallments] = useState<{ due_date: string; amount_cents: number; label?: string }[]>([]);
  const servicesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Template[]>('/templates?active=1').then(setTemplates).catch(() => {});
    // Apply the installed profile's defaults + allowed options.
    api.get<{ invoice_mode: 'fa' | 'de' | 'both'; currency: string; invoice_language: string }>('/settings/general')
      .then((g) => {
        setMode(g.invoice_mode);
        setCurrency(g.currency || (g.invoice_mode === 'fa' ? 'IRT' : 'EUR'));
        setLanguage((g.invoice_language as 'de' | 'fa' | 'en') || (g.invoice_mode === 'fa' ? 'fa' : 'de'));
      })
      .catch(() => {});
  }, []);

  const currencyOptions: [string, string][] = mode === 'de'
    ? [['EUR', 'یورو (EUR)']]
    : mode === 'fa'
      ? [['IRR', 'ریال (IRR)'], ['IRT', 'تومان (IRT)'], ['IRT_NEW', 'تومان جدید / قران']]
      : [['EUR', 'یورو (EUR)'], ['IRR', 'ریال (IRR)'], ['IRT', 'تومان (IRT)'], ['IRT_NEW', 'تومان جدید / قران']];
  const languageOptions: [string, string][] = mode === 'de'
    ? [['de', 'آلمانی (Deutsch)']]
    : mode === 'fa'
      ? [['fa', 'فارسی']]
      : [['de', 'آلمانی (Deutsch)'], ['fa', 'فارسی'], ['en', 'انگلیسی (English)']];

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
  const subtotal = items.reduce((a, it) => a + lineTotal(it), 0);
  const discountC = discountMode === 'PERCENT' ? Math.round((subtotal * discountValue) / 100)
    : discountMode === 'FIXED' ? Math.min(discountValue, subtotal) : 0;
  const netC = subtotal - discountC;
  const taxC = Math.round((netC * taxRatePct) / 100);
  const grand = netC + taxC;
  const dueC = grand - advanceCents;

  async function saveDraft(): Promise<string> {
    const body = {
      customer_id: customer!.id,
      project_name: projectName || undefined,
      invoice_date: invoiceDate || undefined,
      currency,
      invoice_language: language,
      tax_scenario: taxRatePct > 0 ? 'CUSTOM_TAX_SCENARIO' : 'KLEINUNTERNEHMER_DE',
      discount_mode: discountMode,
      discount_value: discountMode === 'PERCENT' ? Math.round(discountValue * 100) : discountValue,
      tax_rate_bp: Math.round(taxRatePct * 100),
      advance_paid_cents: advanceCents,
      installments: installments.filter((i) => i.amount_cents > 0),
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
          <div className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><label className="label">نام پروژه</label><input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div>
            <div><label className="label">تاریخ صدور (اختیاری)</label><input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
            <div><label className="label">ارز</label>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencyOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><label className="label">زبان فاکتور</label>
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as 'de' | 'fa' | 'en')}>
                {languageOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
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
              <thead><tr><th>شرح</th><th>تعداد</th><th>واحد</th><th>{unitLabel(currency)}</th><th>تخفیف</th><th>مبلغ</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td><input className="input" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                    <td><input className="input w-20" dir="ltr" value={it.quantity_decimal} onChange={(e) => updateItem(i, { quantity_decimal: e.target.value })} /></td>
                    <td>{it.unit}</td>
                    <td><input className="input w-28" dir="ltr" type="number" value={it.unit_price_cents} onChange={(e) => updateItem(i, { unit_price_cents: Number(e.target.value) })} /></td>
                    <td><input className="input w-24" dir="ltr" type="number" value={it.discount_cents} onChange={(e) => updateItem(i, { discount_cents: Number(e.target.value) })} /></td>
                    <td className="whitespace-nowrap font-mono">{money(lineTotal(it), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 ms-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-ink-600">جمع جزء</span><span className="font-mono">{money(subtotal, currency)}</span></div>
              {discountC > 0 && <div className="flex justify-between text-red-600"><span>تخفیف</span><span className="font-mono">− {money(discountC, currency)}</span></div>}
              {taxC > 0 && <div className="flex justify-between"><span className="text-ink-600">مالیات ({taxRatePct}٪)</span><span className="font-mono">{money(taxC, currency)}</span></div>}
              <div className="flex justify-between border-t border-ink-200 pt-1 text-base font-bold"><span>مبلغ کل</span><span className="font-mono">{money(grand, currency)}</span></div>
              {advanceCents > 0 && <>
                <div className="flex justify-between text-red-600"><span>کسر پیش‌پرداخت</span><span className="font-mono">− {money(advanceCents, currency)}</span></div>
                <div className="flex justify-between font-bold"><span>مبلغ قابل پرداخت</span><span className="font-mono">{money(dueC, currency)}</span></div>
              </>}
            </div>
            {language === 'de' && currency === 'EUR' && taxRatePct === 0 && (
              <p className="mt-1 text-left text-xs text-gray-500">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
            )}
          </div>

          <details className="card mb-4">
            <summary className="cursor-pointer font-semibold">اطلاعات مالی بیشتر (تخفیف، مالیات، پیش‌پرداخت، اقساط)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><label className="label">نوع تخفیف</label>
                <select className="input" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as 'NONE' | 'PERCENT' | 'FIXED')}>
                  <option value="NONE">بدون تخفیف</option><option value="PERCENT">درصدی (٪)</option><option value="FIXED">مبلغ ثابت</option>
                </select>
              </div>
              <div><label className="label">{discountMode === 'PERCENT' ? 'درصد تخفیف' : 'مبلغ تخفیف (واحد خرد)'}</label>
                <input className="input" dir="ltr" type="number" value={discountValue} disabled={discountMode === 'NONE'} onChange={(e) => setDiscountValue(Number(e.target.value))} /></div>
              <div><label className="label">نرخ مالیات (٪)</label>
                <input className="input" dir="ltr" type="number" step="0.5" value={taxRatePct} onChange={(e) => setTaxRatePct(Number(e.target.value))} />
                <p className="mt-0.5 text-xs text-gray-500">۰ = معاف / Kleinunternehmer</p></div>
              <div><label className="label">پیش‌پرداخت (واحد خرد)</label>
                <input className="input" dir="ltr" type="number" value={advanceCents} onChange={(e) => setAdvanceCents(Number(e.target.value))} /></div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="label mb-0">اقساط</span>
                <button type="button" className="btn-ghost text-xs" onClick={() => setInstallments((p) => [...p, { due_date: '', amount_cents: Math.max(0, dueC - p.reduce((a, i) => a + i.amount_cents, 0)) }])}>+ افزودن قسط</button>
              </div>
              {installments.map((ins, i) => (
                <div key={i} className="mb-1 flex items-center gap-2">
                  <input className="input w-40" type="date" value={ins.due_date} onChange={(e) => setInstallments((p) => p.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x))} />
                  <input className="input w-40" dir="ltr" type="number" placeholder="مبلغ (واحد خرد)" value={ins.amount_cents} onChange={(e) => setInstallments((p) => p.map((x, j) => j === i ? { ...x, amount_cents: Number(e.target.value) } : x))} />
                  <button type="button" className="btn-ghost text-xs" onClick={() => setInstallments((p) => p.filter((_, j) => j !== i))}>حذف</button>
                </div>
              ))}
              {installments.length > 0 && (
                <p className="text-xs text-gray-500">جمع اقساط: {money(installments.reduce((a, i) => a + i.amount_cents, 0), currency)} — مبلغ قابل پرداخت: {money(dueC, currency)}</p>
              )}
            </div>
          </details>

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
