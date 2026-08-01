import { useEffect, useState } from 'react';
import { api } from '../api';

interface Customer {
  id: string; customer_code: string; customer_type: string; company_name: string | null;
  last_name: string | null; email: string | null; city: string | null; is_active: number;
}

const empty = { customer_code: '', customer_type: 'BUSINESS', company_name: '', last_name: '', contact_person: '', street: '', postal_code: '', city: '', country: 'DE', email: '', ust_idnr: '', leitweg_id: '' };

export function Customers() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = () => api.get<Customer[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);

  async function save() {
    setMsg(null);
    try {
      await api.post('/customers', { ...form, is_active: true });
      setForm(empty); setEditing(false); load();
      setMsg('مشتری ذخیره شد.');
    } catch (e) { setMsg((e as Error).message); }
  }

  async function autoCode() {
    const { code } = await api.get<{ code: string }>('/customers/next-code');
    setForm((f) => ({ ...f, customer_code: code }));
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">مشتریان</h1>
        <div className="flex gap-2">
          <input className="input w-64" placeholder="جست‌وجو: نام، شرکت، ایمیل، کد" value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="btn-ghost" href="/api/customers/export/csv">خروجی CSV</a>
          <button className="btn-primary" onClick={() => { setEditing(!editing); autoCode(); }}>مشتری جدید</button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{msg}</div>}

      {editing && (
        <div className="card mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          {Object.keys(empty).map((k) => (
            <div key={k}>
              <label className="label">{k}</label>
              {k === 'customer_type' ? (
                <select className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}>
                  <option value="BUSINESS">BUSINESS</option><option value="PRIVATE">PRIVATE</option>
                </select>
              ) : (
                <input className="input" dir={['email', 'ust_idnr', 'leitweg_id'].includes(k) ? 'ltr' : 'rtl'} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="col-span-full"><button className="btn-primary" onClick={save}>ذخیره مشتری</button></div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="data">
          <thead><tr><th>کد</th><th>نوع</th><th>شرکت / نام</th><th>ایمیل</th><th>شهر</th><th>وضعیت</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono">{r.customer_code}</td>
                <td>{r.customer_type}</td>
                <td>{r.company_name || r.last_name}</td>
                <td dir="ltr">{r.email}</td>
                <td>{r.city}</td>
                <td>{r.is_active ? <span className="badge bg-green-100 text-green-700">فعال</span> : <span className="badge bg-gray-100 text-gray-500">غیرفعال</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
