import { useEffect, useState } from 'react';
import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { api } from '../api';

const SELLER_FIELDS = ['full_name', 'business_name', 'job_title', 'street', 'postal_code', 'city', 'country', 'email', 'phone', 'website', 'steuernummer', 'ust_idnr', 'kleinunternehmer_id', 'account_holder', 'iban', 'bic', 'bank_name'] as const;

export function Settings() {
  return (
    <div className="flex gap-6">
      <aside className="w-52 shrink-0">
        <nav className="flex flex-col gap-1 text-sm">
          {[
            ['', 'مشخصات فریلنسر'],
            ['general', 'عمومی'],
            ['currency', 'پول ملی و حذف صفر'],
            ['invoice', 'فاکتورها'],
            ['einvoice', 'E-Rechnung و Validator'],
            ['users', 'کاربران و دسترسی‌ها'],
            ['cloudflare', 'اتصال Cloudflare'],
            ['status', 'وضعیت سیستم'],
          ].map(([to, label]) => (
            <NavLink key={to} to={to || '.'} end className={({ isActive }) => `rounded-lg px-3 py-2 ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>{label}</NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <Routes>
          <Route index element={<SellerSettings />} />
          <Route path="general" element={<GenericGroup title="تنظیمات عمومی" path="/settings/general" />} />
          <Route path="currency" element={<CurrencySettings />} />
          <Route path="invoice" element={<GenericGroup title="تنظیمات فاکتور" path="/settings/invoice" />} />
          <Route path="einvoice" element={<GenericGroup title="E-Rechnung و Validator" path="/settings/einvoice" />} />
          <Route path="users" element={<Users />} />
          <Route path="cloudflare" element={<GenericGroup title="اتصال Cloudflare" path="/settings/cloudflare" readOnly />} />
          <Route path="status" element={<SystemStatus />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </div>
    </div>
  );
}

function SellerSettings() {
  const [form, setForm] = useState<Record<string, string | number>>({ job_title: 'Videograf, Videoeditor und Videoproduzent', tax_exemption_text: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', invoice_number_prefix: 'RE', default_payment_days: 14, country: 'DE' });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.get<Record<string, string | number> | null>('/settings/seller').then((s) => { if (s) setForm({ ...form, ...s }); }).catch(() => {}); /* eslint-disable-next-line */ }, []);

  async function save() {
    setMsg(null);
    try { await api.post('/settings/seller', form); setMsg('مشخصات صادرکننده ذخیره شد (نسخه جدید ایجاد شد).'); }
    catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">مشخصات صادرکننده فاکتور</h1>
      {msg && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-3">
        {SELLER_FIELDS.map((k) => (
          <div key={k}><label className="label">{k}</label>
            <input className="input" dir={['email', 'website', 'iban', 'bic', 'ust_idnr'].includes(k) ? 'ltr' : 'rtl'}
              value={String(form[k] ?? '')} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
        ))}
        <div><label className="label">مهلت پرداخت پیش‌فرض (روز)</label><input className="input" dir="ltr" type="number" value={Number(form.default_payment_days ?? 14)} onChange={(e) => setForm({ ...form, default_payment_days: Number(e.target.value) })} /></div>
        <div><label className="label">پیشوند شماره فاکتور</label><input className="input" dir="ltr" value={String(form.invoice_number_prefix ?? 'RE')} onChange={(e) => setForm({ ...form, invoice_number_prefix: e.target.value })} /></div>
        <div className="col-span-full"><label className="label">متن §19 UStG (اجباری در حالت Kleinunternehmer)</label>
          <textarea className="input" rows={2} value={String(form.tax_exemption_text ?? '')} onChange={(e) => setForm({ ...form, tax_exemption_text: e.target.value })} /></div>
        <div className="col-span-full"><button className="btn-primary" onClick={save}>ذخیره</button></div>
      </div>
    </div>
  );
}

function CurrencySettings() {
  const [cfg, setCfg] = useState<Record<string, unknown>>({
    invoice_mode: 'both', currency: 'EUR', invoice_language: 'de',
    redenomination_active: false, qeran_per_new_unit: 100, redenomination_effective_date: '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.get<Record<string, unknown>>('/settings/group/LOCALIZATION').then((d) => setCfg((c) => ({ ...c, ...d }))).catch(() => {});
  }, []);
  async function save() {
    setMsg(null);
    try { await api.put('/settings/group/LOCALIZATION', cfg); setMsg('ذخیره شد.'); }
    catch (e) { setMsg((e as Error).message); }
  }
  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">پول ملی و حذف صفر</h1>
      {msg && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-3">
        <div><label className="label">حالت نصب</label>
          <select className="input" value={String(cfg.invoice_mode)} onChange={(e) => set('invoice_mode', e.target.value)}>
            <option value="fa">فقط فارسی</option><option value="de">فقط آلمانی</option><option value="both">جامع</option>
          </select>
        </div>
        <div><label className="label">ارز پیش‌فرض فاکتور</label>
          <select className="input" value={String(cfg.currency)} onChange={(e) => set('currency', e.target.value)}>
            <option value="EUR">یورو (EUR)</option><option value="IRR">ریال (IRR)</option>
            <option value="IRT">تومان (IRT)</option><option value="IRT_NEW">تومان جدید / قران</option>
          </select>
        </div>
        <div><label className="label">زبان پیش‌فرض فاکتور</label>
          <select className="input" value={String(cfg.invoice_language)} onChange={(e) => set('invoice_language', e.target.value)}>
            <option value="de">آلمانی</option><option value="fa">فارسی</option>
          </select>
        </div>
      </div>

      <div className="card mt-4">
        <div className="mb-2 font-semibold">آماده‌سازی حذف صفر (تومان جدید / قران)</div>
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          طبق مصوبه، هر ۱ واحد پول جدید معادل ۱۰٬۰۰۰ ریال قدیم است و «قران» واحد خرد آن است.
          زمان اجرای رسمی هنوز مشخص نیست، بنابراین این بخش به‌صورت پیش‌فرض غیرفعال است و روی فاکتورهای قبلی هیچ اثری ندارد.
          فاکتورهای صادرشده همیشه با ارز ثبت‌شدهٔ خودشان باقی می‌مانند (تغییرناپذیر).
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(cfg.redenomination_active)} onChange={(e) => set('redenomination_active', e.target.checked)} />
            فعال‌سازی واحد جدید (پس از اعلام رسمی بانک مرکزی)
          </label>
          <div><label className="label">تعداد قران در هر واحد جدید</label>
            <input className="input" dir="ltr" type="number" value={Number(cfg.qeran_per_new_unit ?? 100)} onChange={(e) => set('qeran_per_new_unit', Number(e.target.value))} /></div>
          <div><label className="label">تاریخ اجرا (در صورت اعلام)</label>
            <input className="input" type="date" value={String(cfg.redenomination_effective_date ?? '')} onChange={(e) => set('redenomination_effective_date', e.target.value)} /></div>
        </div>
      </div>
      <button className="btn-primary mt-3" onClick={save}>ذخیره</button>
    </div>
  );
}

function GenericGroup({ title, path, readOnly }: { title: string; path: string; readOnly?: boolean }) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.get<Record<string, unknown>>(path).then((d) => setData(d ?? {})).catch(() => {}); /* eslint-disable-next-line */ }, [path]);

  async function save() {
    setMsg(null);
    try { await api.put(path, data); setMsg('ذخیره شد.'); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      {msg && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}
      <div className="card grid grid-cols-2 gap-3">
        {Object.entries(data).map(([k, v]) => (
          <div key={k}><label className="label">{k}</label>
            <input className="input" dir="ltr" readOnly={readOnly} value={fmt(v)} onChange={(e) => setData({ ...data, [k]: coerce(v, e.target.value) })} /></div>
        ))}
      </div>
      {!readOnly && <button className="btn-primary mt-3" onClick={save}>ذخیره</button>}
    </div>
  );
}

function Users() {
  const [rows, setRows] = useState<{ id: string; email: string; role: string; status: string; last_login_at: string | null }[]>([]);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'ADMIN' });
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.get<typeof rows>('/settings/users').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  async function add() { setMsg(null); try { await api.post('/settings/users', form); load(); } catch (e) { setMsg((e as Error).message); } }
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">کاربران و دسترسی‌ها</h1>
      {msg && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</div>}
      <div className="card mb-4 overflow-x-auto">
        <table className="data">
          <thead><tr><th>ایمیل</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td dir="ltr">{r.email}</td><td>{r.role}</td><td>{r.status}</td><td dir="ltr">{r.last_login_at ?? '—'}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card flex flex-wrap items-end gap-2">
        <div><label className="label">ایمیل</label><input className="input" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="label">نام</label><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
        <div><label className="label">نقش</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{['ADMIN', 'ACCOUNTANT', 'READ_ONLY'].map((r) => <option key={r}>{r}</option>)}</select></div>
        <button className="btn-primary" onClick={add}>افزودن کاربر</button>
      </div>
    </div>
  );
}

function SystemStatus() {
  const [data, setData] = useState<{ items: Record<string, string>; failedJobs: number; invalidEInvoices: number } | null>(null);
  useEffect(() => { api.get<typeof data>('/system/status').then(setData).catch(() => {}); }, []);
  if (!data) return <div className="text-gray-500">در حال بارگذاری…</div>;
  const tone = (s: string) => s === 'OK' ? 'bg-green-100 text-green-700' : s === 'WARNING' ? 'bg-amber-100 text-amber-700' : s === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600';
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">وضعیت سیستم</h1>
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-3">
        {Object.entries(data.items).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-gray-800">
            <span className="text-sm">{k}</span><span className={`badge ${tone(v)}`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(v: unknown): string { return typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); }
function coerce(prev: unknown, next: string): unknown {
  if (typeof prev === 'number') return Number(next);
  if (typeof prev === 'boolean') return next === 'true';
  return next;
}
